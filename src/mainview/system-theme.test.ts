import { describe, expect, it } from "vitest";
import { systemThemeVariables } from "./system-theme";
import type { SystemTheme } from "../shared/types";

function theme(overrides: Partial<SystemTheme>): SystemTheme {
  return {
    background: null,
    foreground: null,
    accent: null,
    mode: "dark",
    ...overrides,
  };
}

describe("systemThemeVariables", () => {
  it("maps a full theme onto the palette tokens", () => {
    const variables = systemThemeVariables(
      theme({
        background: "#1a1b26",
        foreground: "#a9b1d6",
        accent: "#7aa2f7",
      }),
    );

    expect(variables["--color-surface"]).toBe("#1a1b26");
    expect(variables["--color-surface-light"]).toBe(
      "color-mix(in srgb, #1a1b26 94%, #a9b1d6)",
    );
    expect(variables["--color-surface-lighter"]).toBe(
      "color-mix(in srgb, #1a1b26 88%, #a9b1d6)",
    );
    expect(variables["--color-text"]).toBe("#a9b1d6");
    expect(variables["--color-white"]).toBe("#a9b1d6");
    expect(variables["--color-neon-cyan"]).toBe("#7aa2f7");
  });

  it("only overrides tokens the theme actually provides", () => {
    const variables = systemThemeVariables(theme({ accent: "#0066cc" }));
    expect(variables).toEqual({ "--color-neon-cyan": "#0066cc" });
  });

  it("derives elevated surfaces from a neutral mix without a foreground", () => {
    const variables = systemThemeVariables(theme({ background: "#fafafa" }));
    expect(variables["--color-surface-light"]).toBe(
      "color-mix(in srgb, #fafafa 94%, #808080)",
    );
    expect(variables["--color-text"]).toBeUndefined();
  });
});
