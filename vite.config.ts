import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri drives this build: it starts `vite` for development and consumes
// `dist/` for release, so keep the dev server fixed and quiet.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/mainview",
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: "allow-extension",
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom)[\\/]/,
              priority: 30,
            },
            {
              name: "editor-vendor",
              test: /node_modules[\\/](?:@codemirror|@uiw)[\\/]/,
              maxSize: 450_000,
              priority: 20,
            },
            {
              name: "strudel-audio",
              test: /node_modules[\\/](?:superdough|supradough)[\\/]/,
              priority: 28,
            },
            {
              name: "strudel-core",
              test: /node_modules[\\/]@strudel[\\/](?:core|mini|tonal|transpiler)[\\/]/,
              priority: 26,
            },
            {
              name: "strudel-web",
              test: /node_modules[\\/]@strudel[\\/](?:web|webaudio|draw)[\\/]/,
              priority: 24,
            },
            {
              name: "music-vendor",
              test: /node_modules[\\/](?:@tonaljs|webmidi)[\\/]/,
              priority: 20,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              maxSize: 450_000,
              priority: 10,
            },
          ],
        },
      },
    },
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
