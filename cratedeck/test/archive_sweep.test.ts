import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sweepArchive, type LedgerRow } from "../src/archive_sweep";
import { renderWeeklyPrep, type WeeklyPrepInput } from "../src/weekly_prep";

/**
 * D30 archive-integrity sweep: bitrot/truncation detection before files
 * reach a drive. The engine is pure (music dir + track rows + ledger in;
 * report out) so every verdict class is testable against fixtures.
 */

function fixtureDir() {
  return mkdtempSync("/tmp/megadj-sweep-test-");
}

function baseTrack(file: string, size = 1000) {
  return {
    file_path: file,
    title: "T",
    artist: "A",
    size_hint: size,
  };
}

describe("D30 sweepArchive", () => {
  test("first run baselines everything, flags size mismatches vs DB", async () => {
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "ok.wav"), "x".repeat(1000));
      writeFileSync(join(dir, "short.wav"), "x".repeat(400)); // DB says 1000
      const ledger = new Map<string, LedgerRow>();
      const updates: LedgerRow[] = [];
      const report = await sweepArchive(
        dir,
        [baseTrack("ok.wav"), baseTrack("short.wav")],
        ledger,
        (r) => {
          updates.push(r);
          ledger.set(r.file_path, r);
        },
      );
      expect(report.checked).toBe(2);
      expect(updates.length).toBe(2); // both baselined
      const trunc = report.findings.find((f) => f.path === "short.wav");
      expect(trunc?.verdict).toBe("truncated"); // 400 < DB's 1000
      expect(report.findings.find((f) => f.path === "ok.wav")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("second run with identical files: clean sweep", async () => {
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "a.wav"), "y".repeat(500));
      const ledger = new Map<string, LedgerRow>();
      const upd = (r: LedgerRow) => ledger.set(r.file_path, r);
      await sweepArchive(dir, [baseTrack("a.wav", 500)], ledger, upd);
      const second = await sweepArchive(
        dir,
        [baseTrack("a.wav", 500)],
        ledger,
        upd,
      );
      expect(second.checked).toBe(1);
      expect(second.unchanged).toBe(1);
      expect(second.findings.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bitrot (same size, different content) → changed", async () => {
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "b.wav"), "z".repeat(500));
      const ledger = new Map<string, LedgerRow>();
      const upd = (r: LedgerRow) => ledger.set(r.file_path, r);
      await sweepArchive(dir, [baseTrack("b.wav", 500)], ledger, upd);
      // silent corruption: same length, different bytes
      writeFileSync(join(dir, "b.wav"), "w".repeat(500));
      const second = await sweepArchive(
        dir,
        [baseTrack("b.wav", 500)],
        ledger,
        upd,
      );
      const f = second.findings[0];
      expect(f?.verdict).toBe("changed");
      expect(f?.detail).toContain("differs from known-good");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shrunk file → truncated with byte detail", async () => {
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "c.wav"), "q".repeat(800));
      const ledger = new Map<string, LedgerRow>();
      const upd = (r: LedgerRow) => ledger.set(r.file_path, r);
      await sweepArchive(dir, [baseTrack("c.wav", 800)], ledger, upd);
      writeFileSync(join(dir, "c.wav"), "q".repeat(300));
      const second = await sweepArchive(
        dir,
        [baseTrack("c.wav", 800)],
        ledger,
        upd,
      );
      expect(second.findings[0]?.verdict).toBe("truncated");
      expect(second.findings[0]?.detail).toContain("800 → 300");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("deleted file listed as downloaded → missing", async () => {
    const dir = fixtureDir();
    try {
      const report = await sweepArchive(
        dir,
        [baseTrack("ghost.wav")],
        new Map(),
        () => {},
      );
      expect(report.findings[0]?.verdict).toBe("missing");
      expect(report.checked).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REGRESSION: changed file keeps re-reporting until restored", async () => {
    // the original engine overwrote the ledger with the corrupt hash, so a
    // divergent file alerted exactly ONCE and then read "unchanged" forever
    // — the entire point of the sweep is to keep screaming until it's fixed
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "r.wav"), "g".repeat(400));
      const ledger = new Map<string, LedgerRow>();
      const updates: LedgerRow[] = [];
      const upd = (r: LedgerRow) => {
        updates.push(r);
        ledger.set(r.file_path, r);
      };
      await sweepArchive(dir, [baseTrack("r.wav", 400)], ledger, upd);
      // corruption: same length, different bytes
      writeFileSync(join(dir, "r.wav"), "b".repeat(400));
      const second = await sweepArchive(
        dir,
        [baseTrack("r.wav", 400)],
        ledger,
        upd,
      );
      expect(second.findings[0]?.verdict).toBe("changed");
      // THIRD sweep with the file still corrupt: must STILL report
      const third = await sweepArchive(
        dir,
        [baseTrack("r.wav", 400)],
        ledger,
        upd,
      );
      expect(third.findings[0]?.verdict).toBe("changed");
      // repaired (original bytes back): the flag clears + restored fires
      writeFileSync(join(dir, "r.wav"), "g".repeat(400));
      const fourth = await sweepArchive(
        dir,
        [baseTrack("r.wav", 400)],
        ledger,
        upd,
      );
      expect(fourth.findings.map((f) => f.verdict)).toContain("restored");
      expect(updates.at(-1)?.flagged_at).toBeNull();
      // and a healthy sweep after that is quiet again
      const fifth = await sweepArchive(
        dir,
        [baseTrack("r.wav", 400)],
        ledger,
        upd,
      );
      expect(fifth.findings).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("absolute archive paths are used as-is", async () => {
    const dir = fixtureDir();
    try {
      const abs = join(dir, "abs.wav");
      writeFileSync(abs, "m".repeat(64));
      const report = await sweepArchive(
        dir,
        [{ file_path: abs, title: null, artist: null, size_hint: 64 }],
        new Map(),
        () => {},
      );
      expect(report.checked).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("weekly prep digest: D30 section", () => {
  const base: WeeklyPrepInput = {
    preflight: {
      generated_at: 0,
      overall: "ready",
      summary: "2 drives ready",
      mountedCount: 2,
      firmware_advisories: [],
      drives: [],
    },
    redundancy: { playlists: [] },
    ingest: { available: true, counts: {}, total: 0, recent_tracks: [] },
    lowq: { available: true, tracks: [] },
  };

  test("clean sweep renders the all-good line", () => {
    const md = renderWeeklyPrep({
      ...base,
      sweep: { available: true, checked: 88, findings: [] },
    });
    expect(md).toContain("## Archive integrity (D30 sweep)");
    expect(md).toContain("All 88 files match known-good hashes. ✓");
  });

  test("findings render with verdict + detail", () => {
    const md = renderWeeklyPrep({
      ...base,
      sweep: {
        available: true,
        checked: 2,
        findings: [
          {
            path: "x.wav",
            title: "Song",
            artist: "Artist",
            verdict: "truncated",
            detail: "shrank 800 → 300 B",
          },
        ],
      },
    });
    expect(md).toContain("- truncated: Artist — Song (shrank 800 → 300 B)");
  });

  test("missing sweep (pre-migration digest) renders without the section", () => {
    const md = renderWeeklyPrep(base);
    expect(md).not.toContain("Archive integrity");
  });
});
