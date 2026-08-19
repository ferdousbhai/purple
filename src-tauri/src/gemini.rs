//! Gemini transport.
//!
//! This module is deliberately dumb: it knows how to talk to the Interactions
//! API and nothing about music. Prompts, schemas and every parser stay in
//! TypeScript (`@riff/core`) so the desktop app and the hosted app keep sharing
//! them.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::secrets;

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL: &str = "gemini-3.7-flash";
const DEFAULT_THINKING_LEVEL: &str = "low";
const ONE_SHOT_TIMEOUT: Duration = Duration::from_secs(45);

/// A chat turn from the webview. Extra fields (`id`) are ignored.
#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    /// A chunk of model output text.
    Delta { text: String },
    /// The model finished. `truncated` means it ran into the output limit.
    Done { truncated: bool },
}

#[derive(Default)]
pub struct GeminiState {
    client: std::sync::OnceLock<reqwest::Client>,
    /// The in-flight stream, tagged so a finished stream never clears its successor.
    active: Mutex<Option<(u64, CancellationToken)>>,
    next_stream_id: AtomicU64,
}

impl GeminiState {
    fn client(&self) -> &reqwest::Client {
        self.client.get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                // Applies between reads, so a stalled stream fails instead of
                // hanging the UI on a request that never finishes.
                .read_timeout(Duration::from_secs(60))
                .user_agent(concat!("riff/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("could not build the HTTP client")
        })
    }
}

fn model() -> String {
    std::env::var("GEMINI_MODEL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_owned())
}

/// `GEMINI_THINKING_LEVEL`, rejecting anything outside the supported levels.
fn thinking_level() -> Result<String, String> {
    let raw = std::env::var("GEMINI_THINKING_LEVEL").unwrap_or_default();
    let value = raw.trim();
    if value.is_empty() {
        return Ok(DEFAULT_THINKING_LEVEL.to_owned());
    }
    match value.to_ascii_lowercase().as_str() {
        level @ ("low" | "medium" | "high") => Ok(level.to_owned()),
        _ => Err(format!(
            "Invalid GEMINI_THINKING_LEVEL \"{value}\". Expected LOW, MEDIUM, or HIGH."
        )),
    }
}

fn generation_config(model: &str) -> Result<Value, String> {
    // Thinking levels are a Gemini 3 feature; older models reject the field.
    if model.starts_with("gemini-3") {
        Ok(json!({ "thinking_level": thinking_level()? }))
    } else {
        Ok(json!({}))
    }
}

fn api_key() -> Result<String, String> {
    secrets::effective_key()
        .ok_or_else(|| "Missing Google API key. Add one in Riff settings.".to_owned())
}

/// Conversation history as Interactions API steps.
fn steps_from(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let step_type = if message.role == "assistant" || message.role == "model" {
                "model_output"
            } else {
                "user_input"
            };
            json!({
                "type": step_type,
                "content": [{ "type": "text", "text": message.content }],
            })
        })
        .collect()
}

fn friendly_transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "The request timed out. Check your internet connection and try again.".to_owned()
    } else if error.is_connect() || error.is_request() {
        "Connection failed. Check your internet connection.".to_owned()
    } else {
        format!("API error: {error}")
    }
}

/// Turn a non-2xx body into a user-facing message.
fn friendly_api_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = extract_error_message(body).unwrap_or_else(|| body.trim().to_owned());

    if message.contains("API key not valid") || message.contains("API_KEY_INVALID") {
        return "Invalid API key. Check the Google Gemini API key saved in Riff settings."
            .to_owned();
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || message.to_lowercase().contains("quota")
    {
        return "Rate limited by the API. Wait a moment and try again.".to_owned();
    }
    if status == reqwest::StatusCode::BAD_REQUEST {
        return format!("Gemini rejected the request: {message}");
    }
    if message.is_empty() {
        format!("API error: HTTP {status}")
    } else {
        format!("API error: {message}")
    }
}

fn extract_error_message(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    // Errors arrive either as `{"error": {...}}` or as `[{"error": {...}}]`.
    let error = value
        .get("error")
        .or_else(|| value.as_array()?.first()?.get("error"))?;
    Some(error.get("message")?.as_str()?.to_owned())
}

