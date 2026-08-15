#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && /bin/pwd)"
cd "$repo_root"

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
release_root="build/release"
release_name="riff-${version}-linux-x64"
stage="${release_root}/${release_name}"
archive="${release_root}/${release_name}.tar.gz"

pnpm install --frozen-lockfile
pnpm run build:stable

rm -rf "$stage" "$archive" "${archive}.sha256"
mkdir -p "$stage"

cp artifacts/stable-linux-x64-riff-Setup.tar.gz "$stage/riff-Setup.tar.gz"
cp scripts/install-linux-user.sh "$stage/install.sh"
cp assets/riff.svg "$stage/riff.svg"
cp LICENSE THIRD_PARTY_NOTICES.md "$stage/"
cp node_modules/@strudel/core/LICENSE "$stage/STRUDEL-AGPL-3.0.txt"
chmod +x "$stage/install.sh"

cat > "$stage/README.txt" <<EOF
Riff ${version} for Linux x86_64

Install for the current user:

  ./install.sh

On Omarchy, open the launcher with Super + Space and search for Riff.

If the app does not open or audio does not work on Arch/Omarchy, install
runtime dependencies during install:

  ./install.sh --install-deps

Or install them manually:

  sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-base gst-plugins-good

Riff requires a Google Gemini API key. See the project README for setup details.
EOF

tar -C "$release_root" -czf "$archive" "$release_name"
(cd "$release_root" >/dev/null && sha256sum "$(basename -- "$archive")") > "${archive}.sha256"

printf 'Created %s\n' "$archive"
printf 'Created %s\n' "${archive}.sha256"
