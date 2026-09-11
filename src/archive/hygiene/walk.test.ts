import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { walkShelf } from "./walk";
import { walkTokenFor } from "./types";

function shelf(files: Record<string, string | number>): string {
  const vol = mkdtempSync("/tmp/megadj-hygiene-walk-");
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(vol, "Contents", rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(
      abs,
      typeof content === "number" ? Buffer.alloc(content) : content,
    );
  }
  return vol;
}

describe("walkShelf", () => {
  test("walks audio under Contents, skips junk + DBs + quarantine dirs", () => {
    const vol = shelf({
      "Artist A/Album/song.mp3": "x",
      "Artist A/Album/cover.aiff": "x",
      "Artist B/track.flac": "x",
      // junk never walked
      "._Artist A": "junk",
      ".DS_Store": "junk",
      "Artist A/._song.mp3": "junk",
      // excluded dirs
      "PIONEER/export.pdb": "db",
      ".dupescan-quarantine/twin.mp3": "x",
      "_appledouble-junk/fork.mp3": "x",
      // not audio
      "Artist A/notes.txt": "x",
    });
    const { files, walkToken } = walkShelf(vol);
    const names = files.map((f) => f.path.slice(vol.length)).toSorted();
    expect(names).toEqual([
      "/Contents/Artist A/Album/cover.aiff",
      "/Contents/Artist A/Album/song.mp3",
      "/Contents/Artist B/track.flac",
    ]);
    expect(walkToken.length).toBe(24);
  });

  test("the token moves when the census changes, stays when nothing did", () => {
    const a = { path: "/x/a.mp3", bytes: 1, mtimeMs: 5 };
    const b = { path: "/x/b.mp3", bytes: 2, mtimeMs: 6 };
    const t1 = walkTokenFor([a, b]);
    expect(walkTokenFor([a, b])).toBe(t1); // deterministic
    expect(walkTokenFor([a])).not.toBe(t1); // file removed
    expect(walkTokenFor([{ ...a, bytes: 3 }, b])).not.toBe(t1); // size changed
    // PIONEER REC/ is walked (recordings), PIONEER/ is not — the walk
    // rule with the one-letter trap
    const vol = shelf({
      "PIONEER REC/live.aiff": "x",
    });
    expect(walkShelf(vol).files.length).toBe(1);
  });
});
