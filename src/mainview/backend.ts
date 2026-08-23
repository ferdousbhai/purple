/**
 * The desktop backend adapter.
 *
 * Every call the UI makes into the Tauri shell goes through this module. The
 * Rust side is a transport: prompts, schemas and parsing live here (and in
 * `@purple/core`) so the hosted app keeps sharing them.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage } from "@purple/core/error";
import type { CompactionSummarizer } from "@purple/core/compaction";
import { createModelHelpers } from "@purple/core/model-helpers";
import { patternFilename } from "@purple/core/pattern";
import { SYSTEM_PROMPT, type ResponseSchema } from "@purple/core/prompts";
import { parseCliArgs, type StartupOptions } from "../shared/cli";
import type {
  ApiKeyStatus,
  ChatMessage,
  MediaControlAction,
  PlaybackState,
  PurpleBackend,
  SavePatternResult,
  StreamOutcome,
  SystemTheme,
} from "../shared/types";

/** Emitted when a second `purple-music …` invocation is forwarded here. */
const STARTUP_ARGS_EVENT = "purple://startup-args";

/** Emitted by the Rust shell when a desktop media control (MPRIS) asks for something. */
const MEDIA_CONTROL_EVENT = "purple://media-control";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean; promptTokens: number | null };


export { errorMessage };

/**
 * Stream a pattern response. Deltas arrive on `onDelta`; the promise settles
 * when the model finishes, and rejects with a user-facing message on failure.
 */
export function streamPattern(
  messages: readonly ChatMessage[],
  onDelta: (text: string) => void,
): Promise<StreamOutcome> {
  const channel = new Channel<StreamEvent>();
  // Channel messages and the command's response reach the webview by different
  // routes, so the response can arrive while deltas are still in flight. The
  // stream is over when the terminal event says so; the response only reports
  // failure. The shell always sends a terminal event, cancellation included.
  return new Promise<StreamOutcome>((resolve, reject) => {
    channel.onmessage = (event) => {
      if (event.type === "delta") {
        onDelta(event.text);
      } else {
        resolve({
          truncated: event.truncated,
          promptTokens: event.promptTokens ?? null,
        });
      }
    };

    invoke("stream_pattern", {
      messages: messages.map(({ role, content }) => ({ role, content })),
      systemInstruction: SYSTEM_PROMPT,
      onEvent: channel,
    }).catch(reject);
  });
}

export async function abortStream(): Promise<void> {
  await invoke("abort_stream");
}

async function generateJson(
  systemInstruction: string,
  input: string,
  schema: ResponseSchema,
): Promise<string> {
  return invoke<string>("generate_json", {
    systemInstruction,
    input,
    schema,
  });
}

// Titles, transition suggestions, and compaction summaries share the
// structured-generation wrappers in @purple/core; only the transport - the
// Tauri `generate_json` invoke - is supplied here.
const modelHelpers = createModelHelpers(generateJson);

export const generateTitle = modelHelpers.generateTitle;
export const suggestTransitions = modelHelpers.suggestTransitions;
export const generateCompactionSummary = modelHelpers.generateCompactionSummary;

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("api_key_status");
}

export async function saveApiKey(apiKey: string): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("save_api_key", { apiKey });
}

export async function clearApiKey(): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("clear_api_key");
}

export async function getStartupOptions(): Promise<StartupOptions> {
  return parseCliArgs(await invoke<string[]>("startup_args"));
}

/** Run `handler` when another `purple-music …` invocation hands its arguments here. */
export function onStartupArgs(
  handler: (options: StartupOptions) => void,
): Promise<UnlistenFn> {
  return listen<string[]>(STARTUP_ARGS_EVENT, (event) => {
    // A bare `purple-music` - the launcher icon, or a second click - forwards no
    // arguments and means "focus the window". Re-running startup policy would
    // overwrite the pattern the user is working on.
    if (event.payload.length === 0) return;
    handler(parseCliArgs(event.payload));
  });
}

export async function savePattern(
  title: string,
  code: string,
): Promise<SavePatternResult> {
  if (!title.trim() || !code.trim()) {
    return {
      ok: false,
      cancelled: false,
      error: "A title and pattern code are required.",
    };
  }
  return invoke<SavePatternResult>("save_pattern", {
    suggestedName: patternFilename(title),
    code,
  });
}

/**
 * Report the current playback status and pattern title so the desktop's media
 * controls (MPRIS) stay in sync. Fire-and-forget: the desktop integration is
 * cosmetic and must never disturb playback.
 */
export function setPlaybackState(status: PlaybackState, title: string): void {
  void invoke("set_playback_state", { status, title }).catch(() => {});
}

const MEDIA_CONTROL_ACTIONS: readonly MediaControlAction[] = [
  "play",
  "pause",
  "play-pause",
  "stop",
];

/** Run `handler` when a desktop media control asks to play, pause or stop. */
export function onMediaControl(
  handler: (action: MediaControlAction) => void,
): Promise<UnlistenFn> {
  return listen<string>(MEDIA_CONTROL_EVENT, (event) => {
    const action = MEDIA_CONTROL_ACTIONS.find((known) => known === event.payload);
    if (action) handler(action);
  });
}

/** The active Omarchy system theme, or null on machines without one. */
export async function getSystemTheme(): Promise<SystemTheme | null> {
  return invoke<SystemTheme | null>("get_system_theme");
}

export function log(level: "warn" | "error", message: string): void {
  void invoke("log_message", { level, message }).catch(() => {});
}

/**
 * The desktop implementation of the shared `PurpleBackend` adapter. `satisfies`
 * keeps the individual functions above exported under their existing names
 * while proving they add up to the interface the shared UI expects.
 */
export const backend = {
  stream: streamPattern,
  abortStream,
  generateTitle,
  suggestTransitions,
  generateCompactionSummary,
} satisfies PurpleBackend & CompactionSummarizer;

/** Purple runs on Strudel; this is its developers' Open Collective. The
 * capability in `capabilities/default.json` scopes the opener to this URL. */
export const SUPPORT_STRUDEL_URL = "https://opencollective.com/tidalcycles";

/** Open the Strudel funding page in the system browser. */
export function openSupportStrudel(): Promise<void> {
  return openUrl(SUPPORT_STRUDEL_URL);
}
