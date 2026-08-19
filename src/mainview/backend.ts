/**
 * The desktop backend adapter.
 *
 * Every call the UI makes into the Tauri shell goes through this module. The
 * Rust side is a transport: prompts, schemas and parsing live here (and in
 * `@riff/core`) so the hosted app keeps sharing them.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  parseGeneratedPatternTitle,
  parseTransitionSuggestions,
  patternFilename,
} from "@riff/core/pattern";
import {
  SYSTEM_PROMPT,
  TITLE_PROMPT,
  TRANSITION_SUGGESTIONS_PROMPT,
} from "@riff/core/prompts";
import { parseCliArgs, type StartupOptions } from "../shared/cli";
import type {
  ApiKeyStatus,
  Message,
  SavePatternResult,
  TitleGenerationResult,
  TransitionSuggestionsResult,
} from "../shared/types";

/** Emitted by the Rust shell when a second `riff …` invocation is forwarded here. */
const STARTUP_ARGS_EVENT = "riff://startup-args";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean };

export interface StreamOutcome {
  /** The model stopped at its output limit rather than finishing. */
  truncated: boolean;
}

/** The JSON Schema subset the Rust `generate_json` command forwards to Gemini. */
interface ResponseSchema {
  type: "object" | "array" | "string";
  description?: string;
  properties?: Record<string, ResponseSchema>;
  items?: ResponseSchema;
  required?: readonly string[];
  additionalProperties?: boolean;
  minItems?: number;
  maxItems?: number;
}

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "A memorable 2 to 6 word music title, at most 60 characters",
    },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const TRANSITION_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "An inviting 2 to 5 word next-move label",
          },
          prompt: {
            type: "string",
            description:
              "A standalone prompt for generating the next music pattern",
          },
        },
        required: ["label", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Stream a pattern response. Deltas arrive on `onDelta`; the promise settles
 * when the model finishes, and rejects with a user-facing message on failure.
 */
export function streamPattern(
  messages: Message[],
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
        resolve({ truncated: event.truncated });
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

export async function generateTitle(
  prompt: string,
): Promise<TitleGenerationResult> {
  try {
    const raw = await generateJson(TITLE_PROMPT, prompt.trim(), TITLE_SCHEMA);
    const title = parseGeneratedPatternTitle(raw);
    if (!title) {
      return { ok: false, error: "Gemini returned an invalid pattern title." };
    }
    return { ok: true, title };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function suggestTransitions(
  code: string,
  sourcePrompt?: string,
): Promise<TransitionSuggestionsResult> {
  try {
    const raw = await generateJson(
      TRANSITION_SUGGESTIONS_PROMPT,
      JSON.stringify({
        currentMusicPrompt: sourcePrompt?.trim() || null,
        currentStrudelPattern: code.trim(),
      }),
      TRANSITION_SUGGESTIONS_SCHEMA,
    );
    const suggestions = parseTransitionSuggestions(raw);
    if (!suggestions) {
      return {
        ok: false,
        error: "Gemini returned invalid transition suggestions.",
      };
    }
    return { ok: true, suggestions };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

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

/** Run `handler` when another `riff …` invocation hands its arguments to this window. */
export function onStartupArgs(
  handler: (options: StartupOptions) => void,
): Promise<UnlistenFn> {
  return listen<string[]>(STARTUP_ARGS_EVENT, (event) => {
    // A bare `riff` — the launcher icon, or a second click on it — forwards no
    // arguments and means "focus the window". Parsing that would hand back a
    // random preset and overwrite the pattern the user is working on.
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

export function log(level: "warn" | "error", message: string): void {
  void invoke("log_message", { level, message }).catch(() => {});
}
