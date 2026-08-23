import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPinnedSamples } from "./pinned-samples";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadPinnedSamples", () => {
  it("ignores upstream bases and supplies commit-addressed asset URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(json({ _base: "https://mutable.invalid/", bd: ["bd.wav"] }))
        .mockResolvedValueOnce(json({ _base: "https://mutable.invalid/", Machine_bd: ["bd.wav"] }))
        .mockResolvedValueOnce(json({ _base: "https://mutable.invalid/", piano: { C3: "C3.mp3" } }))
        .mockResolvedValueOnce(json({ Machine: "Friendly" })),
    );
    const samples = vi.fn().mockResolvedValue(undefined);
    const aliasBank = vi.fn().mockResolvedValue(undefined);

    await loadPinnedSamples({ samples, aliasBank });

    expect(samples).toHaveBeenCalledTimes(3);
    for (const [manifest, base] of samples.mock.calls) {
      expect(manifest).not.toHaveProperty("_base");
      expect(base).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/.+\/[0-9a-f]{40}\//,
      );
    }
    expect(aliasBank).toHaveBeenCalledWith({ Machine: "Friendly" });
  });

  it.each([
    { bd: ["https://attacker.invalid/audio.wav"] },
    { bd: ["../audio.wav"] },
    { __proto__: ["audio.wav"] },
  ])("rejects unsafe manifest data", async (manifest) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(json(manifest))),
    );
    await expect(
      loadPinnedSamples({
        samples: vi.fn().mockResolvedValue(undefined),
        aliasBank: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(/invalid|unsafe|empty/);
  });

  it("aborts manifest requests that do not settle", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const pending = loadPinnedSamples({
      samples: vi.fn().mockResolvedValue(undefined),
      aliasBank: vi.fn().mockResolvedValue(undefined),
    });
    const rejection = expect(pending).rejects.toThrow(
      "Pinned sample manifests took too long to load.",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
  });
});

function json<Value>(value: Value): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
