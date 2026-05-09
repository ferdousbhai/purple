# Riff

Riff is a desktop app for making music with AI.

You type a plain-English music idea, such as "make a slow lo-fi drum loop with warm chords." Riff asks Claude to write a Strudel music pattern, puts that pattern in the editor, and plays it through your computer speakers.

The app has two main areas:

- The left side is the music code editor and play controls.
- The right side is the chat where you ask for music or changes.

## What You Need

Before you run Riff, you need:

- A computer with macOS, Linux, or Windows.
- An internet connection.
- A Claude API key from Anthropic.
- Bun, which is the tool this app uses to install and run itself.

If you do not already have Bun installed, open a terminal and run the command for your computer.

On macOS or Linux:

```bash
curl -fsSL https://bun.com/install | bash
```

On Windows, open PowerShell and run:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

Close and reopen your terminal after installing Bun. Then check that it worked:

```bash
bun --version
```

If that prints a version number, Bun is ready.

## 1. Open This Folder In A Terminal

Open a terminal in the Riff project folder.

Use `cd` to move into the folder where you downloaded or cloned Riff.

For example:

```bash
cd path/to/riff
```

## 2. Install Riff

Run this command once:

```bash
bun install
```

This downloads the pieces Riff needs. It may take a few minutes the first time.

## 3. Add Your Claude API Key

Riff needs an Anthropic API key so it can ask Claude to generate music patterns.

1. Create an API key in your Anthropic account.
2. In this project folder, make a copy of `.env.example` named `.env`.

Run:

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor. It will look like this:

```text
ANTHROPIC_API_KEY=sk-ant-...
# CLAUDE_MODEL=claude-sonnet-4-6
```

Replace `sk-ant-...` with your real API key.

For example:

```text
ANTHROPIC_API_KEY=sk-ant-your-real-key-goes-here
# CLAUDE_MODEL=claude-sonnet-4-6
```

Save the file.

Do not share your `.env` file or API key with anyone.

## 4. Start Riff

Run:

```bash
bun run start
```

A desktop window named Riff should open.

To stop Riff later, close the app window. If the terminal is still running the app, click the terminal and press `Ctrl+C`.

## 5. Make Some Music

In the chat box on the right, type a request like:

```text
Make a mellow lo-fi beat with soft drums and jazzy chords.
```

Press `Enter`.

Claude will reply with a Strudel pattern. Riff will place the pattern in the editor on the left. Use the play controls, or press `Ctrl+Enter`, to hear it.

You can ask for changes in normal language:

```text
Make it faster and add a bassline.
```

```text
Make the drums simpler and the chords darker.
```

## Keyboard Shortcuts

- `Enter`: send a chat message.
- `Ctrl+Enter`: play or re-run the pattern in the editor.
- `Ctrl+.`: stop playback.
- `Escape`: stop Claude while it is still writing a response.

## Troubleshooting

### "bun: command not found"

Bun is not installed, or your terminal has not picked it up yet.

Try closing and reopening the terminal. Then run:

```bash
bun --version
```

If it still fails, install Bun again.

On macOS or Linux:

```bash
curl -fsSL https://bun.com/install | bash
```

On Windows, use PowerShell:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

### "Invalid API key"

Check your `.env` file.

Make sure the line starts with `ANTHROPIC_API_KEY=` and that your real key comes immediately after the equals sign:

```text
ANTHROPIC_API_KEY=sk-ant-your-real-key-goes-here
```

After changing `.env`, stop Riff and start it again with:

```bash
bun run start
```

### The app opens, but no sound plays

Try these checks:

- Make sure your computer volume is up.
- Make sure the correct speakers or headphones are selected.
- Click inside the Riff window once, then press `Ctrl+Enter` again. Browsers and webviews sometimes require a user action before audio can start.
- Try a simple prompt such as `make a basic drum beat`.

### Linux: the app does not open or audio does not work

Riff uses your system webview and audio libraries. On Linux, you may need WebKitGTK and GStreamer packages.

On Arch Linux, run:

```bash
yay -S webkit2gtk gst-plugins-base gst-plugins-good
```

If your system does not use `yay`, install the matching `webkit2gtk`, `gst-plugins-base`, and `gst-plugins-good` packages with your normal package manager.

### The app says it was rate limited

The Claude API is temporarily refusing more requests. Wait a minute and try again.

### The app says it cannot connect

Check your internet connection, then restart Riff.

## Developer Commands

Most users only need `bun install` and `bun run start`.

For development:

```bash
bun run start        # Build and launch the desktop app
bun run dev          # Launch Electrobun with file watching
bun run dev:hmr      # Launch with Vite hot reload
bun run test         # Run tests
bun run build:canary # Build a canary release
bun run build:stable # Build a stable release
```

## Technology Used

- Electrobun for the desktop app window.
- React and Tailwind CSS for the interface.
- CodeMirror for the code editor.
- Strudel for browser-based music playback.
- Claude through the Anthropic API for music pattern generation.
