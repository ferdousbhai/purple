/**
 * `@strudel/web` ships no type definitions. These declarations describe only the
 * surface Purple uses, and mirror the upstream runtime behaviour:
 * `@strudel/web/web.mjs` re-exports `@strudel/core` (`getCps`, `getTime`),
 * `@strudel/webaudio` and `superdough` (`getAudioContext`, `initAudio`,
 * `samples`) alongside its own `initStrudel`/`hush`.
 */
declare module "@strudel/web/web.mjs" {
  export interface StrudelLocation {
    start: number;
    end: number;
  }

  export interface StrudelHap {
    context?: {
      locations?: StrudelLocation[];
    };
    isActive?: (time: number) => boolean;
  }

  /** Controls merged into the query state. Strudel reads `_cps` for timing. */
  export interface StrudelQueryControls {
    _cps?: number;
    cyclist?: string;
  }

  export interface StrudelPattern {
    queryArc: (
      begin: number,
      end: number,
      controls?: StrudelQueryControls,
    ) => StrudelHap[];
  }

  export interface StrudelRepl {
    /**
     * Resolves to the evaluated pattern, or to `undefined` when evaluation
     * failed — the reason is delivered separately to `onEvalError`.
     */
    evaluate: (
      code: string,
      autoplay?: boolean,
      shouldHush?: boolean,
    ) => Promise<StrudelPattern | undefined>;
  }

  export interface InitStrudelOptions {
    audioContext: AudioContext;
    onEvalError: (error: Error) => void;
    prebake: () => Promise<void>;
  }

  export function getAudioContext(): AudioContext;
  /** `undefined` until the scheduler has a cps source. */
  export function getCps(): number | undefined;
  export function getTime(): number;
  export function hush(): void;
  export function initAudio(): Promise<void>;
  export function initStrudel(
    options: InitStrudelOptions,
  ): Promise<StrudelRepl>;
  export function samples(source: string): Promise<void>;
  /** Register friendly bank aliases from a `{alias: bank}` JSON map at `source`. */
  export function aliasBank(source: string): Promise<void>;
  /** Register `alias` as another name for the already-loaded sound `original`. */
  export function soundAlias(original: string, alias: string): void;
  /** Register the z_* ZZFX chiptune synths (no network involved). */
  export function registerZZFXSounds(): void;
}

declare module "@strudel/soundfonts" {
  /** Register the gm_* General MIDI soundfont instruments. */
  export function registerSoundfonts(): Promise<void>;
}
