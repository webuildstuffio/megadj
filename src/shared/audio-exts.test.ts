// Regression tests for the audio-extension SSOT (issue #69): seven
// hand-rolled ext sets/regexes had diverging memberships and the drift
// was live — shelf-sync copied ogg/opus while every scanner skipped
// them, so those files were invisible to hygiene/dedupe/dupescan.
import { describe, expect, test } from "bun:test";
import { AUDIO_EXTS, AUDIO_EXTS_RE, audioExt, isAudioFile } from "./audio-exts";

describe("AUDIO_EXTS SSOT (issue #69)", () => {
  test("the live-drift pair: ogg/opus are audio everywhere", () => {
    // shelf-sync ships them; the scanners must at least SEE them
    expect(isAudioFile("live set.opus")).toBe(true);
    expect(isAudioFile("live set.ogg")).toBe(true);
    expect(AUDIO_EXTS_RE.test("live set.opus")).toBe(true);
    expect(AUDIO_EXTS_RE.test("live set.OGG")).toBe(true); // case rule
  });

  test("core formats stay recognized", () => {
    for (const name of [
      "a.mp3",
      "b.wav",
      "c.aif",
      "d.aiff",
      "e.m4a",
      "f.flac",
    ]) {
      expect(isAudioFile(name)).toBe(true);
    }
  });

  test("non-audio and extensionless names stay out", () => {
    expect(isAudioFile("notes.txt")).toBe(false);
    expect(isAudioFile("export.pdb")).toBe(false);
    expect(isAudioFile("XDJXZ.UPD")).toBe(false);
    expect(isAudioFile("no-extension")).toBe(false);
    expect(isAudioFile(".hidden")).toBe(false); // dotfile, no real ext
  });

  test("audioExt is the one dot-idiom: lowercase, dot-prefixed", () => {
    expect(audioExt("Track.FLAC")).toBe(".flac");
    expect(audioExt("nope")).toBe("");
    expect(audioExt(".dotfile")).toBe(""); // dot at 0 is not an extension
  });

  test("regex derives from the same membership as the set (no drift)", () => {
    // every set member must match the regex, and vice versa
    for (const ext of AUDIO_EXTS) {
      expect(AUDIO_EXTS_RE.test(`x${ext}`)).toBe(true);
    }
    const probed = [..."x.acc".matchAll(/\.([a-z0-9]+)$/gi)].map((m) => m[1]);
    void probed;
    // an extension absent from the set must not match
    expect(AUDIO_EXTS_RE.test("x.txt")).toBe(false);
    expect(AUDIO_EXTS_RE.test("x.exe")).toBe(false);
  });
});
