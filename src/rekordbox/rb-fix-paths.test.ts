import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  rbFixPaths,
  printRbFixReport,
  buildIndex,
  __test,
  type RbFixPathsRuntime,
} from "./rb-fix-paths";

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
  test("invalid master DB read returns an honest failure instead of throwing", async () => {
    const mount = makeMount();
    const dbPath = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(dbPath, "not a rekordbox database");
    const previous = process.env.MEGADJ_RB_MASTER;
    process.env.MEGADJ_RB_MASTER = dbPath;
    try {
      const r = await rbFixPaths({ mount });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("pyrekordbox read failed");
    } finally {
      if (previous === undefined) delete process.env.MEGADJ_RB_MASTER;
      else process.env.MEGADJ_RB_MASTER = previous;
      rmSync(mount, { recursive: true, force: true });
    }
  }, 60_000); // uv cold-start under 16-way parallel workers needs > 5s

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

  test("--apply fails when the shared rekordbox guard rejects preflight", async () => {
    const r = await rbFixPaths(
      { mount: "/fake", apply: true, yes: true },
      {
        fileExists: () => true,
        assertClosed: () => {
          throw new Error("rekordbox is running");
        },
        readRows: () => {
          throw new Error("must not read after failed guard");
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rekordbox is running");
    expect(r.applied).toBe(0);
    expect(r.backedUpTo).toBeNull();
  });

  test("--apply without --yes fails before reading or walking", async () => {
    const events: string[] = [];
    const r = await rbFixPaths(
      { mount: "/missing", apply: true },
      {
        fileExists: () => true,
        assertClosed: () => events.push("closed"),
        readRows: () => {
          events.push("read");
          return [];
        },
        buildIndex: () => {
          events.push("walk");
          return __test.emptyIndex();
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("--apply requires --yes");
    expect(events).toEqual([]);
  });

  test("successful apply rechecks closed around backup/mutation and delayed rereads", async () => {
    const mount = makeMount();
    const dbPath = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(dbPath, "stub");
    const oldPath = "/Volumes/OLD/Contents/Artist B/Old Track.mp3";
    const livePath = join(mount, "Contents", "Artist B", "Old Track.mp3");
    const events: string[] = [];
    let reads = 0;
    const deps: Partial<RbFixPathsRuntime> = {
      fileExists: (path) => path === dbPath || path === livePath,
      assertClosed: (what) => events.push(`closed:${what}`),
      readRows: () => {
        reads++;
        events.push(reads === 1 ? "read:initial" : "read:verify");
        return reads === 1 ? [["1", oldPath]] : [["1", livePath]];
      },
      buildIndex: (root) => {
        events.push("walk");
        return buildIndex(root);
      },
      backup: () => {
        events.push("backup");
        return `${dbPath}.bak`;
      },
      rewrite: async () => {
        events.push("rewrite");
        return 1;
      },
      sleep: () => events.push("sleep"),
    };
    try {
      const r = await rbFixPaths({ mount, apply: true, yes: true }, deps);
      expect(r.ok).toBe(true);
      expect(r.applied).toBe(1);
      expect(r.stillBroken).toBe(0);
      expect(events).toEqual([
        "closed:rb-fix-paths --apply preflight",
        "read:initial",
        "walk",
        "closed:rb-fix-paths --apply backup",
        "backup",
        "closed:rb-fix-paths --apply mutation",
        "rewrite",
        "sleep",
        "closed:rb-fix-paths verification",
        "read:verify",
      ]);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("partial rewrite is a failed result and restores the backup", async () => {
    const mount = makeMount();
    const dbPath = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(dbPath, "stub");
    const oldPath = "/Volumes/OLD/Contents/Artist B/Old Track.mp3";
    const livePath = join(mount, "Contents", "Artist B", "Old Track.mp3");
    const restored: string[] = [];
    try {
      const r = await rbFixPaths(
        { mount, apply: true, yes: true },
        {
          fileExists: (path) => path === dbPath || path === livePath,
          assertClosed: () => {},
          readRows: () => [["1", oldPath]],
          backup: () => `${dbPath}.bak`,
          rewrite: async () => 0,
          restore: (db, backup) => restored.push(`${backup} -> ${db}`),
        },
      );
      expect(r.ok).toBe(false);
      expect(r.error).toContain("partial rewrite");
      expect(r.applied).toBe(0);
      expect(restored).toEqual([`${dbPath}.bak -> ${dbPath}`]);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("a still-broken rewritten target fails delayed verification and restores", async () => {
    const mount = makeMount();
    const dbPath = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(dbPath, "stub");
    const oldPath = "/Volumes/OLD/Contents/Artist B/Old Track.mp3";
    let reads = 0;
    let restored = false;
    try {
      const r = await rbFixPaths(
        { mount, apply: true, yes: true },
        {
          fileExists: (path) => path === dbPath,
          assertClosed: () => {},
          readRows: () => {
            reads++;
            return [["1", oldPath]];
          },
          backup: () => `${dbPath}.bak`,
          rewrite: async () => 1,
          sleep: () => {},
          restore: () => {
            restored = true;
          },
        },
      );
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("verification");
      expect(r.stillBroken).toBeGreaterThan(0);
      expect(restored).toBe(true);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("rollback failure is loud and never reports success", async () => {
    const mount = makeMount();
    const dbPath = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(dbPath, "stub");
    const oldPath = "/Volumes/OLD/Contents/Artist B/Old Track.mp3";
    const livePath = join(mount, "Contents", "Artist B", "Old Track.mp3");
    try {
      const r = await rbFixPaths(
        { mount, apply: true, yes: true },
        {
          fileExists: (path) => path === dbPath || path === livePath,
          assertClosed: () => {},
          readRows: () => [["1", oldPath]],
          backup: () => `${dbPath}.bak`,
          rewrite: async () => 0,
          restore: () => {
            throw new Error("restore exploded");
          },
        },
      );
      expect(r.ok).toBe(false);
      expect(r.error).toContain("ROLLBACK FAILED: restore exploded");
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

  test("malformed rewrite output fails visibly after the write boundary", () => {
    expect(() => __test.parseRewriteResult("not-json")).toThrow(
      "pyrekordbox rewrite returned malformed JSON",
    );
    expect(() => __test.parseRewriteResult('{"applied":"2"}')).toThrow(
      "invalid applied count",
    );
  });

  test("malformed read output includes the pyrekordbox boundary context", () => {
    expect(() => __test.parseReadRows("not-json")).toThrow(
      "pyrekordbox read returned malformed JSON",
    );
  });

  test("content ids cross Python JSON as decimal strings without 64-bit rounding", () => {
    const id = "9007199254740993";
    expect(__test.parseReadRows(`[["${id}","/music/a.aiff"]]`)).toEqual([
      [id, "/music/a.aiff"],
    ]);
    expect(() => __test.parseReadRows(`[[${id},"/music/a.aiff"]]`)).toThrow(
      "decimal string id",
    );
    expect(__test.readScript).toContain("str(c.ID)");
  });

  test("generated rewrite script commits once and rolls back as one transaction", () => {
    const script = __test.rewriteScript();
    expect(script).toContain("db.session.rollback()");
    expect(script.match(/db\.session\.commit\(\)/gu)).toHaveLength(1);
    expect(script.indexOf("db.session.commit()")).toBeGreaterThan(
      script.indexOf("for cid,path in updates"),
    );
  });
});
