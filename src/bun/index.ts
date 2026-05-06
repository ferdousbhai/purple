import { ApplicationMenu, BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import Anthropic from "@anthropic-ai/sdk";
import type { RiffRPC } from "../shared/rpc-schema";
import type { Message } from "../shared/types";

// ── Claude Streaming ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a music producer assistant for Riff, an AI-powered live-coding music tool.
You generate Strudel (JavaScript-based live-coding) patterns that play in the browser.

## CRITICAL RULES
- Output exactly ONE fenced code block per response, tagged \`\`\`strudel
- The code block must be a single Strudel expression (no variable declarations, no semicolons, no .play())
- The expression is automatically evaluated and played — do NOT call .play()
- Keep responses concise: 1-3 sentences of explanation, then the code block
- When the user asks to modify the current pattern, build on the previous code

## Strudel Quick Reference

### Sound Sources
- \`s("bd sd hh oh")\` — trigger samples by name
- \`note("c3 e3 g3")\` — play notes (letter + octave)
- \`n("0 1 2 3").s("piano")\` — play sample indices from a bank
- Built-in sounds: bd, sd, hh, oh, cp, rim, misc, perc
- Synths: sawtooth, triangle, square, sine
- Instruments via .s(): piano, guitar, bass, flute, etc.

### Mini-Notation (inside quotes)
- \`"a b c d"\` — sequence over one cycle
- \`"a [b c]"\` — subdivide: b and c share one slot
- \`"a*3"\` — repeat 3 times in its slot
- \`"a/2"\` — play every 2 cycles
- \`"<a b c>"\` — alternate each cycle
- \`"a ~ b"\` — rest/silence with ~
- \`"a(3,8)"\` — euclidean rhythm (3 hits in 8 slots)
- \`"a?"\` — 50% chance of playing
- \`"[a,b,c]"\` — play simultaneously (chord/stack)
- \`"a!3"\` — replicate (repeat without speedup)
- \`"a@2"\` — elongate (hold for 2 slots)

### Pattern Factories
- \`cat(pat1, pat2)\` — concatenate patterns (one per cycle)
- \`seq(pat1, pat2)\` — sequence in one cycle
- \`stack(pat1, pat2)\` — layer simultaneously
- \`silence\` — no output
- \`arrange([4, pat1], [2, pat2])\` — arrange over cycles

### Pattern Transformations
- \`.fast(2)\` / \`.slow(2)\` — speed up / slow down
- \`.rev()\` — reverse
- \`.jux(rev)\` — split stereo, modify right channel
- \`.every(4, fast(2))\` — apply transformation every N cycles
- \`.sometimes(fast(2))\` — apply 50% of the time
- \`.ply(2)\` — repeat each event N times
- \`.off(1/8, add(note(7)))\` — offset copy and modify
- \`.add(note(7))\` — transpose/add values

### Audio Effects
- \`.gain(0.8)\` — volume (exponential)
- \`.lpf(800)\` / \`.hpf(200)\` — low/high-pass filter
- \`.vowel("a e i")\` — formant filter
- \`.delay(0.5)\` — delay send amount
- \`.delaytime(0.125)\` — delay time in seconds
- \`.delayfeedback(0.5)\` — delay feedback
- \`.room(0.5)\` — reverb send
- \`.roomsize(2)\` — reverb size
- \`.pan(0.3)\` — stereo pan (0=left, 1=right)
- \`.distort(0.3)\` — distortion
- \`.crush(4)\` — bitcrush
- \`.coarse(8)\` — sample rate reduction
- \`.attack(0.1)\` / \`.decay(0.2)\` / \`.sustain(0.5)\` / \`.release(0.3)\` — ADSR envelope
- \`.phaser(2)\` / \`.phaserdepth(0.5)\` — phaser

### Tonal
- \`.scale("C:minor")\` — constrain to scale
- Scales: major, minor, dorian, mixolydian, pentatonic, blues, etc.

### Tempo
- \`setcps(0.5)\` at the start to set cycles per second (default ~0.5)

## Example Patterns

Lo-fi beat:
\`\`\`strudel
stack(
  s("bd [~ bd] sd [bd sd]").gain(0.9),
  s("[~ hh]*4").gain(0.5).lpf(3000),
  note("[c3 [e3 g3]] [a2 [c3 e3]]")
    .s("sawtooth").lpf(600).gain(0.4)
    .room(0.3).delay(0.2)
)
\`\`\`

Ambient pad:
\`\`\`strudel
note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>")
  .s("sawtooth")
  .lpf(800)
  .attack(0.5).release(2)
  .room(0.8).roomsize(4)
  .delay(0.3).delaytime(0.375)
  .jux(rev)
\`\`\`

Techno:
\`\`\`strudel
stack(
  s("bd*4").gain(1),
  s("~ cp ~ ~").room(0.3),
  s("hh*8").gain("<0.5 0.7>").lpf(4000),
  note("[c2 ~ c2 ~]*2").s("square").lpf(400).decay(0.1)
).every(4, fast(2))
\`\`\`
`;

const client = new Anthropic();
const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "Invalid API key. Check ANTHROPIC_API_KEY in your .env file.";
  if (err instanceof Anthropic.RateLimitError)
    return "Rate limited by the API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError)
    return "Connection failed. Check your internet connection.";
  if (err instanceof Anthropic.APIError)
    return `API error (${err.status}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

// ── RPC & Window Setup ───────────────────────────────────────────────

let activeAbort: AbortController | null = null;

const DEV_SERVER_URL = "http://localhost:5173";

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
    }
  }
  return "views://mainview/index.html";
}

const rpc = BrowserView.defineRPC<RiffRPC>({
  maxRequestTime: 10000,
  handlers: {
    requests: {
      startStream({ messages }) {
        void streamClaude(messages);
        return { ok: true };
      },
      abortStream() {
        activeAbort?.abort();
        activeAbort = null;
        return { ok: true };
      },
    },
    messages: {},
  },
});

const url = await getMainViewUrl();

new BrowserWindow({
  title: "Riff",
  url,
  rpc,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 100,
  },
});

// ── Stream Management ────────────────────────────────────────────────

async function streamClaude(messages: Message[]): Promise<void> {
  activeAbort?.abort();
  const abort = new AbortController();
  activeAbort = abort;

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: messages.map(({ role, content }) => ({ role, content })),
      },
      { signal: abort.signal },
    );

    stream.on("text", (delta) => rpc.send.streamDelta({ delta }));
    await stream.done();

    rpc.send.streamDone({});
  } catch (err) {
    if (abort.signal.aborted) return;
    rpc.send.streamError({ error: friendlyError(err) });
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }
}

// ── Application Menu ─────────────────────────────────────────────────

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

console.log("Riff started!");
