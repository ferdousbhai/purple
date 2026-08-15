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

export const PROMPT_PRESETS: readonly PromptPreset[] = [
  {
    id: "lofi",
    emoji: "☕",
    title: "Lo-Fi Chill",
    genre: "80 BPM • Chill",
    prompt:
      "Chill 80 BPM lo-fi beat with soft kick, vinyl snare, warm jazz Rhodes piano chords, and deep sub-bass.",
  },
  {
    id: "cyberpunk",
    emoji: "⚡",
    title: "Cyberpunk Acid",
    genre: "138 BPM • Industrial",
    prompt:
      "138 BPM dark cyberpunk acid with punchy techno kick, 303 sawtooth bassline, and filtered hi-hats.",
  },
  {
    id: "ambient",
    emoji: "🌌",
    title: "Ambient Space",
    genre: "Slow • Ethereal",
    prompt:
      "Slow generative ambient soundscape in D Dorian with lush reverb pads and high bell tones, no drums.",
  },
  {
    id: "french-house",
    emoji: "🕺",
    title: "French House",
    genre: "124 BPM • Groove",
    prompt:
      "124 BPM French electro house with 4-on-the-floor disco drums, funky slap bass, and filtered chord stabs.",
  },
  {
    id: "liquid-dnb",
    emoji: "🥁",
    title: "Liquid DnB",
    genre: "174 BPM • Fast",
    prompt:
      "174 BPM liquid drum & bass with rolling amen break syncopation, warm 808 sub-bass, and lush pads.",
  },
  {
    id: "chiptune",
    emoji: "🕹️",
    title: "8-Bit Chiptune",
    genre: "145 BPM • Retro",
    prompt:
      "Fast 145 BPM retro 8-bit chiptune with playful square wave arpeggios, pulse lead, and snappy blip drums.",
  },
  {
    id: "afrobeat",
    emoji: "🌴",
    title: "Afrobeat Vibes",
    genre: "105 BPM • Syncopated",
    prompt:
      "105 BPM vibrant afrobeat groove with syncopated log drums, kalimba melody, and bouncy bass.",
  },
  {
    id: "neosoul",
    emoji: "🎹",
    title: "Neo-Soul",
    genre: "88 BPM • Jazzy",
    prompt:
      "88 BPM neo-soul groove with swung hip-hop drums, smooth minor 9th electric piano chords, and walking bass.",
  },
];

export const PROMPT_MODIFIERS: readonly PromptModifier[] = [
  {
    id: "add-drums",
    label: "🥁 Add Drums",
    prompt: "Add a punchy drum beat and syncopated percussion to this pattern.",
  },
  {
    id: "add-bass",
    label: "🎸 Add Bass",
    prompt: "Add a deep, groovy bassline that locks in with the root notes.",
  },
  {
    id: "add-chords",
    label: "🎹 Add Chords",
    prompt: "Layer in warm harmonic chord progressions with electric piano or lush pads.",
  },
  {
    id: "add-lead",
    label: "✨ Add Lead",
    prompt: "Add a catchy arpeggiated melodic lead synth hook on top.",
  },
  {
    id: "filter-sweep",
    label: "🎛️ Filter Sweep",
    prompt: "Add a dynamic low-pass filter sweep and subtle breakdown every 4 cycles.",
  },
  {
    id: "drop-build",
    label: "🔥 Drop & Build",
    prompt: "Build tension with fast rolls, cut the kick for 2 beats, and hit a heavy drop.",
  },
  {
    id: "speed-up",
    label: "⚡ Faster & Energetic",
    prompt: "Increase the tempo and energy with faster hi-hats and driving rhythm.",
  },
  {
    id: "ambient-chill",
    label: "🌙 Make Ambient",
    prompt: "Slow the tempo down, mute heavy drums, and make it spacious with long reverb and delay.",
  },
];

const TEMPOS = [76, 84, 92, 108, 122, 128, 134, 140, 165, 174];

const GENRE_RECIPES = [
  {
    genre: "Lo-fi Jazzhop",
    scale: "Eb major 7th chords",
    instruments: "dusty vinyl kick-snare, detuned jazz Rhodes piano, and mellow sub-bass",
  },
  {
    genre: "Dark Cyberpunk Acid",
    scale: "D minor",
    instruments: "distorted 303 acid bassline, punchy industrial kick, and fast 16th-note metallic hats",
  },
  {
    genre: "Liquid Drum & Bass",
    scale: "F minor",
    instruments: "fast rolling amen break syncopation, deep warm 808 sub, and airy vocal synth pads",
  },
  {
    genre: "French Disco House",
    scale: "A minor",
    instruments: "punchy 4-on-the-floor kick, funky filtered disco chords, and bouncy slap bass",
  },
  {
    genre: "Generative Ambient",
    scale: "D Dorian mode",
    instruments: "shimmering reverb drone pads, slow stereo delay, and sparse high bell chimes without drums",
  },
  {
    genre: "80s Retro Synthwave",
    scale: "C minor",
    instruments: "gated reverb snares, rolling sixteenth-note arpeggiated bass, and warm analog synth brass",
  },
  {
    genre: "Hypnotic Minimal Techno",
    scale: "G minor",
    instruments: "heavy sub kick on every beat, subtle offbeat clicks, and resonant low-pass filter sweeps",
  },
  {
    genre: "Tropical Afro House",
    scale: "Bb major",
    instruments: "syncopated woodblock and conga polyrhythms, warm marimba melody, and rolling sub groove",
  },
  {
    genre: "Glitch IDM",
    scale: "E minor pentatonic",
    instruments: "micro-timed euclidean percussion, bitcrushed bleeps, and unpredictable stuttered bass",
  },
  {
    genre: "Neo-Soul Chillout",
    scale: "Ab minor 9th",
    instruments: "swung acoustic rimshots, warm Fender Rhodes chords, and smooth walking synth bass",
  },
];

function getRandomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export function generateRandomPrompt(): string {
  const tempo = getRandomElement(TEMPOS);
  const recipe = getRandomElement(GENRE_RECIPES);

  return `${tempo} BPM ${recipe.genre} in ${recipe.scale} with ${recipe.instruments}.`;
}
