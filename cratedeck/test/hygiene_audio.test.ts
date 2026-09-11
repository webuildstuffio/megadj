import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  servableAudioPath,
  audioStats,
  statsLine,
  pruneStatsCache,
} from "../src/hygiene_audio";

function shelf(): { root: string; rel: string } {
  const root = mkdtempSync("/tmp/megadj-hyg-audio-");
  const dir = join(root, "Contents", "Artist A");
  mkdirSync(dir, { recursive: true });
  const rel = join(dir, "song.mp3");
  writeFileSync(rel, "ID3fakeaudio");
  return { root, rel };
}

describe("hygiene audio guard (servableAudioPath)", () => {
  test("serves audio files under the shelf root", () => {
    const { root, rel } = shelf();
    expect(servableAudioPath(rel, root)).toBe(rel);
  });

  test("403-class rejections: traversal, non-audio, outside root, missing", () => {
    const { root, rel } = shelf();
    // path traversal never passes, even under the root
    expect(servableAudioPath(join(root, "Contents/../.."), root)).toBeNull();
    expect(
      servableAudioPath(`${root}/Contents/Artist A/../../etc/passwd.mp3`, root),
    ).toBeNull();
    // non-audio extension (the DB, a text file, the quarantine manifest)
    expect(servableAudioPath(join(root, "x.txt"), root)).toBeNull();
    expect(servableAudioPath(join(root, "master.db"), root)).toBeNull();
    // outside the shelf root (any other volume / home dir)
    expect(servableAudioPath("/etc/passwd", root)).toBeNull();
    expect(servableAudioPath("/Users/somebody/song.mp3", root)).toBeNull();
    // null/empty input
    expect(servableAudioPath(null, root)).toBeNull();
    expect(servableAudioPath("", root)).toBeNull();
    // under the root but nonexistent
    expect(
      servableAudioPath(join(root, "Contents", "nope.mp3"), root),
    ).toBeNull();
    // the real file passes so we know the guard isn't just refusing all
    expect(servableAudioPath(rel, root)).not.toBeNull();
  });

  test("case-insensitive extensions", () => {
    const { root } = shelf();
    const dir = join(root, "Contents");
    writeFileSync(join(dir, "X.WAV"), "x");
    expect(servableAudioPath(join(dir, "X.WAV"), root)).not.toBeNull();
  });

  test("audioStats degrades to nulls (never throws) on a non-audio file", () => {
    const { root } = shelf();
    const bad = join(root, "Contents", "Artist A", "song.mp3");
    // "ID3fakeaudio" isn't real audio — ffprobe fails; must return
    // exists:true with nulls + error, not throw
    const s = audioStats(bad);
    expect(s.exists).toBe(true);
    expect(s.durationS).toBeNull();
    expect(s.error).toBeTruthy();
  });

  test("statsLine formats the human line and handles missing files", () => {
    expect(
      statsLine({
        path: "p",
        exists: false,
        bytes: 0,
        durationS: null,
        bitrateKbps: null,
        codec: null,
        sampleRate: null,
      }),
    ).toBe("file missing");
    expect(
      statsLine({
        path: "p",
        exists: true,
        bytes: 10_485_760,
        durationS: 222.4,
        bitrateKbps: 320,
        codec: "mp3",
        sampleRate: 44_100,
      }),
    ).toBe("3:42 · 320 kbps · mp3 44.1kHz");
  });

  test("pruneStatsCache bounds the map", () => {
    pruneStatsCache(1); // whatever is cached, cap to 1 must not throw
  });
});
