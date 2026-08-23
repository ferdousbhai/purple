import { describe, expect, it } from "vitest";
import headers from "../public/_headers?raw";

describe("hosted app security headers", () => {
  it("allows only the inference and immutable sample network origins", () => {
    expect(headers).toContain("https://generativelanguage.googleapis.com");
    expect(headers).toContain("https://raw.githubusercontent.com");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).not.toContain("unsafe-eval");
    expect(headers).not.toContain("fonts.googleapis.com");
  });
});
