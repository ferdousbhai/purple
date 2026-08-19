import { applyWebAudioShim } from "./audio-shim";

// Apply WebKitGTK / Linux Web Audio fixes before any audio code runs
applyWebAudioShim();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { log as reportRendererLog } from "./backend";
import "./app.css";

// Forward actionable renderer diagnostics to the shell's log without mirroring
// Strudel's very noisy informational logs.
for (const level of ["warn", "error"] as const) {
  const orig = console[level];
  console[level] = (...args: unknown[]) => {
    orig.apply(console, args);
    reportRendererLog(level, args.map(formatLogValue).join(" "));
  };
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value !== "object" || value === null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
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
    `Unhandled rejection: ${formatLogValue(event.reason)}`,
  );
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
