import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import tauri from "../../src-tauri/tauri.conf.json";

describe("desktop webview security boundary", () => {
  it("ships a restrictive CSP without dynamic JavaScript execution", () => {
    const csp = tauri.app.security.csp;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("grants only the event permissions and the URL-scoped opener the main view consumes", () => {
    expect(capability.permissions).toEqual([
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      {
        identifier: "opener:allow-open-url",
        allow: [{ url: "https://opencollective.com/tidalcycles" }],
      },
    ]);
  });
});
