import { describe, expect, test, beforeEach } from "bun:test";
import {
  playerCompat,
  isHiresOnly,
  setBoothFleet,
  type CompatResult,
} from "../src/player-compat";
import type { Probe } from "../src/media-probe";

// Every test pins its fleet explicitly — the default trio (XZ/3000/NXS2)
// differs from the four-player floor the older cases were written for.
beforeEach(() => {
  setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2", "cdj-2000"]);
});

function probe(over: Partial<Probe> = {}): Probe {
  return {
    ok: true,
    durationS: 300,
    bitrateKbps: 2304,
    sampleRate: 44100,
    codec: "pcm_s24le",
    hasArt: false,
    tags: {},
    ...over,
  };
}

describe("playerCompat — fleet-floor pass cases", () => {
  test("16-bit AIFF 44.1k (the ingest output) plays everywhere", () => {
    const r = playerCompat(probe({ codec: "pcm_s16be", bitrateKbps: 1411 }));
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  test("24-bit WAV 48k plays everywhere (XDJ-XZ cap inclusive)", () => {
    expect(playerCompat(probe({ sampleRate: 48000 })).ok).toBe(true);
  });
  test("320kbps MPEG-1 MP3 plays everywhere", () => {
    expect(
      playerCompat(probe({ codec: "mp3", sampleRate: 44100, bitrateKbps: 320 }))
        .ok,
    ).toBe(true);
  });
  test("MP3 at 32kHz (MPEG-1 floor) plays everywhere", () => {
    expect(playerCompat(probe({ codec: "mp3", sampleRate: 32000 })).ok).toBe(
      true,
    );
  });
  test("AAC LC in m4a at 44.1k plays everywhere", () => {
    expect(playerCompat(probe({ codec: "aac" })).ok).toBe(true);
  });
});

describe("playerCompat — hard rejects (no fleet member plays these)", () => {
  test("32-bit float WAV — the DAW bounce trap", () => {
    const r = playerCompat(probe({ codec: "pcm_f32le" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("float-pcm-unsupported");
  });
  test("32-bit int WAV also rejected", () => {
    const r = playerCompat(probe({ codec: "pcm_s32le" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("bit-depth-unsupported");
  });
  test("ADPCM WAV rejected", () => {
    const r = playerCompat(probe({ codec: "adpcm_ms" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("compressed-wav-unsupported");
  });
  test("MP3 at 22.05kHz (MPEG-2 rip) rejected", () => {
    const r = playerCompat(probe({ codec: "mp3", sampleRate: 22050 }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("mp3-mpeg2-unsupported");
  });
  test("96kHz AIFF on the floor is hi-res-partial, not ok", () => {
    const r = playerCompat(probe({ sampleRate: 96000 }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("sample-rate-hires");
  });
  test("88.2kHz WAV same", () => {
    expect(playerCompat(probe({ sampleRate: 88200 })).reasons).toContain(
      "sample-rate-hires",
    );
  });
  test("absurd sample rate (192k) is a full reject, not hi-res", () => {
    const r = playerCompat(probe({ sampleRate: 192000 }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("sample-rate-unsupported");
  });
  test("ALAC rejected (XDJ-XZ + CDJ-2000)", () => {
    const r = playerCompat(probe({ codec: "alac" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("alac-not-universal");
  });
  test("FLAC rejected on the floor (plain CDJ-2000)", () => {
    const r = playerCompat(probe({ codec: "flac" }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("flac-not-universal");
  });
  test("no audio stream rejected", () => {
    const r = playerCompat(probe({ codec: null }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("no-audio-stream");
  });
});

describe("playerCompat — partial tiers", () => {
  test("96kHz is hires-only (plays on 3000 + NXS2)", () => {
    expect(isHiresOnly(playerCompat(probe({ sampleRate: 96000 })))).toBe(true);
  });
  test("float PCM is NOT partial — it is a hard reject", () => {
    expect(isHiresOnly(playerCompat(probe({ codec: "pcm_f32le" })))).toBe(
      false,
    );
  });
});

describe("playerCompat — degradation honesty", () => {
  test("null sample rate on lossless still passes (probe limits, not file truth)", () => {
    // ffprobe occasionally omits sample_rate on exotic RIFF chunks; the
    // codec itself is in-spec, so we do not invent a failure.
    expect(playerCompat(probe({ sampleRate: null })).ok).toBe(true);
  });
  test("CompatResult carries a human detail line", () => {
    const r: CompatResult = playerCompat(probe({ codec: "pcm_f32le" }));
    expect(r.detail).toContain("pcm_f32le");
  });
});

describe("playerCompat — fleet selection", () => {
  test("default trio: FLAC passes outright (3000+NXS2+XZ all take it)", () => {
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    const r = playerCompat(
      probe({ codec: "flac", sampleRate: 44100, bitrateKbps: 900 }),
    );
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  test("adding CDJ-2000 makes 96 kHz a full-fleet fail... still partial", () => {
    // 96 kHz plays on 3000+NXS2 only — partial regardless of the 2000,
    // because partial means "some of the fleet", and the XZ caps at 48k.
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2", "cdj-2000"]);
    const r = playerCompat(probe({ sampleRate: 96000 }));
    expect(r.reasons).toContain("sample-rate-hires");
    expect(isHiresOnly(r)).toBe(true);
  });
  test("dropping the XZ lets 96 kHz pass everywhere", () => {
    setBoothFleet(["cdj-3000", "cdj-2000nxs2"]);
    const r = playerCompat(probe({ sampleRate: 96000 }));
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  test("an empty/unknown selection falls back to the default trio floor", () => {
    setBoothFleet([]);
    // resolveFleet drops unknowns; an empty selection must never widen
    // the floor to "anything goes" — it re-derives DEFAULT_FLEET.
    const r = playerCompat(probe({ sampleRate: 96000 }));
    expect(r.reasons).toContain("sample-rate-hires"); // XZ back in the floor
  });
});
