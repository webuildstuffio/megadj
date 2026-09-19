import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { writeFakeAudio } from "../test-support/audio-fixtures";
import { join } from "node:path";
import { shelfSync } from "./sync";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-shelf-src-").rippable();
const t2 = tempDir("megadj-shelf-vol-").rippable();
const t3 = tempDir("megadj-shelf-vol2-").rippable();
const t4 = tempDir("megadj-shelf-vol3-").rippable();
const t5 = tempDir("megadj-shelf-batch-").rippable();
const t6 = tempDir("megadj-shelf-regroup-").rippable();
const t7 = tempDir("megadj-shelf-nfc-").rippable();
const t8 = tempDir("megadj-shelf-nfc-vol-").rippable();
const t9 = tempDir("megadj-shelf-divergent-src-").rippable();
const t10 = tempDir("megadj-shelf-divergent-vol-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
  t3.rippleAll();
  t4.rippleAll();
  t5.rippleAll();
  t6.rippleAll();
  t7.rippleAll();
  t8.rippleAll();
  t9.rippleAll();
  t10.rippleAll();
});

/**
 * sync: the shelf master is append-only. Tests exercise the walk +
 * skip/copy decision with temp "volumes" (plain dirs) — no real drives.
 */

function makeArchive(): string {
  const root = t.dir();
  mkdirSync(join(root, "Artist One", "Album"), { recursive: true });
  writeFakeAudio(join(root, "Artist One", "Album", "track one.mp3"), "aaaa");
  writeFakeAudio(join(root, "loose.mp3"), "bbbb");
  return root;
}

describe("sync", () => {
  test("copies into Contents/<artist>/ and skips on re-run", () => {
    const src = makeArchive();
    const vol = t2.dir();
    const logs: string[] = [];
    // isolated ShelfSyncOptions (no real volumes touched)
    const run = () =>
      shelfSync({
        musicDir: src,
        shelfVolume: vol,
        stickVolumes: [],
        log: (s) => logs.push(s),
      });

    return run().then(() => {
      const copied = join(vol, "Contents", "Artist One", "track one.mp3");
      const loose = join(vol, "Contents", "[unknown]", "loose.mp3");
      expect(existsSync(copied)).toBe(true);
      expect(existsSync(loose)).toBe(true);
      // second run: everything already there
      return run().then(() => {
        expect(logs.some((l) => l.includes("already there 2"))).toBe(true);
      });
    });
  });

  test("unmounted stick volumes are skipped, not fatal", () => {
    const src = makeArchive();
    return shelfSync({
      musicDir: src,
      shelfVolume: t3.dir(),
      stickVolumes: ["/tmp/megadj-shelf-not-mounted-zz"],
      log: () => {},
    }).then(() => {
      // reaching here = no throw; the unmounted volume was skipped
      expect(true).toBe(true);
    });
  });

  test("--json emits one parseable summary (P1 contract)", async () => {
    const src = makeArchive();
    const vol = t4.dir();
    const orig = console.log;
    let out = "";
    console.log = (s: string) => (out += `${s}\n`);
    try {
      await shelfSync({
        musicDir: src,
        shelfVolume: vol,
        stickVolumes: [],
        json: true,
      });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(out.trim()) as {
      command: string;
      tracked: number;
      volumes: { copied: number; skipped: number }[];
      ok: boolean;
    };
    expect(parsed.command).toBe("sync");
    expect(parsed.tracked).toBe(2);
    expect(parsed.volumes[0]?.copied).toBe(2);
    expect(parsed.ok).toBe(true);
  });

  test("regrouped shelf: file under a DIFFERENT artist folder counts as already there", async () => {
    // The Sep 11 discovery: the shelf was regrouped into per-artist folders
    // while the archive keeps its batch folders — sync must not
    // re-copy everything into dated folders. Same basename + same size
    // anywhere under Contents/ = already synced.
    const src = t5.dir();
    mkdirSync(join(src, "2026-09-11 intake"), { recursive: true });
    writeFakeAudio(join(src, "2026-09-11 intake", "song.aiff"), "xyz");

    const vol = t6.dir();
    mkdirSync(join(vol, "Contents", "The Artist"), { recursive: true });
    writeFakeAudio(join(vol, "Contents", "The Artist", "song.aiff"), "xyz");

    const logs: string[] = [];
    await shelfSync({
      musicDir: src,
      shelfVolume: vol,
      stickVolumes: [],
      log: (s) => logs.push(s),
    });
    // nothing new copied into Contents/2026-09-11 intake/
    expect(existsSync(join(vol, "Contents", "2026-09-11 intake"))).toBe(false);
    expect(logs.some((l) => l.includes("already there 1"))).toBe(true);
  });

  test("regrouped shelf: NFD on-disk names match NFC archive names (fskit exFAT)", async () => {
    const src = t7.dir();
    mkdirSync(join(src, "batch"), { recursive: true });
    const accented = "Nina Simone - Sinnerman (Ignacio Herna\u0301ndez).aiff"; // NFD á
    writeFileSync(join(src, "batch", accented), "data");

    const vol = t8.dir();
    mkdirSync(join(vol, "Contents", "Nina Simone"), { recursive: true });
    // write the shelf copy NFC (as the archive/mac would produce)
    writeFileSync(
      join(vol, "Contents", "Nina Simone", accented.normalize("NFC")),
      "data",
    );

    const logs: string[] = [];
    await shelfSync({
      musicDir: src,
      shelfVolume: vol,
      stickVolumes: [],
      log: (s) => logs.push(s),
    });
    expect(logs.some((l) => l.includes("already there 1"))).toBe(true);
  });

  test("preserves a divergent same-name destination instead of overwriting it", async () => {
    const src = t9.dir();
    mkdirSync(join(src, "Artist"), { recursive: true });
    writeFakeAudio(join(src, "Artist", "track.mp3"), "archive version");

    const vol = t10.dir();
    mkdirSync(join(vol, "Contents", "Artist"), { recursive: true });
    writeFileSync(
      join(vol, "Contents", "Artist", "track.mp3"),
      "shelf version",
    );

    await shelfSync({ musicDir: src, shelfVolume: vol, log: () => {} });

    expect(
      await Bun.file(join(vol, "Contents", "Artist", "track.mp3")).text(),
    ).toBe("shelf version");
    expect(
      await Bun.file(
        join(vol, "Contents", "Artist", "track [archive].mp3"),
      ).text(),
    ).toBe("archive version");
  });
});
