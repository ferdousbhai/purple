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

  it("reaches raw GitHub only under the repositories the hosted CSP allows", async () => {
    // Keep this list in step with connect-src and media-src in
    // apps/web/public/_headers and apps/web/worker/security-headers.ts.
    const allowed = /^https:\/\/raw\.githubusercontent\.com\/(tidalcycles\/Dirt-Samples|felixroos\/dough-samples|ritchse\/tidal-drum-machines|todepond\/samples)\/[0-9a-f]{40}\//;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ bd: ["bd.wav"] }))
      .mockResolvedValueOnce(json({ Machine_bd: ["bd.wav"] }))
      .mockResolvedValueOnce(json({ piano: { C3: "C3.mp3" } }))
      .mockResolvedValueOnce(json({ Machine: "Friendly" }));
    vi.stubGlobal("fetch", fetchMock);
    const samples = vi.fn().mockResolvedValue(undefined);

    await loadPinnedSamples({ samples, aliasBank: vi.fn().mockResolvedValue(undefined) });

    const urls = [
      ...fetchMock.mock.calls.map(([url]) => String(url)),
      ...samples.mock.calls.map(([, base]) => String(base)),
    ];
    expect(urls).toHaveLength(7);
    for (const url of urls) expect(url).toMatch(allowed);
  });

  it.each([
    { bd: ["https://attacker.invalid/audio.wav"] },
    { bd: ["../audio.wav"] },
    // Computed so the member is a real own property: a literal `__proto__:`
    // key would invoke the prototype setter and serialize as `{}`, which the
    // empty-manifest branch would reject before the deny-list is reached.
    { ["__proto__"]: ["audio.wav"] },
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
    ).rejects.toThrow(/invalid|unsafe/);
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
