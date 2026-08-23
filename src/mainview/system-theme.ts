/**
 * Best-effort Omarchy theming.
 *
 * The shell reads three colors from the active Omarchy theme; this maps them
 * onto the palette tokens `app.css` declares in `@theme`, overriding the
 * generic system light/dark palette at the CSS-variable level. Machines
 * without Omarchy (or with an unreadable theme) follow prefers-color-scheme.
 */

import type { SystemTheme } from "../shared/types";

// A neutral mix partner when the theme has no foreground to lean on.
const FALLBACK_MIX = "#808080";

/**
 * The palette tokens a system theme may override. Each is present only when the
 * theme supplies the color it is derived from.
 */
export type SystemThemeVariables = {
  "--color-surface"?: string;
  "--color-surface-light"?: string;
  "--color-surface-lighter"?: string;
  "--color-text"?: string;
  "--color-ink"?: string;
  "--color-accent"?: string;
};

/** The CSS custom properties a system theme overrides, as name → value. */
export function systemThemeVariables(theme: SystemTheme): SystemThemeVariables {
  const variables: SystemThemeVariables = {};
  if (theme.background) {
    const mix = theme.foreground ?? FALLBACK_MIX;
    variables["--color-surface"] = theme.background;
    // Elevated surfaces nudge the base toward the text color, which keeps
    // panel depth working in dark and light themes alike.
    variables["--color-surface-light"] =
      `color-mix(in srgb, ${theme.background} 94%, ${mix})`;
    variables["--color-surface-lighter"] =
      `color-mix(in srgb, ${theme.background} 88%, ${mix})`;
  }
  if (theme.foreground) {
    variables["--color-text"] = theme.foreground;
    variables["--color-ink"] = theme.foreground;
  }
  if (theme.accent) {
    // The dominant accent across the UI; hot/active/warn stay as-is.
    variables["--color-accent"] = theme.accent;
  }
  return variables;
}

/** Apply (or, given null, leave alone) the system theme's palette overrides. */
export function applySystemTheme(theme: SystemTheme | null): void {
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.colorScheme = theme.mode;
  root.style.colorScheme = theme.mode;
  const style = root.style;
  for (const [name, value] of Object.entries(systemThemeVariables(theme))) {
    if (value !== undefined) style.setProperty(name, value);
  }
}
