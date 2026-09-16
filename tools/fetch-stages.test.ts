/**
 * fetch-stages.test.ts — the per-stage #54 regression tests. `processTask`
 * used to be a CCN-66, 10-param function with three mutable out-params; it
 * is now a 4-field input object returning a `ProcessTaskResult`, and each
 * per-row decision lives in a `tools/fetch-stages.ts` stage runner. These
 * tests pin the behaviors that made the old shape untestable:
 *
 *   - genre fallback ladder: SC → Beatport → AI-batch ONLY when the gate
 *     is on; junk genres (numeric SC IDs, "Music") are refused everywhere.
 *   - year fallback: SC year first; a failed tag write NEVER reaches the
 *     DB (write-first discipline — no lying rows).
 *   - dry-run touches nothing: no writes, no batches — the gate that keeps
 *     `megadj fetch --dry-run` safe on a live library.
 *
 * Everything runs through ONE hermetic harness: `bun -e` with MEGADJ_DB
 * scoped to a throwaway SQLite file. fetch-lib opens its Database at
 * module import (and bun test shares one process across files), so
 * importing the stages in-process would touch the operator's real
 * archive.db — the child-process seam keeps every scenario isolated.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const SCENARIO_DIR = mkdtempSync(join(tmpdir(), "megadj-fetch-stages-"));
afterAll(() => rmSync(SCENARIO_DIR, { recursive: true, force: true }));

interface ScenarioResult {
  stats: Record<string, number>;
  notes: string[];
  aiGenre: number;
  aiYear: number;
  dbRow: { genre: string | null; year: string | null } | null;
}

/** Run one stage call against a fresh throwaway DB in a child process. */
function runScenario(
  scHit: string,
  needGenre = true,
  needYear = true,
  dry = false,
  rowLabel: string | null = null,
  truthLabel: string | null = null,
): ScenarioResult {
  const dbPath = join(SCENARIO_DIR, `${crypto.randomUUID()}.db`);
  mkdirSync(SCENARIO_DIR, { recursive: true });
  const script = `
    const { Database } = await import("bun:sqlite");
    const db = new Database(process.env.MEGADJ_DB);
    db.exec(\`
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
        genre TEXT, year TEXT, label TEXT, file_path TEXT, format_id TEXT,
        artwork_status TEXT
      );
      INSERT INTO tracks VALUES
        ('vid1', 'Track One', 'Artist One', 'Album One', NULL, NULL,
         ${JSON.stringify(rowLabel)}, '/nonexistent/track.mp3', NULL, NULL);
    \`);
    const stages = await import(${JSON.stringify(join(REPO, "tools/fetch-stages.ts"))});
    const lib = await import(${JSON.stringify(join(REPO, "tools/fetch-lib.ts"))});
    const row = lib.db
      .query("SELECT video_id, title, artist, album, genre, label, file_path, format_id FROM tracks WHERE video_id='vid1'")
      .get();
    const ctx = {
      row,
      truth: { art: false, title: null, artist: null, album: null,
               genre: null, year: null, label: ${JSON.stringify(truthLabel)}, mixName: null,
               isrc: null, remixer: null },
      needTags: false, needGenre: ${needGenre}, needArt: false, needYear: ${needYear},
      upgradeSc: false, dry: ${dry},
      stats: { tags:0, genreSc:0, genreBp:0, genreAi:0, artSc:0,
               artScOrig:0, artBeatport:0, artGateway:0, artTwin:0,
               artDeezer:0, artItunes:0, yearSc:0, yearBp:0, yearAi:0,
               bpIdentity:0, genreBc:0, yearBc:0, bcFilled:0, genreImprint:0 },
      notes: [], aiGenreBatch: [], aiYearBatch: [], aiAllowed: false,
      bpBest: null, durationS: null,
    };
    stages.stageGenreYear(ctx, ${scHit});
    console.log(JSON.stringify({
      stats: ctx.stats, notes: ctx.notes,
      aiGenre: ctx.aiGenreBatch.length, aiYear: ctx.aiYearBatch.length,
      dbRow: lib.db.query("SELECT genre, year FROM tracks WHERE video_id='vid1'").get(),
    }));
  `;
  const proc = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    env: { ...process.env, MEGADJ_DB: dbPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
  return JSON.parse(proc.stdout.toString().trim()) as ScenarioResult;
}

const SC_HIT = `{ url: "https://sc/x", genre: "Techno", year: 2019 }`;
const NO_HIT = "null";

describe("stageGenreYear ladder (issue #54 stage tests)", () => {
  test("real SC genre + year: tag write fails (file absent) → DB stays honest", () => {
    // Write-first discipline: the DB only records values that reached the
    // file; the failed year write is noted, not faked.
    const res = runScenario(SC_HIT);
    expect(res.stats.genreSc).toBe(0);
    expect(res.dbRow?.genre).toBeNull();
    expect(res.stats.yearSc).toBe(0);
    expect(res.notes).toContain("year:WRITE-FAILED");
    expect(res.dbRow?.year).toBeNull();
  });

  test("junk SC genres are refused end-to-end (numeric ID, 'Music')", () => {
    for (const junk of ["123", "Music"]) {
      const res = runScenario(
        `{ url: "https://sc/x", genre: ${JSON.stringify(junk)} }`,
        true,
        false,
      );
      expect(res.stats.genreSc).toBe(0);
      expect(res.dbRow?.genre).toBeNull();
      expect(res.notes).toEqual([]);
    }
  });

  test("SC miss + BP miss + gate OFF → bounded unresolved note, zero batches", () => {
    const res = runScenario(NO_HIT);
    expect(res.aiGenre).toBe(0);
    expect(res.aiYear).toBe(0);
    expect(res.notes).toContain(
      "genre:UNRESOLVED (no SC/bp hit — AI fallback off)",
    );
    expect(res.notes).toContain(
      "year:UNRESOLVED (no SC/bp hit — AI fallback off)",
    );
  });

  test("gate OFF batches stay empty even when fields remain missing", () => {
    // The operator's bounded-list contract: unresolved work is visible in
    // notes for a later explicit --ai-fallback pass, never queued silently.
    const res = runScenario(NO_HIT, true, true);
    expect((res.stats.genreAi ?? 0) + (res.stats.yearAi ?? 0)).toBe(0);
    expect((res.stats.genreSc ?? 0) + (res.stats.yearSc ?? 0)).toBe(0);
  });

  test("dry-run: the stage is a total no-op even with a perfect SC hit", () => {
    const res = runScenario(SC_HIT, true, true, true);
    expect((res.stats.genreSc ?? 0) + (res.stats.yearSc ?? 0)).toBe(0);
    expect(res.aiGenre + res.aiYear).toBe(0);
    expect(res.notes).toEqual([]);
    expect(res.dbRow?.genre).toBeNull();
    expect(res.dbRow?.year).toBeNull();
  });

  test("#128 imprint rung: SC+BP miss but a Drumcode label votes techno", () => {
    // tag write fails (file absent) → the write-first discipline keeps
    // the DB honest: the vote happened but nothing was recorded. The
    // note proves the rung fired; genreImprint stays 0 because the tag
    // write (the gate) failed.
    const res = runScenario(NO_HIT, true, false, false, "Drumcode", "Drumcode");
    expect(res.notes).toContain("genre:WRITE-FAILED (imprint)");
    expect(res.dbRow?.genre).toBeNull();
  });

  test("#128 imprint rung: unknown label abstains → falls through to AI gate", () => {
    const res = runScenario(
      NO_HIT,
      true,
      false,
      false,
      "Some Random Label",
      "Some Random Label",
    );
    expect(res.notes).toContain(
      "genre:UNRESOLVED (no SC/bp hit — AI fallback off)",
    );
    expect(res.dbRow?.genre).toBeNull();
  });

  test("#128 imprint rung: junk label (numeric) abstains, never votes", () => {
    const res = runScenario(NO_HIT, true, false, false, "12345", "12345");
    expect(res.notes).toContain(
      "genre:UNRESOLVED (no SC/bp hit — AI fallback off)",
    );
  });
});
