import { Buffer } from "node:buffer";
import type { Plugin, ResolvedConfig } from "vite";

const DEV_WORKLET_PATH = "/__purple/superdough-worklets.js";
const SUPERDOUGH_MODULE_SUFFIX = "/superdough/dist/index.mjs";
const EMBEDDED_WORKLET =
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*"data:text\/javascript;base64,([A-Za-z0-9+/=]+)"/;

/**
 * Superdough embeds its main AudioWorklet as a data URL. A strict script-src
 * blocks that URL, so emit the exact upstream bytes as a same-origin asset and
 * rewrite only that static module reference. Generated `dough()` worklets stay
 * blocked and are not exposed by Purple's safe expression language.
 */
export function sameOriginSuperdoughWorklet(): Plugin {
  let config: ResolvedConfig | undefined;
  let workletSource: string | undefined;
  let emittedWorklet = false;

  return {
    name: "purple-same-origin-superdough-worklet",
    enforce: "pre",
    config: () => ({ optimizeDeps: { exclude: ["superdough"] } }),
    configResolved: (resolved) => {
      config = resolved;
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== DEV_WORKLET_PATH) {
          next();
          return;
        }
        if (!workletSource) {
          response.statusCode = 503;
          response.end("Superdough worklet has not been extracted yet.");
          return;
        }
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(workletSource);
      });
    },
    transform(code, id) {
      if (!id.split("?")[0]?.endsWith(SUPERDOUGH_MODULE_SUFFIX)) return;
      const match = EMBEDDED_WORKLET.exec(code);
      if (!match?.[1] || !match[2]) {
        this.error("Could not find superdough's embedded AudioWorklet.");
      }

      workletSource = Buffer.from(match[2], "base64").toString("utf8");
      if (!workletSource.includes("registerProcessor")) {
        this.error("Superdough's embedded AudioWorklet is not a processor module.");
      }

      let workletUrl: string;
      if (config?.command === "serve") {
        workletUrl = JSON.stringify(DEV_WORKLET_PATH);
      } else {
        const reference = this.emitFile({
          type: "asset",
          name: "superdough-worklets.js",
          source: workletSource,
        });
        emittedWorklet = true;
        workletUrl = `import.meta.ROLLUP_FILE_URL_${reference}`;
      }

      const declaration = match[0];
      const replacement = declaration.replace(
        /"data:text\/javascript;base64,[A-Za-z0-9+/=]+"/,
        workletUrl,
      );
      return code.replace(declaration, replacement);
    },
    generateBundle() {
      if (!emittedWorklet) {
        this.error("The same-origin superdough AudioWorklet was not emitted.");
      }
    },
  };
}
