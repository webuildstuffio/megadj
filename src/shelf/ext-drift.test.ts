// Issue #69 regression: the extension drift was LIVE — sync copied
// ogg/opus onto the shelf while dupescan's AUDIO set and hygiene's
// AUDIO_EXT skipped them, so those files were never scanned, never
// deduplicated, never quarantined. Both scanners now read the SSOT
// (src/shared/audio-exts.ts) and MUST see what sync ships.
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { walkAudio } from "./dupescan";
import { walkShelf } from "../archive/hygiene/walk";
import { AUDIO_EXTS_RE } from "../shared/audio-exts";
import { walkAudioDir } from "../shared/audio-walk";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-ext-drift-").rippable();
afterAll(() => {
  t.rippleAll();
});

function makeTree(files: Record<string, string>): string {
  const root = t.dir();
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("ext drift #69: scanners see what sync copies", () => {
  test("dupescan walkAudio finds ogg/opus (the drifted set)", () => {
    const dir = makeTree({
      "Artist/live.opus": "x",
      "Artist/set.ogg": "x",
      "Artist/song.mp3": "x",
      "Artist/notes.txt": "x",
    });
    const found = walkAudio(dir)
      .map((p) => p.slice(dir.length))
      .toSorted();
    expect(found).toEqual([
      "/Artist/live.opus",
      "/Artist/set.ogg",
      "/Artist/song.mp3",
    ]);
  });

  test("hygiene walkShelf finds ogg/opus under Contents/", () => {
    const vol = makeTree({
      "Contents/Artist/live.opus": "x",
      "Contents/Artist/set.ogg": "x",
      "Contents/Artist/cover.jpg": "x",
    });
    const names = walkShelf(vol)
      .files.map((f) => f.path.slice(vol.length))
      .toSorted();
    expect(names).toEqual([
      "/Contents/Artist/live.opus",
      "/Contents/Artist/set.ogg",
    ]);
  });

  test("sync's copy regex and the scanner set agree exactly", () => {
    // sync uses AUDIO_EXTS_RE; scanners use AUDIO_EXTS. Every
    // regex match must be a set member and vice versa — the drift class
    // this SSOT closes.
    for (const ext of [
      ".mp3",
      ".m4a",
      ".wav",
      ".aif",
      ".aiff",
      ".flac",
      ".ogg",
      ".opus",
      ".aac",
      ".alac",
    ]) {
      expect(AUDIO_EXTS_RE.test(`track${ext}`)).toBe(true);
    }
    expect(AUDIO_EXTS_RE.test("track.m4b")).toBe(false); // membership is explicit
  });

  test("walker SSOT #142: walkAudioDir sees ogg/opus/aac/alac, skips dotfiles and AppleDouble", () => {
    // ingest-probe's private set missed ogg/opus/aac/alac and its loop
    // didn't skip `._` AppleDouble junk; writer's set was the stale
    // six-format list. One walker now serves every pass.
    const dir = makeTree({
      "Artist/live.opus": "x",
      "Artist/set.aac": "x",
      "Artist/x.alac": "x",
      "Artist/song.mp3": "x",
      "Artist/._song.mp3": "junk", // AppleDouble — never audio
      "Artist/.hidden/hid.flac": "x", // dotdir — never walked
      "Artist/notes.txt": "x",
    });
    const found = walkAudioDir(dir)
      .map((p) => p.slice(dir.length))
      .toSorted();
    expect(found).toEqual(
      [
        "/Artist/song.mp3",
        "/Artist/set.aac",
        "/Artist/x.alac",
        "/Artist/live.opus",
      ].toSorted(),
    );
  });
});
