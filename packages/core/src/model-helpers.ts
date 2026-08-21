/**
 * The structured-generation wrappers shared by both apps: titles, transition
 * suggestions, and compaction summaries all follow the same shape — send a
 * system prompt plus one user payload under a JSON schema, parse the reply,
 * and fold failures into a result value. Each app supplies only its
 * transport: the desktop's Tauri `generate_json` invoke, the web's BYOK
 * fetch. Everything else lives here once.
 */

import {
  COMPACTION_PROMPT,
  COMPACTION_SCHEMA,
  buildCompactionRequest,
  parseCompactionSummary,
  type CompactionSummarizer,
} from "./compaction";
import { errorMessage } from "./error";
import {
  parseGeneratedPatternTitle,
  parseTransitionSuggestions,
} from "./pattern";
import {
  TITLE_PROMPT,
  TITLE_SCHEMA,
  TRANSITION_SUGGESTIONS_PROMPT,
  TRANSITION_SUGGESTIONS_SCHEMA,
  buildTransitionSuggestionsRequest,
  type ResponseSchema,
} from "./prompts";
import type { TitleGenerator, TransitionSuggester } from "./types";

/** One structured-output call: system prompt + user payload -> raw JSON text. */
export type JsonGenerator = (
  systemInstruction: string,
  input: string,
  schema: ResponseSchema,
) => Promise<string>;

export type ModelHelpers = TitleGenerator &
  TransitionSuggester &
  CompactionSummarizer;

/** Bind a transport into the title/suggestions/compaction helpers. */
export function createModelHelpers(generateJson: JsonGenerator): ModelHelpers {
  return {
    async generateTitle(prompt) {
      try {
        const raw = await generateJson(
          TITLE_PROMPT,
          prompt.trim(),
          TITLE_SCHEMA,
        );
        const title = parseGeneratedPatternTitle(raw);
        if (!title) {
          return { ok: false, error: "Gemini returned an invalid pattern title." };
        }
        return { ok: true, title };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    async suggestTransitions(code, sourcePrompt) {
      try {
        const raw = await generateJson(
          TRANSITION_SUGGESTIONS_PROMPT,
          buildTransitionSuggestionsRequest(code, sourcePrompt),
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
    },

    async generateCompactionSummary(previous, messages) {
      try {
        const raw = await generateJson(
          COMPACTION_PROMPT,
          buildCompactionRequest(previous, messages),
          COMPACTION_SCHEMA,
        );
        const artifact = parseCompactionSummary(raw);
        if (!artifact) {
          return { ok: false, error: "Gemini returned an invalid session summary." };
        }
        return { ok: true, artifact };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}
