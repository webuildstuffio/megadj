/**
 * genre-why.test.ts — #215's end-to-end CLI leg. The vote breakdown got a
 * writer in #173 (`tracks.genre_votes`) and this pins the promised READ:
 * `megadj genre-why <id>` surfaces the per-rung election through the real
 * CLI with a seeded throwaway DB (same harness class as json-summary).
 *
 *  - voted track: --json one-object with every rung's weight + elected flag
 *  - never-voted track: honest voted:false empty-state, exit 0 (a status,
 *    not an error — no fake data)
 *  - unknown id: exit 1 (command failure class, like `similar`)
 *  - missing id: exit 2 (usage class, one parseable object)
 */
import { describe, expect, test, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test-support/testutil";
import {
  runCli,
  lastJsonLine,
  cliEnv,
} from "../../../src/test-support/cli-run";

const t = tempDir("megadj-genre-why-").rippable();
const dir = t.dir();
const env = cliEnv(dir);
mkdirSync(join(dir, "music"), { recursive: true });

// Seed the tracks table the CLI's ArchiveState migrates/reads: one voted
// row, one never-voted row. applyGenreVotes-style serialized breakdown.
const seed = new Database(env.MEGADJ_DB, { create: true });
seed.exec(`
  CREATE TABLE tracks (
    video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
    status TEXT NOT NULL DEFAULT 'pending', format_id TEXT,
    bitrate_kbps INTEGER, codec TEXT, file_path TEXT,
    file_size_bytes INTEGER, duration_s REAL,
    attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
    last_error TEXT, liked_position INTEGER,
    first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO tracks (video_id, title, artist, status, first_seen_at, updated_at)
    VALUES ('vid1', 'Track One', 'Artist One', 'downloaded', '2026-01-01', '2026-01-01'),
           ('vid2', 'Never Voted', 'Artist Two', 'downloaded', '2026-01-01', '2026-01-01');
`);
seed.close();

// Add the ledger columns the way ArchiveCore.migrate does, then write the
// breakdown through the REAL production seam (state_tracks.applyGenreVotes
// writes genre + genre_votes in one UPDATE; here we mirror its exact
// serialization via genre-vote's SSOT).
const db = new Database(env.MEGADJ_DB);
db.exec("ALTER TABLE tracks ADD COLUMN genre TEXT");
db.exec("ALTER TABLE tracks ADD COLUMN genre_flag TEXT");
db.exec("ALTER TABLE tracks ADD COLUMN genre_votes TEXT");
const { serializeVotes } = await import("./genre-vote");
db.query(
  "UPDATE tracks SET genre='Techno', genre_votes=? WHERE video_id='vid1'",
).run(
  serializeVotes([
    { rung: "sc", genre: "Tech House", weight: 0.35 },
    { rung: "bp", genre: "Techno", weight: 0.6 },
  ]),
);
db.close();

afterAll(() => t.rippleAll());

describe("#215 genre-why: the vote breakdown's production reader", () => {
  test("voted track: one JSON object, re-elected winner, per-rung breakdown", async () => {
    const { code, stdout } = await runCli(["genre-why", "vid1", "--json"], env);
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("genre-why");
    expect(parsed.video_id).toBe("vid1");
    expect(parsed.voted).toBe(true);
    expect(parsed.elected).toBe("Techno");
    expect(parsed.matches_db).toBe(true);
    const votes = parsed.votes as Record<string, unknown>[];
    expect(votes.length).toBe(2);
    // SC lost to BP: the flag tells the story without code reading.
    const sc = votes.find((v) => v.rung === "sc");
    const bp = votes.find((v) => v.rung === "bp");
    expect(sc?.elected).toBe(false);
    expect(bp?.elected).toBe(true);
  });

  test("never-voted track: honest empty-state (voted:false), exit 0", async () => {
    const { code, stdout } = await runCli(["genre-why", "vid2", "--json"], env);
    expect(code).toBe(0);
    const parsed = lastJsonLine(stdout);
    expect(parsed.voted).toBe(false);
    expect((parsed.votes as unknown[]).length).toBe(0);
  });

  test("unknown id: exit 1 with a json error object (failure class)", async () => {
    const { code, stdout } = await runCli(
      ["genre-why", "no-such-id", "--json"],
      env,
    );
    expect(code).toBe(1);
    const parsed = lastJsonLine(stdout);
    expect(parsed.command).toBe("genre-why");
    expect(parsed.error).toBeString();
  });

  test("missing id: exit 2 with a json error object (usage class)", async () => {
    const { code, stdout } = await runCli(["genre-why", "--json"], env);
    expect(code).toBe(2);
    const parsed = lastJsonLine(stdout);
    expect(parsed.error).toBeString();
  });

  test("drifted row: replay ≠ stored → exit 1 with the full breakdown (finding, not a clean read)", async () => {
    // Seed through the real serializer: the breakdown elects House (bp
    // 0.6 + sc 0.35 = 0.95) but the row stores 'Techno' — the exact
    // hand-edit class the drift flag exists to catch.
    const drift = new Database(env.MEGADJ_DB);
    drift
      .query(
        "UPDATE tracks SET genre='Techno', genre_votes=? WHERE video_id='vid2'",
      )
      .run(
        serializeVotes([
          { rung: "sc", genre: "House", weight: 0.35 },
          { rung: "bp", genre: "House", weight: 0.6 },
        ]),
      );
    drift.close();

    const { code, stdout } = await runCli(["genre-why", "vid2", "--json"], env);
    expect(code).toBe(1);
    const parsed = lastJsonLine(stdout);
    expect(parsed.voted).toBe(true);
    expect(parsed.elected).toBe("House");
    expect(parsed.db_genre).toBe("Techno");
    expect(parsed.matches_db).toBe(false);
    // The object still carries everything an agent needs — exit code is
    // the signal, the payload stays complete.
    expect((parsed.votes as unknown[]).length).toBe(2);
  });
});
