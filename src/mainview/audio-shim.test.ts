import { describe, expect, it } from "vitest";
import {
  isKnownWebKitStereoAssignment,
  isLinuxWebKitUserAgent,
  normalizeDestinationChannelCount,
  normalizeWebAudioChannelCount,
} from "./audio-shim";

describe("Web Audio compatibility helpers", () => {
  it("normalizes only WebKitGTK's observed zero channel count", () => {
    expect(normalizeWebAudioChannelCount(undefined)).toBeUndefined();
    expect(normalizeWebAudioChannelCount(0)).toBe(2);
    expect(normalizeWebAudioChannelCount(1)).toBe(1);
    expect(normalizeWebAudioChannelCount(-1)).toBe(-1);
    expect(normalizeWebAudioChannelCount(64)).toBe(64);
  });

  it("targets Linux WebKit without patching Chromium", () => {
    expect(
      isLinuxWebKitUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Safari/605.1.15",
      ),
    ).toBe(true);
    expect(
      isLinuxWebKitUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("repairs only WebKitGTK's impossible zero-channel destination", () => {
    expect(normalizeDestinationChannelCount(0)).toBe(2);
    expect(normalizeDestinationChannelCount(1)).toBe(1);
    expect(normalizeDestinationChannelCount(8)).toBe(8);
    expect(isKnownWebKitStereoAssignment(0, 2)).toBe(true);
    expect(isKnownWebKitStereoAssignment(0, 1)).toBe(false);
    expect(isKnownWebKitStereoAssignment(2, 2)).toBe(false);
  });
});
