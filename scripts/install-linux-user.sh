#!/usr/bin/env bash
set -euo pipefail

APP_ID="dev.ferdous.riff"
APP_NAME="Riff"

usage() {
  printf '%s\n' \
    "Usage: ./install.sh [--install-deps]" \
    "" \
    "Installs Riff for the current Linux user." \
    "" \
    "Options:" \
    "  --install-deps   On Arch/Omarchy, install WebKitGTK and GStreamer packages with pacman." \
    "  -h, --help       Show this help."
}

install_deps=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-deps)
      install_deps=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && /bin/pwd)"
setup_archive="${script_dir}/riff-Setup.tar.gz"

if [ ! -f "$setup_archive" ]; then
  printf 'Could not find the Riff setup archive next to this installer.\n' >&2
  printf 'Expected archive: %s\n' "$setup_archive" >&2
  exit 1
fi

if [ "$(uname -s)" != "Linux" ]; then
  printf 'This installer is for Linux only.\n' >&2
  exit 1
fi

if [ "$(uname -m)" != "x86_64" ]; then
  printf 'This build is for x86_64 Linux. Detected: %s\n' "$(uname -m)" >&2
  exit 1
fi

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
bin_home="${HOME}/.local/bin"
app_dir="${data_home}/${APP_ID}/stable/app"
legacy_install_dir="${data_home}/riff"
apps_dir="${data_home}/applications"
icons_dir="${data_home}/icons/hicolor/scalable/apps"
desktop_file="${apps_dir}/${APP_ID}.desktop"
wrapper="${bin_home}/riff"
icon_source="${script_dir}/riff.svg"
icon_target="${icons_dir}/riff.svg"

missing_arch_packages=()
if command -v pacman >/dev/null 2>&1; then
  for package in webkit2gtk-4.1 gst-plugins-base gst-plugins-good; do
    if ! pacman -Q "$package" >/dev/null 2>&1; then
      missing_arch_packages+=("$package")
    fi
  done
fi

if [ "${#missing_arch_packages[@]}" -gt 0 ]; then
  if [ "$install_deps" = true ]; then
    sudo pacman -S --needed "${missing_arch_packages[@]}"
  else
    printf 'Riff may need these Arch/Omarchy runtime packages:\n'
    printf '  sudo pacman -S --needed'
    printf ' %s' "${missing_arch_packages[@]}"
    printf '\n\n'
  fi
fi

mkdir -p "$bin_home" "$apps_dir" "$icons_dir"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
tar -xzf "$setup_archive" -C "$tmp_dir"
if [ ! -x "${tmp_dir}/installer" ]; then
  printf 'The setup archive did not contain an executable installer.\n' >&2
  exit 1
fi
"${tmp_dir}/installer"

if [ ! -x "${app_dir}/bin/launcher" ]; then
  printf 'Riff was not installed where expected.\n' >&2
  printf 'Expected executable: %s\n' "${app_dir}/bin/launcher" >&2
  exit 1
fi

if [ -d "$legacy_install_dir" ] && [ -f "${legacy_install_dir}/Resources/metadata.json" ]; then
  rm -rf "$legacy_install_dir"
fi

if [ -f "$icon_source" ]; then
  cp -f "$icon_source" "$icon_target"
fi

cat > "$wrapper" <<EOF
#!/usr/bin/env bash
cd "$app_dir"
arg_index=0
for arg in "\$@"; do
  export "RIFF_STARTUP_ARG_\${arg_index}=\${arg}"
  arg_index=\$((arg_index + 1))
done
export RIFF_STARTUP_ARGC="\${arg_index}"
exec "$app_dir/bin/launcher"
EOF
chmod +x "$wrapper"

cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
GenericName=AI Music App
Comment=AI-powered music production
Exec="$wrapper"
Icon=$icon_target
Terminal=false
Categories=Audio;AudioVideo;Music;
Keywords=music;audio;ai;strudel;
StartupNotify=true
EOF
chmod 0644 "$desktop_file"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop_file"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "${data_home}/icons/hicolor" >/dev/null 2>&1 || true
fi

if command -v omarchy-refresh-walker >/dev/null 2>&1; then
  omarchy-refresh-walker >/dev/null 2>&1 || true
fi

printf 'Riff installed for this user.\n'
printf 'Run it with: %s\n' "$wrapper"
printf 'Or open the Omarchy launcher with Super + Space and search for Riff.\n'
