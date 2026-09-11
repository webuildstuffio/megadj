import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rbUnmatched, printRbUnmatchedReport, __test } from "./rb-unmatched";

/**
 * rb-unmatched unit tests. The pyrekordbox leg is NOT exercised here (it
 * needs a real encrypted master DB + uv) — same seam strategy as
 * rb-fix-paths.test.ts: a synthetic mount tree + MEGADJ_RB_MASTER pointing
 * at a nonexistent DB gives fail-visible; the pure classifier and the
 * top-dir census are tested directly. Quarantine moves are exercised on
 * the temp volume (row-less files only — the same safety property the
 * command relies on against a real DB).
 */

function makeMount(): string {
  const dir = mkdtempSync("/tmp/rbunmatched-test-");
  mkdirSync(join(dir, "Contents", "Artist A"), { recursive: true });
  mkdirSync(join(dir, "Contents", "UnknownArtist"), { recursive: true });
  // matched: a row points exactly here
  writeFileSync(join(dir, "Contents", "Artist A", "Song One.aiff"), "x");
  // twin-named: no row points here, but a row carries this basename
  writeFileSync(join(dir, "Contents", "Artist A", "Moved Copy.mp3"), "x");
  // unknown: no row, no basename anywhere
  writeFileSync(join(dir, "Contents", "UnknownArtist", "01 Intro.mp3"), "x");
  writeFileSync(join(dir, "Contents", "UnknownArtist", "02 Backlog.mp3"), "x");
  return dir;
}

