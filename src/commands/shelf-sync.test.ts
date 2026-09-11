import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { shelfSync } from "./shelf-sync";

/**
 * shelf-sync: the shelf master is append-only. Tests exercise the walk +
 * skip/copy decision with temp "volumes" (plain dirs) — no real drives.
 */

function makeArchive(): string {
  const root = mkdtempSync("/tmp/megadj-shelf-src-");
  mkdirSync(join(root, "Artist One", "Album"), { recursive: true });
  writeFileSync(join(root, "Artist One", "Album", "track one.mp3"), "aaaa");
  writeFileSync(join(root, "loose.mp3"), "bbbb");
  return root;
}

describe("shelf-sync", () => {
  test("copies into Contents/<artist>/ and skips on re-run", () => {
    const src = makeArchive();
    const vol = mkdtempSync("/tmp/megadj-shelf-vol-");
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
      shelfVolume: mkdtempSync("/tmp/megadj-shelf-vol2-"),
      stickVolumes: ["/tmp/megadj-shelf-not-mounted-zz"],
      log: () => {},
    }).then(() => {
      // reaching here = no throw; the unmounted volume was skipped
      expect(true).toBe(true);
    });
  });

  test("--json emits one parseable summary (P1 contract)", async () => {
    const src = makeArchive();
    const vol = mkdtempSync("/tmp/megadj-shelf-vol3-");
    const orig = console.log;
    let out = "";
    console.log = (s: string) => (out += s + "\n");
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
    expect(parsed.command).toBe("shelf-sync");
    expect(parsed.tracked).toBe(2);
    expect(parsed.volumes[0]?.copied).toBe(2);
    expect(parsed.ok).toBe(true);
  });

  test("regrouped shelf: file under a DIFFERENT artist folder counts as already there", async () => {
    // The Sep 11 discovery: the shelf was regrouped into per-artist folders
    // while the archive keeps its batch folders — shelf-sync must not
    // re-copy everything into dated folders. Same basename + same size
    // anywhere under Contents/ = already synced.
    const src = mkdtempSync("/tmp/megadj-shelf-batch-");
    mkdirSync(join(src, "2026-09-11 intake"), { recursive: true });
    writeFileSync(join(src, "2026-09-11 intake", "song.aiff"), "xyz");

    const vol = mkdtempSync("/tmp/megadj-shelf-regroup-");
    mkdirSync(join(vol, "Contents", "The Artist"), { recursive: true });
    writeFileSync(join(vol, "Contents", "The Artist", "song.aiff"), "xyz");

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
    const src = mkdtempSync("/tmp/megadj-shelf-nfc-");
    mkdirSync(join(src, "batch"), { recursive: true });
    const accented = "Nina Simone - Sinnerman (Ignacio Herna\u0301ndez).aiff"; // NFD á
    writeFileSync(join(src, "batch", accented), "data");

    const vol = mkdtempSync("/tmp/megadj-shelf-nfc-vol-");
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
});
