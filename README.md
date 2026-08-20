# Purple

Purple is an app for making music with AI. It ships two ways: a native desktop app, and a web app at [riff-web.ferdousbd.workers.dev](https://riff-web.ferdousbd.workers.dev) — same instrument, same shared engine.

You type a plain-English music idea, such as "make a slow lo-fi drum loop with warm chords." Purple asks Gemini to write a Strudel music pattern, puts that pattern in the editor, and plays it through your computer speakers.

The app has two main areas:

- The left side is the music code editor and play controls.
- The right side is the chat where you ask for music or changes.

## What You Need

- A Linux computer (Arch, Omarchy, Ubuntu, Fedora — anything with a system webview). macOS and Windows build from source too, but the packaging below is Linux-first.
- An internet connection.
- A Google Gemini API key.

## Install On Arch Or Omarchy

Purple builds into a single native binary and installs like any other Arch package.

```bash
git clone https://github.com/ferdousbhai/purple.git
cd purple/packaging
makepkg -si
```

That installs `/usr/bin/purple`, a desktop entry, and the app icons. Open the
Omarchy launcher with `Super + Space` and search for `Purple`, or run `purple` in a
terminal. Updates come with `omarchy-update` once the package is in the AUR.

Purple needs these runtime packages, which `makepkg` installs for you:
`webkit2gtk-4.1`, `gtk3`, `gst-plugins-base`, `gst-plugins-good`, `libsecret`.

## Install Without A Package Manager

From a checkout, this builds Purple and installs it for the current user only:

```bash
./scripts/install-user.sh
```

It puts the binary in `~/.local/bin/purple`, adds the desktop entry and icons
under `~/.local/share`, and refreshes the Omarchy launcher when it is present.

## Build From Source For Development

Purple needs [Rust](https://rustup.rs) (1.85 or newer), Node.js 22, and pnpm 10.

```bash
pnpm install
pnpm run dev
```

`pnpm run dev` starts Vite and the Rust shell together, with hot reload for the
interface. A desktop window named Purple opens. Close the window to stop it.

On Debian or Ubuntu, install the webview development packages first:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
```

## Add Your Google Gemini API Key

Purple needs a Google Gemini API key so it can ask Gemini to generate music patterns.

Create an API key in Google AI Studio. In Purple, click `KEY`, paste the API key,
and save it. Purple stores it in your system keyring (GNOME Keyring, KWallet, or
whatever provides the Secret Service on your machine), not in a plain file.

If you already export `GEMINI_API_KEY` in your shell, Purple uses that.

If you try to send a prompt before adding a key, Purple opens the key box
automatically and keeps your prompt in the chat input.

## Make Some Music

In the chat box on the right, type a request like:

```text
Make a mellow lo-fi beat with soft drums and jazzy chords.
```

Press `Enter`.

Gemini will reply with a Strudel pattern. Purple will place the pattern in the editor on the left. Use the play controls, or press `Ctrl+Enter`, to hear it.

You can ask for changes in normal language:

```text
Make it faster and add a bassline.
```

```text
Make the drums simpler and the chords darker.
```

## Purple On The Web

`apps/web` is the same instrument as a local-first web app on Cloudflare
Workers. There are no accounts and no server-side storage or inference: your
Gemini key, your chat, and your saved patterns live only in your browser, and
generation requests go straight from the browser to Google.

```bash
pnpm run web:dev      # dev server at localhost:3000
pnpm run web:deploy   # build + wrangler deploy
```

## Command Line Usage

With no arguments, Purple opens a random built-in musical recipe. It waits for
you to click `START`, because a webview only lets sound begin after a real
click or keypress.

```bash
# Direct Strudel live-coding pattern (click START after launch)
purple 's("bd hh sd hh")'
purple 'note("c3 e3 g3 b3").s("sawtooth").lpf(800).room(0.5)'

# Built-in presets
purple lofi
purple techno
purple ambient
purple dnb
purple chiptune
purple basic

# Natural language prompt (generates the pattern, then asks you to start audio)
purple "make a dark cyberpunk acid techno groove"

# Explicit flags
purple --preset basic
purple --code 's("bd*4")'
purple --prompt "make a sparse ambient pattern"
```

Purple runs as a single instance. Running `purple lofi` while Purple is already open
focuses the existing window and loads that pattern instead of starting a second
copy.

## Keyboard Shortcuts

- `Enter`: send a chat message.
- `Ctrl+Enter`: play or re-run the pattern in the editor.
- `Ctrl+.`: stop playback.
- `Escape`: stop Gemini while it is still writing a response.

## Troubleshooting

### "Invalid API key"

Click `KEY`, clear the saved app key, paste a valid Google Gemini API key, and save
it again.

### The app opens, but no sound plays

- Make sure your computer volume is up.
- Make sure the correct speakers or headphones are selected.
- For a pattern loaded from the command line, click `START`. Webviews only let sound begin after a real click or keypress.
- Try a simple prompt such as `make a basic drum beat`.

### Linux: the window is blank or transparent

WebKitGTK's DMABUF renderer draws nothing on several Mesa drivers, so Purple turns
it off by default. If your machine handles it well and you want the accelerated
path, start Purple with:

```bash
PURPLE_GPU=1 purple
```

If a blank window persists, add `WEBKIT_DISABLE_COMPOSITING_MODE=1` to disable
more of the accelerated path.

### The app says it was rate limited

The Gemini API is temporarily refusing more requests. Wait a minute and try again.

### The app says it cannot connect

Check your internet connection, then restart Purple.

## Developer Commands

```bash
pnpm run dev        # Vite + the Rust shell, with hot reload
pnpm run dev:webview  # Vite alone, for browser-only interface work
pnpm run build      # Release binary at src-tauri/target/release/purple
pnpm run test       # Interface and shared-logic tests
pnpm run test:rust  # Shell tests
pnpm run typecheck  # TypeScript check
pnpm run check      # Everything above plus a production web build
```

The logs from a running app are in `~/.local/share/dev.ferdous.purple/logs/`.

## Technology Used

- Tauri 2 for the native window and the Rust shell.
- React and Tailwind CSS for the interface.
- CodeMirror for the code editor.
- Strudel for webview-based music playback.
- The Gemini Interactions API for music pattern generation.