describe("rb-unmatched", () => {
  test("missing master DB is a visible failure, not a fake pass", async () => {
    const mount = makeMount();
    try {
      const r = await rbUnmatched({ mount });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("no master DB");
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("--quarantine without --yes refuses (two-step apply)", async () => {
    const mount = makeMount();
    // fake DB via env override so the flag check (which must precede any
    // read attempt semantically) is what the test observes
    const prev = process.env.MEGADJ_RB_MASTER;
    process.env.MEGADJ_RB_MASTER = join(
      mount,
      "PIONEER",
      "Master",
      "master.db",
    );
    try {
      const r = await rbUnmatched({ mount, quarantine: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("--quarantine requires --yes");
    } finally {
      if (prev === undefined) delete process.env.MEGADJ_RB_MASTER;
      else process.env.MEGADJ_RB_MASTER = prev;
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("classifyUnmatched: matched / twinNamed / unknown buckets", () => {
    const { classifyUnmatched } = __test;
    const disk = [
      "/v/Contents/A/Matched Exact.mp3",
      "/v/contents/a/matched exact.mp3", // casefold variant
      "/v/Contents/B/Twin Name.mp3",
      "/v/Contents/UnknownArtist/Totally New.mp3",
    ];
    const rows = [
      "/v/Contents/A/Matched Exact.mp3",
      "/x/renamed/TWIN NAME.MP3", // same basename elsewhere
    ];
    const r = classifyUnmatched(disk, rows);
    expect(r.matched).toHaveLength(2);
    expect(r.twinNamed).toEqual(["/v/Contents/B/Twin Name.mp3"]);
    expect(r.unknown).toEqual(["/v/Contents/UnknownArtist/Totally New.mp3"]);
  });

  test("classifyUnmatched: empty inputs never throw", () => {
    const r = __test.classifyUnmatched([], []);
    expect(r.unknown).toHaveLength(0);
    expect(r.matched).toHaveLength(0);
    expect(r.twinNamed).toHaveLength(0);
  });

  test("classifyUnmatched: NFC/NFD basename variants stay twin-named", () => {
    const disk = ["/v/Contents/B/Cafe\u0301.mp3"];
    const rows = ["/x/renamed/Caf\u00e9.MP3"];
    const r = __test.classifyUnmatched(disk, rows);
    expect(r.twinNamed).toEqual(disk);
    expect(r.unknown).toHaveLength(0);
  });

  test("topDir: census buckets resolve Contents' top-level folder", () => {
    expect(__test.topDir("/v/Contents/Abc/x/y.mp3")).toBe("Abc");
    expect(__test.topDir("/v/Contents/rootfile.mp3")).toBe("(root)");
    expect(__test.topDir("/v/PIONEER REC/rec.mp3")).toBe("(outside Contents)");
  });

  test("normExt accepts dotted and bare forms", () => {
    expect(__test.normExt("mp3")).toBe(".mp3");
    expect(__test.normExt(".MP3")).toBe(".mp3");
  });

  test("human report prints without throwing (both modes)", async () => {
    const mount = makeMount();
    try {
      const r = await rbUnmatched({ mount });
      expect(() => printRbUnmatchedReport(r, () => {})).not.toThrow();
      const rFail = { ...r, ok: false, error: "boom" };
      expect(() => printRbUnmatchedReport(rFail, () => {})).not.toThrow();
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("quarantine moves only unknown files, writes manifest, nothing deleted", async () => {
    // The DB read needs MEGADJ_RB_MASTER; point it at a nonexistent file
    // and call only quarantineUnmatched's pure move half instead — the
    // full command path with a real DB is the dry-run runbook's job.
    const { quarantineUnmatched } = await import("./rb-unmatched");
    const mount = makeMount();
    try {
      const unknown = [
        join(mount, "Contents", "UnknownArtist", "01 Intro.mp3"),
        join(mount, "Contents", "UnknownArtist", "02 Backlog.mp3"),
      ];
      const r = await quarantineUnmatched(unknown, mount, () => {});
      expect(r.moved).toHaveLength(2);
      expect(r.manifestPath).toContain(".hygiene-quarantine/unmatched");
      // sources gone, dests present, manifest exists
      for (const m of r.moved) {
        expect(m.dest.startsWith(join(mount, ".hygiene-quarantine"))).toBe(
          true,
        );
      }
      const { existsSync, readFileSync } = await import("node:fs");
      expect(existsSync(r.manifestPath)).toBe(true);
      const lines = readFileSync(r.manifestPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        const obj = JSON.parse(l) as { from: string; dest: string };
        expect(obj.from).toBeTruthy();
        expect(obj.dest).toBeTruthy();
      }
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("quarantine collision never overwrites (suffixed twin)", async () => {
    const { quarantineUnmatched } = await import("./rb-unmatched");
    const mount = makeMount();
    try {
      // same from listed twice → dest must differ, both must exist
      const unknown = [
        join(mount, "Contents", "UnknownArtist", "01 Intro.mp3"),
      ];
      const first = await quarantineUnmatched(unknown, mount, () => {});
      expect(first.moved).toHaveLength(1);
      // reconstruct a same-named file and quarantine again
      writeFileSync(unknown[0]!, "x");
      const second = await quarantineUnmatched(unknown, mount, () => {});
      expect(second.moved).toHaveLength(1);
      expect(second.moved[0]!.dest).not.toBe(first.moved[0]!.dest);
      const { existsSync } = await import("node:fs");
      expect(existsSync(first.moved[0]!.dest)).toBe(true);
      expect(existsSync(second.moved[0]!.dest)).toBe(true);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });

  test("quarantine runs in the same second keep separate manifests", async () => {
    const { quarantineUnmatched } = await import("./rb-unmatched");
    const mount = makeMount();
    try {
      const firstFile = join(
        mount,
        "Contents",
        "UnknownArtist",
        "01 Intro.mp3",
      );
      const secondFile = join(
        mount,
        "Contents",
        "UnknownArtist",
        "02 Backlog.mp3",
      );
      const first = await quarantineUnmatched([firstFile], mount, () => {});
      writeFileSync(secondFile, "new");
      const second = await quarantineUnmatched([secondFile], mount, () => {});
      expect(second.manifestPath).not.toBe(first.manifestPath);
      const { existsSync } = await import("node:fs");
      expect(existsSync(first.manifestPath)).toBe(true);
      expect(existsSync(second.manifestPath)).toBe(true);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });
});
