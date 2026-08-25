export interface PromptPreset {
  id: string;
  emoji: string;
  title: string;
  genre: string;
  prompt: string;
}

export interface PromptModifier {
  id: string;
  label: string;
  prompt: string;
}

export interface ShowcasePattern {
  title: string;
  code: string;
}

/**
 * Complete, editable pieces shown to visitors who do not have a session yet.
 * Keep these inside Purple's safe Strudel surface and exercise them against
 * the real engine in packages/ui/src/strudel-examples.test.ts.
 */
export const SHOWCASE_PATTERNS: readonly ShowcasePattern[] = [
  {
    title: "Night Shift House",
    code: `stack(
  s("bd*4, [~ cp]*2, [~ hh]*4").bank("RolandTR909"),
  note("<c2 c2 g1 bb1>").s("sawtooth").lpf(sine.range(300, 1200).slow(8)).gain(.8)
).cpm(126/4)`,
  },
  {
    title: "Dub Signal Garden",
    code: `stack(
  note("[~ [<[d3,a3,f4]!2 [d3,bb3,g4]!2> ~]]*2").s("piano").delay(.5),
  s("bd rim").bank("RolandTR707").delay(.5),
  n("<4 [3@3 4] [<2 0> ~@16] ~>").scale("D4:minor").s("sawtooth").room(.5).gain(.4),
  n("[0 [~ 0] 4 [3 2] [0 ~] [0 ~] <0 2> ~]/2").scale("D2:minor").s("sawtooth,triangle").lpf(800)
).cpm(90/4)`,
  },
  {
    title: "Prismatic Plucks",
    code: `stack(
  n("0 [2 4] <3 5> [~ <4 1>]".add("<0 [0,2,4]>")).scale("C5:minor").s("pluck").room(.4).delay(.125),
  note("c2 [eb3,g3]".add("<0 <1 -1>>")).adsr("[.1 0]:.2:[1 0]").s("bass1").room(.5),
  n("0 1 [2 3] 2").s("jazz").jux(rev)
).cpm(96/4)`,
  },
];

export const PROMPT_PRESETS: readonly PromptPreset[] = [
  { id: "lofi", emoji: "☕", title: "Lo-Fi Chill", genre: "80 BPM • Chill", prompt: "Chill 80 BPM lo-fi beat with soft kick, vinyl snare, warm jazz Rhodes piano chords, and deep sub-bass." },
  { id: "cyberpunk", emoji: "⚡", title: "Cyberpunk Acid", genre: "138 BPM • Industrial", prompt: "138 BPM dark cyberpunk acid with punchy techno kick, 303 sawtooth bassline, and filtered hi-hats." },
  { id: "ambient", emoji: "🌌", title: "Ambient Space", genre: "Slow • Ethereal", prompt: "Slow generative ambient soundscape in D Dorian with lush reverb pads and high bell tones, no drums." },
  { id: "french-house", emoji: "🕺", title: "French House", genre: "124 BPM • Groove", prompt: "124 BPM French electro house with 4-on-the-floor disco drums, funky slap bass, and filtered chord stabs." },
  { id: "liquid-dnb", emoji: "🥁", title: "Liquid DnB", genre: "174 BPM • Fast", prompt: "174 BPM liquid drum & bass with rolling amen break syncopation, warm 808 sub-bass, and lush pads." },
  { id: "chiptune", emoji: "🕹️", title: "8-Bit Chiptune", genre: "145 BPM • Retro", prompt: "Fast 145 BPM retro 8-bit chiptune with playful square wave arpeggios, pulse lead, and snappy blip drums." },
  { id: "afrobeat", emoji: "🌴", title: "Afrobeat Vibes", genre: "105 BPM • Syncopated", prompt: "105 BPM vibrant afrobeat groove with syncopated log drums, kalimba melody, and bouncy bass." },
  { id: "neosoul", emoji: "🎹", title: "Neo-Soul", genre: "88 BPM • Jazzy", prompt: "88 BPM neo-soul groove with swung hip-hop drums, smooth minor 9th electric piano chords, and walking bass." },
];

export const PROMPT_MODIFIERS: readonly PromptModifier[] = [
  { id: "add-drums", label: "🥁 Add Drums", prompt: "Add a punchy drum beat and syncopated percussion to this pattern." },
  { id: "add-bass", label: "🎸 Add Bass", prompt: "Add a deep, groovy bassline that locks in with the root notes." },
  { id: "add-chords", label: "🎹 Add Chords", prompt: "Layer in warm harmonic chord progressions with electric piano or lush pads." },
  { id: "add-lead", label: "✨ Add Lead", prompt: "Add a catchy arpeggiated melodic lead synth hook on top." },
  { id: "filter-sweep", label: "🎛️ Filter Sweep", prompt: "Add a dynamic low-pass filter sweep and subtle breakdown every 4 cycles." },
  { id: "drop-build", label: "🔥 Drop & Build", prompt: "Build tension with fast rolls, cut the kick for 2 beats, and hit a heavy drop." },
  { id: "speed-up", label: "⚡ Faster & Energetic", prompt: "Increase the tempo and energy with faster hi-hats and driving rhythm." },
  { id: "ambient-chill", label: "🌙 Make Ambient", prompt: "Slow the tempo down, mute heavy drums, and make it spacious with long reverb and delay." },
];

const TEMPOS = [76, 84, 92, 108, 122, 128, 134, 140, 165, 174] as const;
const RECIPES = [
  "Lo-fi Jazzhop in Eb major 7th chords with dusty vinyl kick-snare, detuned jazz Rhodes piano, and mellow sub-bass",
  "Dark Cyberpunk Acid in D minor with distorted 303 acid bassline, punchy industrial kick, and fast 16th-note metallic hats",
  "Liquid Drum & Bass in F minor with fast rolling amen break syncopation, deep warm 808 sub, and airy vocal synth pads",
  "French Disco House in A minor with punchy 4-on-the-floor kick, funky filtered disco chords, and bouncy slap bass",
  "Generative Ambient in D Dorian mode with shimmering reverb drone pads, slow stereo delay, and sparse high bell chimes without drums",
  "80s Retro Synthwave in C minor with gated reverb snares, rolling sixteenth-note arpeggiated bass, and warm analog synth brass",
  "Hypnotic Minimal Techno in G minor with heavy sub kick on every beat, subtle offbeat clicks, and resonant low-pass filter sweeps",
  "Tropical Afro House in Bb major with syncopated woodblock and conga polyrhythms, warm marimba melody, and rolling sub groove",
  "Glitch IDM in E minor pentatonic with micro-timed euclidean percussion, bitcrushed bleeps, and unpredictable stuttered bass",
  "Neo-Soul Chillout in Ab minor 9th with swung acoustic rimshots, warm Fender Rhodes chords, and smooth walking synth bass",
] as const;

export function generateRandomPrompt(random = Math.random): string {
  const tempo = TEMPOS[Math.floor(random() * TEMPOS.length)] ?? TEMPOS[0];
  const recipe = RECIPES[Math.floor(random() * RECIPES.length)] ?? RECIPES[0];
  return `${tempo} BPM ${recipe}.`;
}
