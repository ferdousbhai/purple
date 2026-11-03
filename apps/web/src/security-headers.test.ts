import { describe, expect, it } from "vitest";
import headers from "../public/_headers?raw";
import { DOCUMENT_CSP, secureDocument } from "../worker/security-headers";

const SAMPLE_REPOSITORIES = [
  "https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/",
  "https://raw.githubusercontent.com/felixroos/dough-samples/",
  "https://raw.githubusercontent.com/ritchse/tidal-drum-machines/",
  "https://raw.githubusercontent.com/todepond/samples/",
];

function headerValue(name: string): string {
  const value = headers.match(new RegExp(`^\\s*${name}: ([^\\n]+)$`, "m"))?.[1];
  if (!value) throw new Error(`public/_headers is missing ${name}.`);
  return value;
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([directiveName]) => directiveName === name);
  if (!found) throw new Error(`The CSP is missing ${name}.`);
  return found.slice(1);
}

describe("hosted app security headers", () => {
  it("allows only the pairing relay and immutable sample network origins", () => {
    expect(headers).not.toContain("generativelanguage.googleapis.com");
    expect(headers).toContain("wss://soundspurple.com");
    expect(headers).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(headers).toContain("frame-src https://challenges.cloudflare.com");
    expect(headers).toContain("frame-ancestors 'none'");
    // The iOS silent-WAV unlock in media-channel.ts is a data: URL, and <audio>
    // src is governed by media-src, not img-src.
    expect(headers).toContain("media-src 'self' data:");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).not.toContain("unsafe-eval");
    expect(headers).not.toContain("fonts.googleapis.com");
    expect(headers).not.toContain("/assets/*");
  });

  it("limits raw GitHub to the pinned sample repositories", () => {
    const csp = headerValue("Content-Security-Policy");
    for (const name of ["connect-src", "media-src"]) {
      const githubSources = directive(csp, name).filter((source) =>
        source.includes("raw.githubusercontent.com"),
      );
      expect(githubSources).toEqual(SAMPLE_REPOSITORIES);
    }
    expect(csp).not.toMatch(/raw\.githubusercontent\.com(?=[\s;]|$)/);
  });

  it("gives Worker-served documents the same policy as public/_headers", async () => {
    expect(DOCUMENT_CSP).toBe(headerValue("Content-Security-Policy"));

    const response = secureDocument(
      new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
    );
    for (const name of [
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]) {
      expect(response.headers.get(name)).toBe(headerValue(name));
    }
    expect(await response.text()).toBe("<!doctype html>");
  });

  it("keeps a policy the asset headers already set", () => {
    const response = secureDocument(
      new Response("", {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": "sandbox" },
      }),
    );
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
  });
});
