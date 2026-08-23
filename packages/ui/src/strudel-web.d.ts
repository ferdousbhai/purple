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
    /** The event's control values (`s`, `bank`, `note`, ...), or a primitive
     * for bare numeric/string patterns. Only the fields the sound audit reads
     * are declared. */
    value?:
      | number
      | string
      | boolean
      | null
      | {
          s?: number | string | null;
          bank?: number | string | null;
        };
  }

  /** Controls merged into the query state. Strudel reads `_cps` for timing. */
  export interface StrudelQueryControls {
    _cps?: number;
    cyclist?: string;
  }

  export interface StrudelPattern {
    _fast: (factor: number) => StrudelPattern;
    queryArc: (
      begin: number,
      end: number,
      controls?: StrudelQueryControls,
    ) => StrudelHap[];
  }

  export interface StrudelRepl {
    scheduler: { cps: number };
    setPattern: (
      pattern: StrudelPattern,
      autostart?: boolean,
    ) => Promise<StrudelPattern>;
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
  export function register(
    name: "cpm",
    implementation: (
      cyclesPerMinute: number,
      pattern: StrudelPattern,
    ) => StrudelPattern,
  ): void;
  export type StrudelSampleLeaf = string | readonly string[];
  export type StrudelSampleMap = Record<
    string,
    StrudelSampleLeaf | Readonly<Record<string, StrudelSampleLeaf>>
  >;
  export function samples(
    source: StrudelSampleMap,
    baseUrl?: string,
  ): Promise<void>;
  /** One sound-registry entry. Purple only ever tests for presence. */
  export interface RegisteredSound {
    data?: object;
  }
  /** The engine's registry lookup: the registered sound for `name` (case
   * folded, aliases resolved), or undefined - exactly what trigger time uses,
   * which makes it the ground truth for validating generated sound names. */
  export function getSound(name: string): RegisteredSound | undefined;

  /** Superdough's mixer. Every orbit sums into `output.destinationGain`
   * before the context destination, so tapping it observes the master mix. */
  export function getSuperdoughAudioController(): {
    output: { destinationGain: GainNode };
  };
  /** The registry itself; `get()` returns the name -> sound map. */
  export const soundMap: { get(): Record<string, RegisteredSound> };
  /** Register friendly bank aliases from a parsed `{bank: alias}` map. */
  export function aliasBank(
    aliases: Record<string, string | readonly string[]>,
  ): Promise<void>;
  /** Register `alias` as another name for the already-loaded sound `original`. */
  export function soundAlias(original: string, alias: string): void;
  /** Register the z_* ZZFX chiptune synths (no network involved). */
  export function registerZZFXSounds(): void;
}
