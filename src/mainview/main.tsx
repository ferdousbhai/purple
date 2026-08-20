import { applyWebAudioShim } from "./audio-shim";

// Apply WebKitGTK / Linux Web Audio fixes before any audio code runs
applyWebAudioShim();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getSystemTheme, log as reportRendererLog } from "./backend";
import { applySystemTheme } from "./system-theme";
import "./app.css";

// Best-effort: tint the palette from the active Omarchy theme. Machines
// without one (or browser-only dev, where there is no shell) keep the
// built-in dark palette.
void getSystemTheme()
  .then(applySystemTheme)
  .catch(() => {});

// Forward actionable renderer diagnostics to the shell's log without mirroring
// Strudel's very noisy informational logs.
for (const level of ["warn", "error"] as const) {
  const orig = console[level];
  console[level] = (...args: unknown[]) => {
    orig.apply(console, args);
    reportRendererLog(level, formatLogArguments(args));
  };
}

/**
 * Render one intercepted `console` call as the line the shell log should carry.
 * This is the boundary: console hands over values of every shape, and nothing
 * downstream sees anything but the finished text.
 */
function formatLogArguments(args: readonly unknown[]): string {
  return args
    .map((value) => {
      if (value instanceof Error) return value.stack ?? value.message;
      // Only values with object identity are worth serializing; primitives and
      // functions read better through String().
      if (Object(value) !== value || value instanceof Function) {
        return String(value);
      }
      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    })
    .join(" ");
}

window.addEventListener("error", (event) => {
  reportRendererLog(
    "error",
    `Uncaught exception: ${event.message} at ${event.filename}:${event.lineno}`,
  );
});

window.addEventListener("unhandledrejection", (event) => {
  reportRendererLog(
    "error",
    `Unhandled rejection: ${formatLogArguments([event.reason])}`,
  );
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
