/**
 * play-history.test.ts — Tests for rekordbox play history mining (#441).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tempDir } from "../test-support/testutil";
import { minePlayHistory, printPlayHistoryReport } from "./play-history";

const tmp = tempDir("megadj-play-history-");
afterAll(() => tmp.rippleAll());

function makeTempDb(): string {
  const dir = tmp.dir();
  const path = join(dir, "master.db");
  const db = new Database(path);

  db.exec(`
    CREATE TABLE djmdArtist (ID TEXT PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdKey (ID TEXT PRIMARY KEY, ScaleName TEXT);
    CREATE TABLE djmdGenre (ID TEXT PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdContent (
      ID TEXT PRIMARY KEY, Title TEXT, ArtistID TEXT, BPM REAL,
      KeyID TEXT, GenreID TEXT
    );
    CREATE TABLE djmdSongHistory (
      ID TEXT PRIMARY KEY, ContentID TEXT, created_at TEXT
    );
  `);

  db.exec(`
    INSERT INTO djmdArtist VALUES ('a1', 'Charlotte de Witte');
    INSERT INTO djmdArtist VALUES ('a2', 'Amelie Lens');
    INSERT INTO djmdArtist VALUES ('a3', 'ANNA');
    INSERT INTO djmdKey VALUES ('k1', '7A');
    INSERT INTO djmdKey VALUES ('k2', '8A');
    INSERT INTO djmdGenre VALUES ('g1', 'Techno');
    INSERT INTO djmdGenre VALUES ('g2', 'Tech House');

    INSERT INTO djmdContent VALUES ('c1', 'Doppler', 'a1', 132.0, 'k1', 'g1');
    INSERT INTO djmdContent VALUES ('c2', 'Exhale', 'a2', 134.0, 'k2', 'g1');
    INSERT INTO djmdContent VALUES ('c3', 'Hidden Beauties', 'a3', 130.0, 'k1', 'g1');
    INSERT INTO djmdContent VALUES ('c4', 'Be Sharp', null, 128.0, null, 'g2');

    INSERT INTO djmdSongHistory VALUES ('h1', 'c1', '2026-09-28 22:00:00');
    INSERT INTO djmdSongHistory VALUES ('h2', 'c2', '2026-09-28 22:05:00');
    INSERT INTO djmdSongHistory VALUES ('h3', 'c3', '2026-09-28 22:12:00');
    INSERT INTO djmdSongHistory VALUES ('h4', 'c4', '2026-09-28 22:18:00');
  `);

  db.close();
  return path;
}

describe("play-history mining (#441)", () => {
  test("extracts consecutive transition pairs within 30min window", () => {
    const path = makeTempDb();
    const r = minePlayHistory(path);
    expect(r.ok).toBe(true);
    expect(r.totalPlays).toBe(4);
    expect(r.transitions).toBe(3);
    expect(r.uniqueTracks).toBe(4);

    const p0 = r.pairs[0];
    expect(p0).toBeDefined();
    expect(p0!.titleA).toBe("Doppler");
    expect(p0!.titleB).toBe("Exhale");
    expect(p0!.bpmDelta).toBe(2);
    expect(p0!.genreMatch).toBe(true);
  });

  test("respects 30min gap — splits sessions", () => {
    const dir = tmp.dir();
    const path = join(dir, "master.db");
    const db = new Database(path);

    db.exec(`
      CREATE TABLE djmdArtist (ID TEXT PRIMARY KEY, Name TEXT);
      CREATE TABLE djmdKey (ID TEXT PRIMARY KEY, ScaleName TEXT);
      CREATE TABLE djmdGenre (ID TEXT PRIMARY KEY, Name TEXT);
      CREATE TABLE djmdContent (
        ID TEXT PRIMARY KEY, Title TEXT, ArtistID TEXT, BPM REAL,
        KeyID TEXT, GenreID TEXT
      );
      CREATE TABLE djmdSongHistory (
        ID TEXT PRIMARY KEY, ContentID TEXT, created_at TEXT
      );

      INSERT INTO djmdArtist VALUES ('a1', 'Artist A');
      INSERT INTO djmdGenre VALUES ('g1', 'Techno');
      INSERT INTO djmdContent VALUES ('c1', 'Track 1', 'a1', 128.0, null, 'g1');
      INSERT INTO djmdContent VALUES ('c2', 'Track 2', 'a1', 130.0, null, 'g1');
      INSERT INTO djmdContent VALUES ('c3', 'Track 3', 'a1', 126.0, null, 'g1');

      -- Session 1
      INSERT INTO djmdSongHistory VALUES ('h1', 'c1', '2026-09-28 20:00:00');
      INSERT INTO djmdSongHistory VALUES ('h2', 'c2', '2026-09-28 20:05:00');
      -- 2-hour gap (session break)
      INSERT INTO djmdSongHistory VALUES ('h3', 'c3', '2026-09-28 22:05:00');
    `);
    db.close();

    const r = minePlayHistory(path);
    expect(r.ok).toBe(true);
    expect(r.transitions).toBe(1);
    expect(r.pairs[0]!.titleA).toBe("Track 1");
    expect(r.pairs[0]!.titleB).toBe("Track 2");
  });

  test("genre match rate calculation", () => {
    const path = makeTempDb();
    const r = minePlayHistory(path);
    expect(r.genreMatchRate).toBeDefined();
    // 3 transitions: c1→c2 (Techno→Techno ✓), c2→c3 (Techno→Techno ✓), c3→c4 (Techno→Tech House ✗)
    expect(r.genreMatchRate).toBeCloseTo(0.67, 1);
  });

  test("limit option caps output pairs", () => {
    const path = makeTempDb();
    const r = minePlayHistory(path, { limit: 1 });
    expect(r.transitions).toBe(3);
    expect(r.pairs).toHaveLength(1);
  });

  test("missing db returns error", () => {
    const r = minePlayHistory("/nonexistent/master.db");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no master DB");
  });

  test("report prints readable summary", () => {
    const path = makeTempDb();
    const r = minePlayHistory(path);
    const report = printPlayHistoryReport(r);
    expect(report).toContain("3 transitions from 4 plays");
    expect(report).toContain("genre match rate");
    expect(report).toContain("Doppler");
    expect(report).toContain("Exhale");
  });
});
