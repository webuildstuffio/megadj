import { describe, expect, test } from "bun:test";
import { trueContainerExt, type Probe } from "../src/media-probe";

/** A well-formed probe (all fields present, mp3 by default). */
function probe(over: Partial<Probe> = {}): Probe {
  return {
    ok: true,
    durationS: 300,
    bitrateKbps: 320,
    sampleRate: 44100,
    codec: "mp3",
    hasArt: false,
    tags: {},
    container: ["mp3"],
    ...over,
  };
}

describe("trueContainerExt", () => {
  test("honest mp3 → .mp3 (caller compares, sees no mismatch, no rename)", () => {
    expect(trueContainerExt(probe())).toBe(".mp3");
  });

  test("AAC audio in MP4 container wearing .mp3 → .m4a (Sep 11 rescue)", () => {
    // 14 pool rips shipped like this; ffmpeg's mp3 muxer exits 234 on them.
    expect(
      trueContainerExt(
        probe({
          codec: "aac",
          container: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
        }),
      ),
    ).toBe(".m4a");
  });

  test("container list is whitespace-tolerant (ffprobe format_name)", () => {
    expect(
      trueContainerExt(
        probe({ codec: "aac", container: ["mov", "mp4", "m4a"] }),
      ),
    ).toBe(".m4a");
  });

  test("flac / wav / aiff containers map to their extensions", () => {
    expect(trueContainerExt(probe({ container: ["flac"] }))).toBe(".flac");
    expect(trueContainerExt(probe({ container: ["wav"] }))).toBe(".wav");
    expect(trueContainerExt(probe({ container: ["aiff"] }))).toBe(".aiff");
  });

  test("unknown container → null (never guess a rename)", () => {
    expect(trueContainerExt(probe({ container: ["ogg"] }))).toBeNull();
    expect(trueContainerExt(probe({ container: [] }))).toBeNull();
  });

  test("absent container field (legacy probes) → null, never throws", () => {
    const legacy = probe() as Probe & { container?: string[] };
    delete legacy.container;
    expect(trueContainerExt(legacy)).toBeNull();
  });
});
