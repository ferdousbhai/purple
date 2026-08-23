/**
 * The structured-generation wrappers shared by both apps: titles, transition
 * suggestions, and compaction summaries all follow the same shape - send a
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

type ParsedGeneration<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

async function generateParsed<T>(
  generateJson: JsonGenerator,
  systemInstruction: string,
  input: string,
  schema: ResponseSchema,
  parse: (raw: string) => T | null,
  invalidResponseError: string,
): Promise<ParsedGeneration<T>> {
  try {
    const value = parse(
      await generateJson(systemInstruction, input, schema),
    );
    return value === null
      ? { ok: false, error: invalidResponseError }
      : { ok: true, value };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Bind a transport into the title/suggestions/compaction helpers. */
export function createModelHelpers(generateJson: JsonGenerator): ModelHelpers {
  return {
    async generateTitle(prompt) {
      const result = await generateParsed(
        generateJson,
        TITLE_PROMPT,
        prompt.trim(),
        TITLE_SCHEMA,
        parseGeneratedPatternTitle,
        "Gemini returned an invalid pattern title.",
      );
      return result.ok ? { ok: true, title: result.value } : result;
    },

    async suggestTransitions(code, sourcePrompt) {
      const result = await generateParsed(
        generateJson,
        TRANSITION_SUGGESTIONS_PROMPT,
        buildTransitionSuggestionsRequest(code, sourcePrompt),
        TRANSITION_SUGGESTIONS_SCHEMA,
        parseTransitionSuggestions,
        "Gemini returned invalid transition suggestions.",
      );
      return result.ok ? { ok: true, suggestions: result.value } : result;
    },

    async generateCompactionSummary(previous, messages) {
      const result = await generateParsed(
        generateJson,
        COMPACTION_PROMPT,
        buildCompactionRequest(previous, messages),
        COMPACTION_SCHEMA,
        parseCompactionSummary,
        "Gemini returned an invalid session summary.",
      );
      return result.ok ? { ok: true, artifact: result.value } : result;
    },
  };
}