async fn post(
    state: &GeminiState,
    body: Value,
    timeout: Option<Duration>,
) -> Result<reqwest::Response, String> {
    let mut request = state
        .client()
        .post(ENDPOINT)
        .header("x-goog-api-key", api_key()?)
        .json(&body);
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    let response = request
        .send()
        .await
        .map_err(|error| friendly_transport_error(&error))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(friendly_api_error(status, &body));
    }
    Ok(response)
}

/// Stream a pattern response, forwarding text deltas to the webview as they arrive.
#[tauri::command]
pub async fn stream_pattern(
    state: State<'_, GeminiState>,
    messages: Vec<ChatMessage>,
    system_instruction: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let token = CancellationToken::new();
    let stream_id = state.next_stream_id.fetch_add(1, Ordering::Relaxed);
    {
        let mut active = state.active.lock().await;
        if let Some((_, previous)) = active.replace((stream_id, token.clone())) {
            previous.cancel();
        }
    }

    let mut emit = |event: StreamEvent| {
        on_event
            .send(event)
            .map_err(|error| format!("Could not deliver a response chunk: {error}"))
    };
    let outcome = tokio::select! {
        biased;
        _ = token.cancelled() => None,
        outcome = run_stream(&state, messages, system_instruction, &mut emit) => Some(outcome),
    };
    // The webview settles its stream promise on the terminal channel event, not
    // on this command's return: channel messages and the command response travel
    // separate paths, so a response that overtook the last delta would drop it.
    // A cancelled request therefore still needs its terminal event.
    let result = match outcome {
        Some(result) => result,
        None => emit(StreamEvent::Done { truncated: false }),
    };

    let mut active = state.active.lock().await;
    if active.as_ref().is_some_and(|(id, _)| *id == stream_id) {
        *active = None;
    }
    result
}

/// Drive one streaming request, handing every event to `emit`.
async fn run_stream(
    state: &GeminiState,
    messages: Vec<ChatMessage>,
    system_instruction: String,
    emit: &mut impl FnMut(StreamEvent) -> Result<(), String>,
) -> Result<(), String> {
    let model = model();
    let body = json!({
        "model": model,
        "system_instruction": system_instruction,
        "input": steps_from(&messages),
        "stream": true,
        "store": false,
        "generation_config": generation_config(&model)?,
    });

    let response = post(state, body, None).await?;
    let mut stream = response.bytes_stream();
    // Buffer bytes, not text: a chunk can split a multi-byte character in half,
    // and decoding each chunk on its own would turn that into a replacement char.
    let mut buffer: Vec<u8> = Vec::new();
    let mut progress = StreamProgress::default();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| friendly_transport_error(&error))?;
        buffer.extend_from_slice(&chunk);

        while let Some((end, next)) = find_event_boundary(&buffer) {
            let raw = String::from_utf8_lossy(&buffer[..end]).into_owned();
            buffer.drain(..next);
            progress.handle(&raw, emit)?;
        }
    }

    // A body that ends without a final blank line still carries one last event.
    if !buffer.is_empty() {
        progress.handle(&String::from_utf8_lossy(&buffer), emit)?;
    }

    if !progress.saw_text {
        return Err(if progress.truncated {
            "Gemini reached its output limit before producing any text. Please try again."
                .to_owned()
        } else {
            "Gemini returned an empty response.".to_owned()
        });
    }

    emit(StreamEvent::Done {
        truncated: progress.truncated,
    })?;
    Ok(())
}

/// What the stream has told us so far, across chunk boundaries.
#[derive(Default)]
struct StreamProgress {
    /// Step index to step type, so text from reasoning steps can be skipped.
    step_types: HashMap<i64, String>,
    saw_text: bool,
    truncated: bool,
}

impl StreamProgress {
    /// Consume one raw SSE event, forwarding any model output to `emit`.
    fn handle(
        &mut self,
        raw: &str,
        emit: &mut impl FnMut(StreamEvent) -> Result<(), String>,
    ) -> Result<(), String> {
        let Some(data) = sse_data(raw) else {
            return Ok(());
        };
        if data == "[DONE]" {
            return Ok(());
        }
        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            return Ok(());
        };

