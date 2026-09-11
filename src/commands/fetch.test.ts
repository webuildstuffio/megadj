import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditArchive, fetchAllArgs } from "./fetch";

/**
 * GetDat regression tests for the fetch/audit surface:
 *  - auditArchive must walk genre SUBFOLDERS (organize() moves tracks into
 *    them; the top-level readdir audited an empty set post-organize)
 *  - fetch() must forward --art/--genres/--tags/--years/--jobs/--dry-run to
 *    tools/fetch-all.ts (they were parsed then silently dropped)
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-audit-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Minimal fake m4a: groundTruth just needs a readable file; fields will
 * read false, which is exactly what we assert on. */
function fakeTrack(rel: string): void {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "not really audio, but exists");
}

describe("auditArchive folder walk", () => {
  test("finds tracks in genre subfolders, not just the top level", async () => {
    fakeTrack("top.m4a");
    fakeTrack("House/organized.m4a");
    fakeTrack("Techno  Trance/deep-dive.m4a");
    const report = await auditArchive(dir);
    expect(report.total).toBe(3);
    // none are complete (fake files) — the audit must say so, not 0/0
    expect(report.complete).toBe(0);
    expect(report.rows.map((r) => r.file).toSorted()).toEqual(
      [
        join(dir, "House/organized.m4a"),
        join(dir, "Techno  Trance/deep-dive.m4a"),
        join(dir, "top.m4a"),
      ].toSorted(),
    );
  });

  test("empty/missing dir reports zero without throwing", async () => {
    expect((await auditArchive(join(dir, "nope"))).total).toBe(0);
  });

  test("hidden dirs (ingest-duplicates quarantine) are skipped", async () => {
    fakeTrack("real.m4a");
    fakeTrack(".ingest-duplicates/hidden.m4a");
    const report = await auditArchive(dir);
    expect(report.total).toBe(1);
  });

  test("32-bit float WAV is audit-flagged unplayable (player-compat gate)", async () => {
    // The real trap: a DAW bounce that is tag-fine but won't LOAD on any
    // booth player. Generate a genuine pcm_f32le WAV — ffprobe must see it.
    const p = join(dir, "daw-bounce.wav");
    const gen = Bun.spawnSync([
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.1",
      "-c:a",
      "pcm_f32le",
      p,
    ]);
    if (gen.exitCode !== 0) return; // no ffmpeg in env — skip, don't fail
    const report = await auditArchive(dir);
    const row = report.rows.find((r) => r.file === p);
    expect(row).toBeDefined();
    expect(row!.playable).toBe(false);
    expect(row!.complete).toBe(false);
  });
});

describe("fetch flag forwarding", () => {
  test("every parsed option maps to a fetch-all.ts flag", () => {
    expect(
      fetchAllArgs({
        all: true,
        only: "art",
        jobs: 8,
        dryRun: true,
        json: true,
      }),
    ).toEqual(["--json", "--all", "--art", "--jobs", "8", "--dry-run"]);
  });

  test("only=all is the default (no flag) and no options yields empty args", () => {
    expect(fetchAllArgs({ only: "all" })).toEqual([]);
    expect(fetchAllArgs({})).toEqual([]);
  });

  test("single-scope runs forward their scope flag", () => {
    expect(fetchAllArgs({ only: "genres" })).toEqual(["--genres"]);
    expect(fetchAllArgs({ only: "years" })).toEqual(["--years"]);
    expect(fetchAllArgs({ only: "tags" })).toEqual(["--tags"]);
  });
});
