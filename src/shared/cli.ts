export interface StartupOptions {
  error?: string;
  initialCode?: string;
  initialPrompt?: string;
  requestPlayback?: boolean;
}

export const PRESET_PATTERNS = {
  basic: 's("bd hh sd hh")',
  drums: 's("bd [~ hh] sd [hh bd]")',
  lofi: `stack(
  s("bd [~ bd] sd [bd sd]").gain(0.9),
  s("[~ hh]*4").gain(0.5).lpf(3000),
  note("[c3 [e3 g3]] [a2 [c3 e3]]")
    .s("sawtooth").lpf(600).gain(0.4)
    .room(0.3).delay(0.2)
)`,
  techno: `stack(
  s("bd*4").gain(1),
  s("~ cp ~ ~").room(0.3),
  s("hh*8").gain("<0.5 0.7>").lpf(4000),
  note("[c2 ~ c2 ~]*2").s("square").lpf(400).decay(0.1)
).every(4, fast(2))`,
  cyberpunk: `stack(
  s("bd*4").gain(1.1),
  s("~ cp ~ ~").room(0.4),
  s("hh*16").lpf(5000).gain("<0.4 0.6>"),
  note("[d2 [d2 d3]] [~ d2] [f2 d2]").s("sawtooth").lpf(700).distort(0.4)
)`,
  ambient: `note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>")
  .s("sawtooth")
  .lpf(800)
  .attack(0.5).release(2)
  .room(0.8).roomsize(4)
  .delay(0.3).delaytime(0.375)
  .jux(rev)`,
  dnb: `stack(
  s("bd [~ sd] [~ bd] sd").fast(2),
  s("hh*16").gain(0.4),
  note("<f2 g2 a2 bb2>").s("sawtooth").lpf(300).gain(0.7)
)`,
  chiptune: `note("c4 e4 g4 b4 c5 g4 e4 b4")
  .s("triangle")
  .fast(2)
  .gain(0.6)`,
  house: `stack(
  s("bd*4"),
  s("~ [~ cp]").room(0.2),
  s("~ hh").gain(0.7),
  note("[c2 g2 c2 <g2 bb2>]").s("sawtooth").lpf(500)
)`,
} as const satisfies Record<string, string>;

const RANDOM_STARTUP_PRESET_NAMES = [
  "drums",
  "lofi",
  "techno",
  "cyberpunk",
  "ambient",
  "dnb",
  "chiptune",
  "house",
] as const satisfies readonly (keyof typeof PRESET_PATTERNS)[];

export function getRandomStartupPattern(random = Math.random): string {
  const index = Math.floor(random() * RANDOM_STARTUP_PRESET_NAMES.length);
  const name =
    RANDOM_STARTUP_PRESET_NAMES[index] ?? RANDOM_STARTUP_PRESET_NAMES[0];
  return PRESET_PATTERNS[name];
}

export function isStrudelCode(text: string): boolean {
  const trimmed = text.trim();
  return /^(s|note|n|stack|cat|seq|arrange|setcps|silence|pure|fast|slow)\s*[(.`]/i.test(
    trimmed,
  );
}

// A Map keyed by preset name: arbitrary user input can be looked up directly,
// with no cast and no risk of resolving an inherited Object member.
const PRESET_BY_NAME = new Map(Object.entries(PRESET_PATTERNS));

export function parseCliArgs(argv: string[]): StartupOptions {
  const userArgs = argv.filter(Boolean);

  const first = userArgs[0];
  // A bare launch carries no content; startup policy (restored session,
  // then a random preset) belongs to the controller, not the parser.
  if (!first) return {};
  const rest = userArgs.slice(1);
  if (["-c", "--code", "-e", "--eval"].includes(first)) {
    if (rest.length !== 1) {
      return { error: `${first} requires exactly one code argument.` };
    }
    return { initialCode: rest[0], requestPlayback: true };
  }
  if (first === "-p" || first === "--preset") {
    if (rest.length !== 1) {
      return { error: `${first} requires exactly one preset name.` };
    }
    const requestedPreset = rest[0];
    if (!requestedPreset) {
      return { error: `${first} requires exactly one preset name.` };
    }
    const preset = PRESET_BY_NAME.get(requestedPreset.toLowerCase());
    return preset
      ? { initialCode: preset, requestPlayback: true }
      : {
          error: `Unknown preset "${requestedPreset}". Expected one of: ${Object.keys(PRESET_PATTERNS).join(", ")}.`,
        };
  }
  if (first === "--prompt") {
    const prompt = rest.join(" ").trim();
    return prompt
      ? { initialPrompt: prompt, requestPlayback: true }
      : { error: "--prompt requires a prompt." };
  }
  if (first.startsWith("-")) {
    return { error: `Unknown option "${first}".` };
  }

  // Positional argument
  const positional = userArgs.join(" ").trim();
  const lower = positional.toLowerCase();

  // 1. Direct preset name match (e.g. 'lofi', 'basic', 'techno', 'dnb')
  const preset = PRESET_BY_NAME.get(lower);
  if (preset) {
    return { initialCode: preset, requestPlayback: true };
  }

  // 2. Direct Strudel code (e.g. 's("bd hh sd hh")')
  if (isStrudelCode(positional)) {
    return { initialCode: positional, requestPlayback: true };
  }

  // 3. Natural language prompt
  return { initialPrompt: positional, requestPlayback: true };
}
