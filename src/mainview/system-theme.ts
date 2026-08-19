/**
 * Best-effort Omarchy theming.
 *
 * The shell reads three colors from the active Omarchy theme; this maps them
 * onto the palette tokens `app.css` declares in `@theme`, overriding the
 * built-in dark palette at the CSS-variable level. Machines without Omarchy
 * (or with an unreadable theme) keep the hardcoded look.
 */

import type { SystemTheme } from "../shared/types";

// A neutral mix partner when the theme has no foreground to lean on.
const FALLBACK_MIX = "#808080";

/** The CSS custom properties a system theme overrides, as name → value. */
export function systemThemeVariables(
  theme: SystemTheme,
): Record<string, string> {
  const variables: Record<string, string> = {};
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
  }
  if (theme.accent) {
    // The dominant accent across the UI; the other neons stay as-is.
    variables["--color-neon-cyan"] = theme.accent;
  }
  return variables;
}

/** Apply (or, given null, leave alone) the system theme's palette overrides. */
export function applySystemTheme(theme: SystemTheme | null): void {
  if (!theme) return;
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(systemThemeVariables(theme))) {
    style.setProperty(name, value);
  }
}
