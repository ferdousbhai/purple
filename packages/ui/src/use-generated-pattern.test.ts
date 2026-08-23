import { describe, expect, it, vi } from "vitest";
import { replacePlayingRevision } from "./use-generated-pattern";

describe("replacePlayingRevision", () => {
  it("hot-swaps a validated revision over its playing predecessor", async () => {
    const replace = vi.fn().mockResolvedValue({ ok: true });

    const result = await replacePlayingRevision(
      ['s("bd*1024")'],
      's("bd*8")',
      { getPlayingCode: () => 's("bd*1024")', replace },
    );

    expect(replace).toHaveBeenCalledExactlyOnceWith('s("bd*8")');
    expect(result).toEqual({ ok: true });
  });

  it.each([null, 's("sd")', 's("bd*8")'])(
    "leaves non-superseded playback alone (%s)",
    async (playingCode) => {
      const replace = vi.fn().mockResolvedValue({ ok: true });
      const superseded = ['s("bd*1024")'];
      const revised = 's("bd*8")';

      await expect(
        replacePlayingRevision(superseded, revised, {
          getPlayingCode: () => playingCode,
          replace,
        }),
      ).resolves.toBeNull();
      expect(replace).not.toHaveBeenCalled();
    },
  );
});
