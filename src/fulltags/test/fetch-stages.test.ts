/**
 * fetch-stages.test.ts — the per-stage #54 regression tests. `processTask`
 * used to be a CCN-66, 10-param function with three mutable out-params; it
 * is now a 4-field input object returning a `ProcessTaskResult`, and each
 * per-row decision lives in a `fulltags/src/fetch-stages.ts` stage runner
 * (re-homed from tools/ per #184). These tests pin the behaviors that made
 * the old shape untestable:
 *
 *   - genre fallback ladder: SC → Beatport → AI-batch ONLY when the gate
 *     is on; junk genres (numeric SC IDs, "Music") are refused everywhere.
 *   - year fallback: SC year first; a failed tag write NEVER reaches the
 *     DB (write-first discipline — no lying rows).
 *   - dry-run touches nothing: no writes, no batches — the gate that keeps
 *     `megadj fetch --dry-run` safe on a live library.
 *
 * Everything runs through ONE hermetic harness: `bun -e` with MEGADJ_DB
 * scoped to a throwaway SQLite file. archive-ledger opens its Database at
 * module import (and bun test shares one process across files), so
 * importing the stages in-process would touch the operator's real
 * archive.db — the child-process seam keeps every scenario isolated.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..", ".."); // #193; re-leveled Sep 17
const SCENARIO_DIR = mkdtempSync(join(tmpdir(), "megadj-fetch-stages-"));
afterAll(() => rmSync(SCENARIO_DIR, { recursive: true, force: true }));

interface ScenarioResult {
  stats: Record<string, number>;
  notes: string[];
  aiGenre: number;
  aiYear: number;
  votes: { rung: string; genre: string; weight: number; detail?: string }[];
  dbRow: {
    genre: string | null;
    year: string | null;
    genre_votes: string | null;
  } | null;
}

/** Run one stage call against a fresh throwaway DB in a child process. */
function runScenario(
  scHit: string,
  needGenre = true,
  needYear = true,
  dry = false,
  rowLabel: string | null = null,
  truthLabel: string | null = null,
  bpBest: string | null = null,
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
        artwork_status TEXT, genre_votes TEXT
      );
      INSERT INTO tracks VALUES
        ('vid1', 'Track One', 'Artist One', 'Album One', NULL, NULL,
         ${JSON.stringify(rowLabel)}, '/nonexistent/track.mp3', NULL, NULL, NULL);
    \`);
    const stages = await import(${JSON.stringify(join(REPO, "src/fulltags/fetch/fetch-stages.ts"))});
    const lib = await import(${JSON.stringify(join(REPO, "src/fulltags/archive-ledger.ts"))});
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
               bpIdentity:0, genreBc:0, yearBc:0, bcFilled:0, genreImprint:0,
               genreElected:0, votesCast:0 },
      notes: [], aiGenreBatch: [], aiYearBatch: [], aiAllowed: false,
      bpBest: ${bpBest ?? "null"}, durationS: null,
      genreVotes: [], // #173: the pipeline's production shape opens the accumulator
    };
    stages.stageGenreYear(ctx, ${scHit});
    // #173: the pipeline runs the election after the ladder when the
    // accumulator holds votes (mirrors processTask's sequence exactly).
    if (ctx.genreVotes.length > 0) {
      stages.stageGenreElection(ctx, (vid, genre, serialized) => {
        lib.db.query(
          "UPDATE tracks SET genre = COALESCE(?, genre), genre_votes = ? WHERE video_id = ?",
        ).run(genre, serialized, vid);
      });
    }
    console.log(JSON.stringify({
      stats: ctx.stats, notes: ctx.notes,
      aiGenre: ctx.aiGenreBatch.length, aiYear: ctx.aiYearBatch.length,
      votes: ctx.genreVotes,
      dbRow: lib.db.query("SELECT genre, year, genre_votes FROM tracks WHERE video_id='vid1'").get(),
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
    // file. #173 vote mode: the SC rung COLLECTS its vote (stat counts the
    // vote cast); the ONE election owns the tag write, and when it fails
    // nothing reaches the DB — noted, not faked.
    const res = runScenario(SC_HIT);
    expect(res.stats.genreSc).toBe(1); // the vote was cast
    expect(res.notes).toContain("genre:Techno (sc, vote)");
    expect(res.notes).toContain("genre:WRITE-FAILED (vote election)");
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
      // #215: a junk refusal is NOT a silent death — no vote was cast, so
      // the ladder falls through honestly (UNRESOLVED when AI is off).
      expect(res.votes).toEqual([]);
      expect(res.notes).toContain(
        "genre:UNRESOLVED (no SC/bp hit — AI fallback off)",
      );
    }
  });

  test("#215 multi-collect: SC + BP both vote; the ladder no longer early-returns", () => {
    // SC 0.35 + BP 0.60 in ONE election: BP wins on mass, the breakdown
    // records both claims, and the election note carries the full story.
    // (The pre-#215 arm early-returned after SC's vote — BP never voted.)
    const res = runScenario(
      `{ url: "https://sc/x", genre: "Tech House", year: 2021 }`,
      true,
      false,
      false,
      null,
      null,
      `{ id: 1, name: "Track One", artists: ["Artist One"], genre: "Techno", subGenre: null, label: "Drumcode", year: null }`,
    );
    expect(res.stats.genreSc).toBe(1);
    expect(res.stats.genreBp).toBe(1);
    expect(res.votes).toEqual([
      { rung: "sc", genre: "Tech House", weight: 0.35 },
      { rung: "bp", genre: "Techno", weight: 0.6 },
    ]);
    // Write-first: the file is absent, so the election fails and the DB
    // stays honest — but the multi-rung vote tally is the #215 fix proof.
    expect(res.dbRow?.genre).toBeNull();
    expect(res.stats.votesCast).toBe(2);
    expect(res.stats.genreElected).toBe(0);
    expect(res.notes).toContain("genre:WRITE-FAILED (vote election)");
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
    // #173 vote mode: the imprint rung casts a family vote (weight 0.15 —
    // it elects only when it's the sole voice). The tag write is the
    // ELECTION's job; with the file absent the election fails, the
    // write-first discipline keeps the DB honest: the vote is on the
    // breakdown, nothing reaches genre.
    const res = runScenario(NO_HIT, true, false, false, "Drumcode", "Drumcode");
    expect(res.notes).toContain("genre:techno (imprint:drumcode, vote)");
    expect(res.stats.genreImprint).toBe(1); // the vote was cast
    expect(res.votes).toEqual([
      { rung: "imprint", genre: "techno", weight: 0.15, detail: "drumcode" },
    ]);
    expect(res.dbRow?.genre).toBeNull(); // election's tag write failed
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
