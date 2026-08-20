#!/usr/bin/env bash
# Build Riff and install it for the current user (no root, no package manager).
# On Arch/Omarchy prefer the package: makepkg -si from packaging/PKGBUILD.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
cd "$repo_root"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
bin_dir="$HOME/.local/bin"
apps_dir="${data_home}/applications"
icons_dir="${data_home}/icons/hicolor"

if [ "$(uname -s)" != "Linux" ]; then
  echo "This installer is for Linux." >&2
  exit 1
fi

if command -v pacman >/dev/null 2>&1; then
  missing=()
  for package in webkit2gtk-4.1 gtk3 gst-plugins-base gst-plugins-good libsecret; do
    pacman -Q "$package" >/dev/null 2>&1 || missing+=("$package")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'Install the runtime dependencies first:\n  sudo pacman -S --needed %s\n\n' "${missing[*]}" >&2
    exit 1
  fi
fi

echo "[riff] building..."
pnpm install --frozen-lockfile
pnpm run build:webview
cargo build --release --locked --manifest-path src-tauri/Cargo.toml

echo "[riff] installing to ${bin_dir}..."
install -Dm755 src-tauri/target/release/riff "${bin_dir}/riff"
install -Dm644 packaging/riff.desktop "${apps_dir}/riff.desktop"
install -Dm644 assets/riff.svg "${icons_dir}/scalable/apps/riff.svg"
install -Dm644 src-tauri/icons/32x32.png "${icons_dir}/32x32/apps/riff.png"
install -Dm644 src-tauri/icons/64x64.png "${icons_dir}/64x64/apps/riff.png"
install -Dm644 src-tauri/icons/128x128.png "${icons_dir}/128x128/apps/riff.png"
install -Dm644 "src-tauri/icons/128x128@2x.png" "${icons_dir}/256x256/apps/riff.png"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$icons_dir" >/dev/null 2>&1 || true
command -v omarchy-refresh-walker >/dev/null 2>&1 && omarchy-refresh-walker >/dev/null 2>&1 || true

echo "[riff] installed. Run 'riff', or search for Riff in the launcher."
case ":$PATH:" in
  *":${bin_dir}:"*) ;;
  *) echo "[riff] note: ${bin_dir} is not on your PATH." ;;
esac
