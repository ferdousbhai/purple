import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  logLevel: "error",
  resolve: {
    alias: {
      // @strudel/core/repl.mjs imports @kabelsalat/web, which only resolves in
      // a browser bundle. Tests never use the kabelsalat integration.
      "@kabelsalat/web": fileURLToPath(
        new URL("./test/stubs/kabelsalat-web.mjs", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        // Externalized deps resolve @kabelsalat/web natively and bypass the
        // alias above; inlining routes the strudel packages through Vite.
        inline: [/@strudel\//],
      },
    },
  },
});
