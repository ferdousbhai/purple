# Purple

Purple is an app for making music with AI. It ships two ways: a native desktop app, and a web app at [soundspurple.com](https://soundspurple.com) — same instrument, same shared engine.

You type a plain-English music idea, such as "make a slow lo-fi drum loop with warm chords." Purple asks Gemini to write a Strudel music pattern, puts that pattern in the editor, and plays it through your computer speakers.

The app has two main areas:

- The left side is the music code editor and play controls.
- The right side is the chat where you ask for music or changes.

## What You Need

- A Linux computer (Arch, Omarchy, Ubuntu, Fedora — anything with a system webview). macOS and Windows build from source too, but the packaging below is Linux-first.
- An internet connection.
- A Google Gemini API key.

## Install On Arch Or Omarchy

Until the first `purple-music` release and AUR package are published, install the
current checkout for your user:

```bash
git clone https://github.com/ferdousbhai/purple.git
cd purple
./scripts/install-user.sh
```

That installs `~/.local/bin/purple-music`, a desktop entry, and the app icons.
Open the Omarchy launcher with `Super + Space` and search for `Purple`, or run
`purple-music` in a terminal.

The repository includes an Arch `PKGBUILD` release template and a signed-tag
workflow. The next release will bind that template to the matching tag and
verified source checksum. After `purple-music` is published to the AUR, install
and update it with your normal AUR tooling instead of cloning this repository.

Purple needs these runtime packages, which the package or installer checks for:
`webkit2gtk-4.1`, `gtk3`, `gst-plugins-base`, and `gst-plugins-good`. A Secret
Service provider such as GNOME Keyring, KWallet, or KeePassXC is recommended.

## Install Without A Package Manager

From a checkout, this builds Purple and installs it for the current user only:

```bash
./scripts/install-user.sh
```

It puts the binary in `~/.local/bin/purple-music`, adds the desktop entry and icons
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
whatever provides the Secret Service on your machine). If no credential store is
available, Purple falls back to an unencrypted owner-only file at
`$XDG_CONFIG_HOME/purple/config.json` (normally
`~/.config/purple/config.json`; `0600`, inside a `0700` directory) and logs that
fallback.

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
purple-music 's("bd hh sd hh")'
purple-music 'note("c3 e3 g3 b3").s("sawtooth").lpf(800).room(0.5)'

# Built-in presets
purple-music lofi
purple-music techno
purple-music ambient
purple-music dnb
purple-music chiptune
purple-music basic

# Natural language prompt (generates the pattern, then asks you to start audio)
purple-music "make a dark cyberpunk acid techno groove"

# Explicit flags
purple-music --preset basic
purple-music --code 's("bd*4")'
purple-music --prompt "make a sparse ambient pattern"
```

Purple runs as a single instance. Running `purple-music lofi` while Purple is already open
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

Purple uses WebKitGTK's accelerated renderer by default. Some Mesa driver and
WebKitGTK combinations instead produce a blank or transparent window. If that
happens, disable the DMABUF renderer for Purple:

```bash
PURPLE_DISABLE_DMABUF=1 purple-music
```

If a blank window persists, also set `WEBKIT_DISABLE_COMPOSITING_MODE=1` to
disable more of the accelerated path.

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

The logs from a running app are in
`~/.local/share/com.soundspurple.Purple/logs/` by default.

## Licensing

Purple-authored source is MIT licensed. Distributed application bundles also
incorporate AGPL-3.0-or-later Strudel and Kabelsalat components. See
`THIRD_PARTY_NOTICES.md` and `LICENSE-AGPL-3.0-or-later` for the component list,
source locations, and license terms.

## Technology Used

- Tauri 2 for the native window and the Rust shell.
- React and Tailwind CSS for the interface.
- CodeMirror for the code editor.
- Strudel for webview-based music playback.
- The Gemini Interactions API for music pattern generation.
