import { applyWebAudioShim } from "./audio-shim";

// Apply WebKitGTK / Linux Web Audio fixes before any audio code runs
applyWebAudioShim();

import { electroview } from "./rpc"; // Initialize Electrobun RPC before React renders
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./app.css";

// Forward actionable renderer diagnostics without mirroring Strudel's very noisy
// informational logs across the RPC boundary.
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

function reportRendererLog(level: "warn" | "error", message: string): void {
  void electroview.rpc?.request.log({ level, message }).catch(() => {});
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
