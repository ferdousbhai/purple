//! Best-effort Omarchy theme colors.
//!
//! Omarchy symlinks the active theme at `omarchy/current/theme` (under
//! `~/.local/state` on current releases, `~/.config` on older ones). This reads
//! a handful of colors from it so the webview can tint its palette; on machines
//! without Omarchy the command returns `None` and the built-in theme stands.
//! Deliberately not a theming engine: three colors and a light/dark flag.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemTheme {
    pub background: Option<String>,
    pub foreground: Option<String>,
    pub accent: Option<String>,
    /// `"light"` or `"dark"`.
    pub mode: String,
}

/// Read the active Omarchy theme, if this machine has one.
#[tauri::command]
pub fn get_system_theme() -> Option<SystemTheme> {
    let theme_dir = find_theme_dir()?;
    load_theme(&theme_dir)
}

/// `omarchy/current/theme` in its known homes, newest layout first.
fn find_theme_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let state_root = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/state"));

    [
        state_root.join("omarchy/current/theme"),
        home.join(".config/omarchy/current/theme"),
    ]
    .into_iter()
    .find(|dir| dir.is_dir())
}

fn load_theme(theme_dir: &Path) -> Option<SystemTheme> {
    // colors.toml is Omarchy's semantic palette; alacritty.toml only carries
    // terminal colors, so it is the fallback for older themes.
    let semantic = read_toml(&theme_dir.join("colors.toml"));
    let alacritty = read_toml(&theme_dir.join("alacritty.toml"));

    let theme = SystemTheme {
        background: pick_color(&[
            lookup(semantic.as_ref(), &["background"]),
            lookup(alacritty.as_ref(), &["colors", "primary", "background"]),
        ]),
        foreground: pick_color(&[
            lookup(semantic.as_ref(), &["foreground"]),
            lookup(alacritty.as_ref(), &["colors", "primary", "foreground"]),
        ]),
        accent: pick_color(&[
            lookup(semantic.as_ref(), &["accent"]),
            lookup(semantic.as_ref(), &["blue"]),
            lookup(alacritty.as_ref(), &["colors", "normal", "blue"]),
        ]),
        mode: detect_mode(semantic.as_ref(), theme_dir),
    };

    // A theme with no usable colors is no theme at all.
    if theme.background.is_none() && theme.foreground.is_none() && theme.accent.is_none() {
        return None;
    }
    Some(theme)
}

fn read_toml(path: &Path) -> Option<toml::Table> {
    let text = std::fs::read_to_string(path).ok()?;
    match text.parse::<toml::Table>() {
        Ok(table) => Some(table),
        Err(error) => {
            log::warn!("[Theme] Could not parse {}: {error}", path.display());
            None
        }
    }
}

fn lookup<'a>(table: Option<&'a toml::Table>, path: &[&str]) -> Option<&'a str> {
    let (first, rest) = path.split_first()?;
    let mut current = table?.get(*first)?;
    for key in rest {
        current = current.get(key)?;
    }
    current.as_str()
}

/// First candidate that is a well-formed `#rgb` / `#rrggbb` hex color. The
/// values end up in CSS custom properties, so anything else is dropped.
fn pick_color(candidates: &[Option<&str>]) -> Option<String> {
    candidates
        .iter()
        .flatten()
        .map(|raw| raw.trim())
        .find(|raw| is_hex_color(raw))
        .map(|raw| raw.to_ascii_lowercase())
}

fn is_hex_color(raw: &str) -> bool {
    let Some(digits) = raw.strip_prefix('#') else {
        return false;
    };
    matches!(digits.len(), 3 | 6) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

fn detect_mode(semantic: Option<&toml::Table>, theme_dir: &Path) -> String {
    let from_colors = lookup(semantic, &["mode"]);
    // Older themes mark light mode with a bare `light.mode` file instead.
    if from_colors == Some("light") || theme_dir.join("light.mode").is_file() {
        "light".into()
    } else {
        "dark".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_hex_colors() {
        assert!(is_hex_color("#1a1b26"));
        assert!(is_hex_color("#abc"));
        assert!(!is_hex_color("1a1b26"));
        assert!(!is_hex_color("#1a1b2"));
        assert!(!is_hex_color("#1a1b2g"));
        assert!(!is_hex_color("url(#x)"));
    }

    #[test]
    fn reads_semantic_colors_first() {
        let dir = std::env::temp_dir().join(format!("purple-theme-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("colors.toml"),
            "mode = \"dark\"\naccent = \"#7AA2F7\"\nbackground = \"#1a1b26\"\nforeground = \"#a9b1d6\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("alacritty.toml"),
            "[colors.primary]\nbackground = \"#000000\"\nforeground = \"#ffffff\"\n",
        )
        .unwrap();

        let theme = load_theme(&dir).unwrap();
        assert_eq!(theme.background.as_deref(), Some("#1a1b26"));
        assert_eq!(theme.foreground.as_deref(), Some("#a9b1d6"));
        assert_eq!(theme.accent.as_deref(), Some("#7aa2f7"));
        assert_eq!(theme.mode, "dark");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn falls_back_to_alacritty_and_light_marker() {
        let dir = std::env::temp_dir().join(format!("purple-theme-alac-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("alacritty.toml"),
            "[colors.primary]\nbackground = \"#fafafa\"\nforeground = \"#101010\"\n[colors.normal]\nblue = \"#0066cc\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("light.mode"), "").unwrap();

        let theme = load_theme(&dir).unwrap();
        assert_eq!(theme.background.as_deref(), Some("#fafafa"));
        assert_eq!(theme.foreground.as_deref(), Some("#101010"));
        assert_eq!(theme.accent.as_deref(), Some("#0066cc"));
        assert_eq!(theme.mode, "light");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn empty_theme_dir_is_no_theme() {
        let dir = std::env::temp_dir().join(format!("purple-theme-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(load_theme(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
