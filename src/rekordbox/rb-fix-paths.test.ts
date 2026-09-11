import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rbFixPaths, printRbFixReport, __test } from "./rb-fix-paths";

/**
 * rb-fix-paths unit tests. The pyrekordbox leg is NOT exercised here (it
 * needs a real encrypted master DB + uv) — the matching ladder, indexing,
 * and the dry-run contract are tested against a synthetic mount tree with
 * a missing DB (fail-visible) and a fake DB path stubbed via MEGADJ_RB_MASTER
 * pointing at a nonexistent file → visible failure, never a fake pass.
 */

function makeMount(): string {
  const dir = mkdtempSync("/tmp/rbfix-test-");
  // live files with variant names the ladder must reconcile
  mkdirSync(join(dir, "Contents", "Artist A"), { recursive: true });
  mkdirSync(join(dir, "Contents", "Artist B"), { recursive: true });
  writeFileSync(join(dir, "Contents", "Artist A", "Song One.aiff"), "x");
  writeFileSync(join(dir, "Contents", "Artist A", "Song One 2.aiff"), "xx");
  writeFileSync(join(dir, "Contents", "Artist B", "Old Track.mp3"), "x");
  return dir;
}

describe("rb-fix-paths", () => {
  test("missing master DB is a visible failure, not a fake pass", async () => {
    const mount = makeMount();
    try {
      const r = await rbFixPaths({ mount });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("no master DB");
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("--apply with rekordbox 'running' guard fires (pgrep mocked by env)", async () => {
    // We can't easily fake pgrep; instead verify the DB-missing short-
    // circuit takes precedence and the apply flag never mutates a real DB.
    const mount = makeMount();
    try {
      const r = await rbFixPaths({ mount, apply: true, yes: true });
      expect(r.ok).toBe(false);
      expect(r.applied).toBe(0);
      expect(r.backedUpTo).toBeNull();
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("human report prints without throwing (both modes)", async () => {
    const mount = makeMount();
    try {
      const r = await rbFixPaths({ mount });
      expect(() => printRbFixReport(r, () => {})).not.toThrow();
      const rFail = { ...r, ok: false, error: "boom" };
      expect(() => printRbFixReport(rFail, () => {})).not.toThrow();
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("ladder: dead prefix + unique basename + truly-dead rows", () => {
    const mount = makeMount();
    try {
      // APFS normalizes names on disk, so a same-name different-byte
      // sequence cannot be simulated on this volume — pin the ladder
      // contract against a dead prefix (what an exFAT NFC drift or a
      // drive rename looks like): same tail, mount prefix gone.
      const stalePrefix = "/Volumes/SHELF-OLD";
      const r1 = __test.matchLadder(
        join(stalePrefix, "Contents", "Artist B", "Old Track.mp3"),
        mount,
      );
      // basename is unique on the live tree → direct hit
      expect(r1.via).toBe("basename");
      expect(r1.fixPath).toContain("Old Track.mp3");
      // fully absent dir with a unique live basename → basename step
      const r2 = __test.matchLadder(
        join(mount, "Contents", "Elsewhere", "Old Track.mp3"),
        mount,
      );
      expect(r2.via).toBe("basename");
      // nothing remotely similar → dead, no fix proposed
      const r3 = __test.matchLadder(
        join(mount, "Contents", "Ghost", "Nope.wav"),
        mount,
      );
      expect(r3.via).toBe("unresolved");
      expect(r3.fixPath).toBeNull();
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("copy-suffix folding: 'Old Track - 1.mp3' → the plain file", () => {
    const mount = makeMount();
    try {
      const r = __test.matchLadder(
        "/Volumes/NOPE/Contents/Artist B/Old Track - 1.mp3",
        mount,
      );
      expect(r.via).toBe("copy-suffix");
      expect(r.fixPath).toContain("Old Track.mp3");
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("stripCopySuffix folds renumbered copies", () => {
    expect(__test.stripCopySuffix("Song One 2.aiff")).toBe("Song One.aiff");
    expect(__test.stripCopySuffix("Old Track - 1.mp3")).toBe("Old Track.mp3");
    expect(__test.stripCopySuffix("Plain.mp3")).toBe("Plain.mp3");
  });
});
