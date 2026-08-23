import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sameOriginSuperdoughWorklet } from "./vite/superdough-worklet";

// Tauri drives this build: it starts `vite` for development and consumes
// `dist/` for release, so keep the dev server fixed and quiet.
export default defineConfig({
  plugins: [react(), tailwindcss(), sameOriginSuperdoughWorklet()],
  root: "src/mainview",
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    root: ".",
    // apps/web runs its own vitest (web:check); everything else runs here.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