        match event.get("event_type").and_then(Value::as_str) {
            Some("step.start") => {
                if let (Some(index), Some(step_type)) = (
                    event.get("index").and_then(Value::as_i64),
                    event
                        .get("step")
                        .and_then(|step| step.get("type"))
                        .and_then(Value::as_str),
                ) {
                    self.step_types.insert(index, step_type.to_owned());
                }
            }
            Some("step.delta") => {
                let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
                // Reasoning steps stream their own deltas; only model output is the answer.
                if self.step_types.get(&index).map(String::as_str) != Some("model_output") {
                    return Ok(());
                }
                let delta = event.get("delta");
                if delta
                    .and_then(|delta| delta.get("type"))
                    .and_then(Value::as_str)
                    != Some("text")
                {
                    return Ok(());
                }
                let text = delta
                    .and_then(|delta| delta.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !text.is_empty() {
                    self.saw_text = true;
                    emit(StreamEvent::Delta {
                        text: text.to_owned(),
                    })?;
                }
            }
            Some("interaction.completed") => {
                self.truncated = event
                    .get("interaction")
                    .and_then(|interaction| interaction.get("status"))
                    .and_then(Value::as_str)
                    == Some("incomplete");
            }
            Some("error") => {
                return Err(extract_error_message(&data)
                    .unwrap_or_else(|| "The model returned an error.".to_owned()));
            }
            _ => {}
        }
        Ok(())
    }
}

/// Byte offsets of the next complete SSE event: (end of payload, start of the next event).
fn find_event_boundary(buffer: &[u8]) -> Option<(usize, usize)> {
    let find = |needle: &[u8]| {
        buffer
            .windows(needle.len())
            .position(|window| window == needle)
            .map(|index| (index, index + needle.len()))
    };
    match (find(b"\n\n"), find(b"\r\n\r\n")) {
        (Some(lf), Some(crlf)) => Some(if lf.0 < crlf.0 { lf } else { crlf }),
        (found, None) | (None, found) => found,
    }
}

/// Concatenate the `data:` lines of one SSE event.
fn sse_data(raw: &str) -> Option<String> {
    let mut data = String::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    (!data.is_empty()).then_some(data)
}

#[tauri::command]
pub async fn abort_stream(state: State<'_, GeminiState>) -> Result<(), String> {
    if let Some((_, token)) = state.active.lock().await.take() {
        token.cancel();
    }
    Ok(())
}

/// One-shot structured generation. The caller supplies the schema, so Rust never
/// learns what a title or a transition suggestion is.
#[tauri::command]
pub async fn generate_json(
    state: State<'_, GeminiState>,
    system_instruction: String,
    input: String,
    schema: Value,
) -> Result<String, String> {
    generate_structured(&state, system_instruction, input, schema).await
}

async fn generate_structured(
    state: &GeminiState,
    system_instruction: String,
    input: String,
    schema: Value,
) -> Result<String, String> {
    let model = model();
    let body = json!({
        "model": model,
        "system_instruction": system_instruction,
        "input": input,
        "store": false,
        "generation_config": generation_config(&model)?,
        "response_format": [{
            "type": "text",
            "mime_type": "application/json",
            "schema": schema,
        }],
    });

    // One-shot requests are background work for the UI, so they get a deadline
    // rather than a spinner that never resolves.
    let response = post(state, body, Some(ONE_SHOT_TIMEOUT)).await?;
    let interaction: Value = response
        .json()
        .await
        .map_err(|error| friendly_transport_error(&error))?;

    if interaction.get("status").and_then(Value::as_str) == Some("incomplete") {
        return Err(
            "Gemini reached its output limit before finishing. Please try again.".to_owned(),
        );
    }

    let text = model_output_text(&interaction);
    if text.trim().is_empty() {
        return Err("Gemini returned an empty response.".to_owned());
    }
    Ok(text)
}

