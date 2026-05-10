#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && /bin/pwd)"
cd "$repo_root"

bun run package:linux

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
"build/release/riff-${version}-linux-x64/install.sh"
