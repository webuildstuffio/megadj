import { describe, expect, test, afterAll } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { walkTree } from "./walk-tree";
import { tempDir } from "../test-support/testutil";

const t = tempDir("megadj-walk-tree-").rippable();
afterAll(() => t.rippleAll());

function makeTree(files: Record<string, string>): string {
  const root = t.dir();
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("walkTree — the one directory walker (#69)", () => {
  test("collects audio through the SSOT ext set, skips dot + junk entries", () => {
    const dir = makeTree({
      "Artist/song.mp3": "x",
      "Artist/live.opus": "x",
      "Artist/._song.mp3": "junk", // AppleDouble fork
      "Artist/.hidden/hid.flac": "x", // dotdir
      "Artist/notes.txt": "x",
    });
    const found = walkTree(dir, {
      exts: new Set([".mp3", ".opus"]),
    })
      .entries.map((e) => e.rel)
      .toSorted();
    expect(found).toEqual(["Artist/live.opus", "Artist/song.mp3"]);
  });

  test("every entry carries bytes + mtime from one stat (no re-stat)", () => {
    const dir = makeTree({ "a.mp3": "hello" });
    const e = walkTree(dir, { exts: new Set([".mp3"]) }).entries[0]!;
    expect(e.bytes).toBe(5);
    expect(e.mtimeMs).toBeGreaterThan(0);
    expect(e.abs).toBe(join(dir, "a.mp3"));
  });

  test("relRoot: rel computed against the landing root, not the walk root", () => {
    // shelf-archive's PIONEER REC landing: walk PIONEER REC/, rel → volume
    const vol = makeTree({
      "PIONEER REC/rec1.wav": "x",
      "PIONEER REC/sub/rec2.wav": "x",
    });
    const { entries } = walkTree(join(vol, "PIONEER REC"), {
      exts: new Set([".wav"]),
      relRoot: vol,
    });
    expect(entries.map((e) => e.rel).toSorted()).toEqual([
      "PIONEER REC/rec1.wav",
      join("PIONEER REC", "sub", "rec2.wav"),
    ]);
  });

  test("flat: rel is the bare basename (trash flat-landing)", () => {
    const vol = makeTree({
      ".Trashes/deleted from folders/a.mp3": "x",
    });
    const { entries } = walkTree(join(vol, ".Trashes"), {
      flat: true,
    });
    expect(entries.map((e) => e.rel)).toEqual(["a.mp3"]);
  });

  test("unreadable dirs are surfaced, never silent; walk continues", () => {
    const dir = makeTree({ "keep/a.mp3": "x" });
    mkdirSync(join(dir, "locked"));
    // make the dir unreadable the POSIX way
    chmodSync(join(dir, "locked"), 0o000);
    try {
      if (process.getuid?.() === 0) return; // root reads anything
      const surfaced: string[] = [];
      const res = walkTree(dir, {
        exts: new Set([".mp3"]),
        onUnreadable: (d) => surfaced.push(d),
      });
      expect(res.unreadable).toEqual([join(dir, "locked")]);
      expect(surfaced).toEqual([join(dir, "locked")]);
      expect(res.entries.map((e) => e.rel)).toEqual(["keep/a.mp3"]);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });

  test("missing root soft-fails to empty + one unreadable entry", () => {
    const res = walkTree("/nonexistent/megadj-walk-tree-nope");
    expect(res.entries).toEqual([]);
    expect(res.unreadable).toEqual(["/nonexistent/megadj-walk-tree-nope"]);
  });

  test("skipPaths: a dir whose path is prefixed never collects (#99 skips)", () => {
    const dir = makeTree({
      "batch/a.mp3": "x",
      "batch/.quarantine/b.mp3": "q",
      "sub/c.mp3": "x",
    });
    const { entries } = walkTree(dir, {
      exts: new Set([".mp3"]),
      skipPaths: [join(dir, "batch", ".quarantine")],
    });
    expect(entries.map((e) => e.rel).toSorted()).toEqual([
      "batch/a.mp3",
      "sub/c.mp3",
    ]);
  });

  test("skip callback distinguishes files from dirs", () => {
    const dir = makeTree({
      "USBANLZ/x.mp3": "x",
      "ARTWORK/y.mp3": "x",
      "Artist/z.mp3": "x",
      "Artist/.DS_Store": "j",
    });
    const { entries } = walkTree(dir, {
      exts: new Set([".mp3"]),
      skip: (name, isDir) =>
        isDir && (name === "USBANLZ" || name === "ARTWORK"),
    });
    expect(entries.map((e) => e.rel)).toEqual(["Artist/z.mp3"]);
  });
});