fn model_output_text(interaction: &Value) -> String {
    interaction
        .get("steps")
        .and_then(Value::as_array)
        .map(|steps| {
            steps
                .iter()
                .filter(|step| step.get("type").and_then(Value::as_str) == Some("model_output"))
                .filter_map(|step| step.get("content").and_then(Value::as_array))
                .flatten()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sse_events_on_either_line_ending() {
        let buffer = b"event: a\ndata: {\"x\":1}\n\nevent: b\n";
        let (end, next) = find_event_boundary(buffer).expect("a complete event");
        assert_eq!(&buffer[..end], b"event: a\ndata: {\"x\":1}");
        assert_eq!(&buffer[next..], b"event: b\n");
    }

    #[test]
    fn survives_a_character_split_across_two_chunks() {
        // "café" split mid-é, the way a TCP chunk boundary can land.
        let mut buffer: Vec<u8> = b"data: caf".to_vec();
        buffer.push(0xc3);
        assert!(find_event_boundary(&buffer).is_none());
        buffer.push(0xa9);
        buffer.extend_from_slice(b"\n\n");
        let (end, _) = find_event_boundary(&buffer).expect("a complete event");
        assert_eq!(
            sse_data(&String::from_utf8_lossy(&buffer[..end])),
            Some("café".to_owned())
        );
    }

    #[test]
    fn joins_multi_line_data_payloads() {
        assert_eq!(
            sse_data("event: x\ndata: {\"a\":1,\ndata: \"b\":2}"),
            Some("{\"a\":1,\n\"b\":2}".to_owned())
        );
    }

    #[test]
    fn ignores_events_without_data() {
        assert_eq!(sse_data("event: ping\n: comment"), None);
    }

    #[test]
    fn reads_the_error_message_from_both_error_shapes() {
        assert_eq!(
            extract_error_message(r#"{"error":{"message":"boom"}}"#).as_deref(),
            Some("boom")
        );
        assert_eq!(
            extract_error_message(r#"[{"error":{"message":"boom"}}]"#).as_deref(),
            Some("boom")
        );
    }

    #[test]
    fn maps_an_invalid_key_to_an_actionable_message() {
        let message = friendly_api_error(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"message":"API key not valid. Please pass a valid API key."}}"#,
        );
        assert!(message.contains("Riff settings"), "{message}");
    }

    #[test]
    fn concatenates_model_output_text_parts() {
        let interaction = json!({
            "steps": [
                { "type": "thought", "signature": "..." },
                { "type": "model_output", "content": [
                    { "type": "text", "text": "{\"title\":" },
                    { "type": "text", "text": "\"Hi\"}" }
                ]}
            ]
        });
        assert_eq!(model_output_text(&interaction), "{\"title\":\"Hi\"}");
    }

    fn live_key_available() -> bool {
        std::env::var("GEMINI_API_KEY").is_ok_and(|key| !key.trim().is_empty())
    }

    /// Hits the real Gemini API, so it is opt-in:
    /// `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn streams_text_from_the_live_api() {
        assert!(live_key_available(), "set GEMINI_API_KEY to run this test");
        let state = GeminiState::default();
        let mut text = String::new();
        let mut done = false;
        run_stream(
            &state,
            vec![ChatMessage {
                role: "user".into(),
                content: "Say the single word: pong".into(),
            }],
            "Reply with one word and nothing else.".into(),
            &mut |event| {
                match event {
                    StreamEvent::Delta { text: delta } => text.push_str(&delta),
                    StreamEvent::Done { .. } => done = true,
                }
                Ok(())
            },
        )
        .await
        .expect("the stream should succeed");

        assert!(done, "the stream should report completion");
        assert!(!text.trim().is_empty(), "the stream should produce text");
    }

    #[tokio::test]
    #[ignore]
    async fn returns_schema_shaped_json_from_the_live_api() {
        assert!(live_key_available(), "set GEMINI_API_KEY to run this test");
        let state = GeminiState::default();
        let raw = generate_structured(
            &state,
            "Name the track in 2 to 6 words.".into(),
            "a slow lofi beat with warm chords".into(),
            json!({
                "type": "object",
                "properties": { "title": { "type": "string" } },
                "required": ["title"],
                "additionalProperties": false,
            }),
        )
        .await
        .expect("the request should succeed");

        let parsed: Value = serde_json::from_str(&raw).expect("valid JSON");
        assert!(
            parsed.get("title").and_then(Value::as_str).is_some(),
            "expected a title field in {raw}"
        );
    }

    #[test]
    fn maps_chat_roles_onto_interaction_steps() {
        let steps = steps_from(&[
            ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "hello".into(),
            },
        ]);
        assert_eq!(steps[0]["type"], "user_input");
        assert_eq!(steps[1]["type"], "model_output");
        assert_eq!(steps[1]["content"][0]["text"], "hello");
    }
}
