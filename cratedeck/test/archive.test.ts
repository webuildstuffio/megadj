import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ArchiveReader } from "../src/archive";

// ArchiveReader must read megadj's REAL schema — tests build the same tables
// src/state.ts creates, so a schema drift breaks here before it breaks agents.
const dir = mkdtempSync("/tmp/cratedeck-archive-");
const dbPath = join(dir, "archive.db");
const seed = new Database(dbPath, { create: true });
seed.exec(`
  CREATE TABLE tracks (
    video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
    status TEXT NOT NULL DEFAULT 'pending', format_id TEXT,
    bitrate_kbps INTEGER, codec TEXT, file_path TEXT,
    file_size_bytes INTEGER, duration_s REAL,
    attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
    last_error TEXT, liked_position INTEGER,
    source TEXT NOT NULL DEFAULT 'liked', genre TEXT, energy INTEGER,
    artwork_status TEXT, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
    finished_at TEXT, attempted INTEGER, downloaded INTEGER, gone INTEGER,
    failed INTEGER, bytes_downloaded INTEGER
  );
`);
const insT = seed.query(
  `INSERT INTO tracks (video_id, title, artist, status, bitrate_kbps, codec,
     file_path, duration_s, genre, energy, source, liked_position,
     first_seen_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
function ins(
  videoId: string,
  over: {
    title?: string;
    artist?: string;
    status?: string;
    bitrate?: number | null;
    codec?: string | null;
    path?: string;
    duration?: number | null;
    source?: string;
  } = {},
) {
  insT.run(
    videoId,
    over.title ?? `Title ${videoId}`,
    over.artist ?? "Artist",
    over.status ?? "downloaded",
    over.bitrate ?? null,
    over.codec ?? null,
    over.path ?? `/music/${videoId}.aiff`,
    over.duration ?? 300,
    "Techno",
    7,
    over.source ?? "liked",
    1,
    "2026-09-01T00:00:00Z",
    "2026-09-05T00:00:00Z",
  );
}
ins("v1", {
  title: "Awakening",
  artist: "Amelie Lens",
  bitrate: 320,
  codec: "mp3",
});
ins("v2", {
  title: "Spastik",
  artist: "Plastikman",
  bitrate: 128,
  codec: "mp4a",
});
ins("v3", { title: "Lost", status: "failed" });
ins("v4", {
  title: "From Zip",
  source: "PLzip123",
  bitrate: 1411,
  codec: "aiff",
});
seed
  .query(
    `INSERT INTO runs (started_at, finished_at, downloaded, failed, gone, bytes_downloaded)
   VALUES ('2026-09-05T01:00:00Z', '2026-09-05T01:30:00Z', 3, 1, 2, 1000)`,
  )
  .run();

function reader() {
  return new ArchiveReader(dbPath);
}

beforeEach(() => {
  seed.exec("DELETE FROM tracks WHERE video_id = 'vx'");
  // gridCrossCheck fixture rows — table exists only after its test creates
  // it, so guard for the earlier tests in this file.
  const hasBeats = seed
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='beats'`)
    .get();
  if (hasBeats) {
    seed.exec("DELETE FROM beats");
    seed.exec("DELETE FROM tracks WHERE video_id IN ('v5','v6')");
  }
  // moodProfile fixture rows — same guard pattern for the mood table.
  const hasMood = seed
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='mood'`)
    .get();
  if (hasMood) {
    seed.exec("DELETE FROM mood");
    seed.exec("DELETE FROM tracks WHERE video_id IN ('v7','v8')");
  }
});

afterAll(() => {
  seed.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ArchiveReader (O82b)", () => {
  it("searches downloaded tracks by artist/title substring", () => {
    const r = reader();
    const hits = r.searchTracks("awaken");
    expect(hits.length).toBe(1);
    expect(hits[0]!.video_id).toBe("v1");
    // failed rows are invisible to search — they're not set-ready
    expect(r.searchTracks("lost").length).toBe(0);
    // short queries short-circuit (protects agents from full-table dumps)
    expect(r.searchTracks("a")).toEqual([]);
    r.close();
  });

  it("returns full row for track_stats", () => {
    const r = reader();
    const t = r.trackStats("v2");
    expect(t?.title).toBe("Spastik");
    expect(t?.bitrate_kbps).toBe(128);
    expect(r.trackStats("nope")).toBeNull();
    r.close();
  });

  it("ingest_status aggregates counts + runs", () => {
    const s = reader().ingestStatus();
    expect(s.available).toBe(true);
    expect(s.counts.downloaded).toBe(3);
    expect(s.counts.failed).toBe(1);
    expect(s.total).toBe(4);
    expect(s.recent_runs[0]?.downloaded).toBe(3);
  });

  it("lowq_queue flags lossy below the floor and excludes lossless", () => {
    const q = reader().lowqQueue();
    const ids = q.tracks.map((t) => t.video_id);
    expect(ids).toContain("v2"); // 128 kbps mp4a
    expect(ids).not.toContain("v1"); // 320 mp3 is at the floor
    expect(ids).not.toContain("v4"); // aiff lossless
    expect(q.tracks[0]!.reason).toContain("kbps");
  });

  it("source_diff splits two sources", () => {
    const d = reader().sourceDiff("liked", "PLzip123");
    expect(d?.only_in_a.map((t) => t.video_id)).toEqual(["v1", "v2", "v3"]);
    expect(d?.only_in_b.map((t) => t.video_id)).toEqual(["v4"]);
    expect(d?.shared).toBe(0);
    // same source on both sides → everything shared
    const same = reader().sourceDiff("liked", "LIKED");
    expect(same?.shared).toBe(3);
    expect(same?.only_in_a).toEqual([]);
  });

  it("missing archive db degrades to available:false, never throws", () => {
    const r = new ArchiveReader("/tmp/cratedeck-archive-does-not-exist.db");
    expect(r.ingestStatus().available).toBe(false);
    expect(r.lowqQueue().available).toBe(false);
    expect(r.searchTracks("awaken")).toEqual([]);
    expect(r.trackStats("v1")).toBeNull();
    r.close();
  });

  it("readonly handle cannot write", () => {
    const r = reader();
    const db = (r as unknown as { db: Database | null }).db;
    // the handle is lazy — force it, then assert the flag held
    r.ingestStatus();
    expect((r as unknown as { db: Database | null }).db).not.toBeNull();
    let threw = false;
    try {
      (r as unknown as { db: Database }).db!.query("DELETE FROM tracks").run();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(db).toBeNull(); // silence unused-var lints while keeping the assert above
    r.close();
  });

  it("gridCrossCheck: ok / off / octave verdicts against the beats ledger", () => {
    // beats table mirrors megadj's src/state.ts schema
    seed.exec(`
      CREATE TABLE IF NOT EXISTS beats (
        video_id TEXT PRIMARY KEY, bpm_raw REAL, bpm_folded REAL,
        beats_json TEXT NOT NULL, downbeats_json TEXT NOT NULL,
        model TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    const insB = seed.query(
      `INSERT OR REPLACE INTO beats (video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const grid = (bpm: number, seconds: number): number[] =>
      Array.from({ length: Math.floor((seconds / 60) * bpm) + 1 }, (_, i) =>
        Number((i * (60 / bpm)).toFixed(4)),
      );
    // The grid rows join to tracks — seed v5/v6 tracks as downloaded
    const insT5 = seed.query(
      `INSERT INTO tracks (video_id, title, artist, status, bitrate_kbps, codec,
       file_path, duration_s, genre, energy, source, liked_position,
       first_seen_at, updated_at)
       VALUES (?, 'Grid Off', 'A', 'downloaded', 320, 'mp3', '/p', 300,
               'Techno', 7, 'liked', 1, '2026-09-01', '2026-09-05')`,
    );
    insT5.run("v5");
    insT5.run("v6");
    // v1: RB says 128, grid agrees → ok (300 s ≈ 640 beats)
    insB.run(
      "v1",
      128,
      128,
      JSON.stringify(grid(128, 300)),
      "[]",
      "m",
      "p",
      "t",
    );
    // v5: RB says 130, grid implies ~146 (>2% off, not octave) → off
    insB.run(
      "v5",
      130.4,
      130.4,
      JSON.stringify(grid(146, 300)),
      "[]",
      "m",
      "p",
      "t",
    );
    // v6: RB says 174 (drum&bass), grid locks the half-tempo 87 → octave
    insB.run(
      "v6",
      174,
      174,
      JSON.stringify(grid(87, 300)),
      "[]",
      "m",
      "p",
      "t",
    );
    const r = reader();
    const g = r.gridCrossCheck();
    expect(g.available).toBe(true);
    expect(g.checked).toBe(3);
    expect(g.ok).toBe(1);
    expect(g.off.map((o) => o.video_id)).toEqual(["v5"]);
    expect(g.octave.map((o) => o.video_id)).toEqual(["v6"]);
    expect(g.octave[0]!.ledgerBpm).toBeGreaterThan(85);
    expect(g.octave[0]!.ledgerBpm).toBeLessThan(89);
    r.close();
  });

  it("gridCrossCheck degrades gracefully on a schema without beats", () => {
    // a DB built before the ledger (no beats table) → empty result, no throw
    const oldDir = mkdtempSync("/tmp/cratedeck-archive-old-");
    const oldPath = join(oldDir, "archive.db");
    const old = new Database(oldPath, { create: true });
    old.exec(
      `CREATE TABLE tracks (video_id TEXT PRIMARY KEY, title TEXT, status TEXT, duration_s REAL)`,
    );
    old.query(`INSERT INTO tracks VALUES ('x', 'T', 'downloaded', 300)`).run();
    old.close();
    const r = new ArchiveReader(oldPath);
    const g = r.gridCrossCheck();
    expect(g.available).toBe(true);
    expect(g.ledgered).toBe(0);
    expect(g.checked).toBe(0);
    r.close();
    rmSync(oldDir, { recursive: true, force: true });
  });

  it("moodProfile: averages + valence/arousal/dance extremes off the mood ledger", () => {
    // mood table mirrors megadj's src/state.ts schema
    seed.exec(`
      CREATE TABLE IF NOT EXISTS mood (
        video_id TEXT PRIMARY KEY, dance REAL NOT NULL, aggressive REAL NOT NULL,
        happy REAL NOT NULL, electronic REAL NOT NULL, party REAL NOT NULL,
        valence REAL NOT NULL, arousal REAL NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    const insM = seed.query(
      `INSERT OR REPLACE INTO mood (video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // tracks for title/artist joins (v7 bright-dance, v8 sleepy; v1/v2 reuse fixtures)
    const insT7 = seed.query(
      `INSERT INTO tracks (video_id, title, artist, status, bitrate_kbps, codec,
       file_path, duration_s, genre, energy, source, liked_position,
       first_seen_at, updated_at)
       VALUES (?, ?, 'A', 'downloaded', 320, 'mp3', '/p', 300,
               'Techno', 7, 'liked', 1, '2026-09-01', '2026-09-05')`,
    );
    insT7.run("v7", "Dance Top");
    insT7.run("v8", "Sleepy");
    insM.run("v1", 0.9, 0.1, 0.8, 0.9, 0.9, 7.5, 7.0, "/p", "t"); // bright
    insM.run("v2", 0.8, 0.9, 0.1, 0.7, 0.2, 2.5, 8.5, "/p", "t"); // dark+hyped
    insM.run("v7", 0.99, 0.2, 0.4, 0.95, 0.95, 5.0, 5.0, "/p", "t"); // dance top
    insM.run("v8", 0.1, 0.3, 0.2, 0.1, 0.1, 4.0, 2.0, "/p", "t"); // sleepy
    const r = reader();
    const p = r.moodProfile(1);
    expect(p.available).toBe(true);
    expect(p.analyzed).toBe(4);
    // average valence: (7.5+2.5+5+4)/4 = 4.75
    expect(p.avg.valence).toBeCloseTo(4.75, 2);
    expect(p.avg.dance).toBeCloseTo((0.9 + 0.8 + 0.99 + 0.1) / 4, 2);
    // extremes: 1 high + 1 low per axis at limit=1
    expect(p.extremes.valence).toHaveLength(2);
    expect(p.extremes.valence[0]).toMatchObject({ video_id: "v1", v: 7.5 });
    expect(p.extremes.valence[1]).toMatchObject({ video_id: "v2", v: 2.5 });
    expect(p.extremes.arousal[0]).toMatchObject({ video_id: "v2", v: 8.5 });
    expect(p.extremes.arousal[1]).toMatchObject({ video_id: "v8", v: 2 });
    expect(p.extremes.dance[0]).toMatchObject({ video_id: "v7" });
    expect(p.extremes.dance[0]!.v).toBeGreaterThan(0.98);
    expect(p.extremes.dance[1]).toMatchObject({ video_id: "v8" });
    r.close();
  });

  it("moodProfile degrades on a schema without mood and on an empty ledger", () => {
    // no mood table at all → available stays true (DB exists), zeros out
    const oldDir = mkdtempSync("/tmp/cratedeck-archive-nomood-");
    const oldPath = join(oldDir, "archive.db");
    const old = new Database(oldPath, { create: true });
    old.exec(
      `CREATE TABLE tracks (video_id TEXT PRIMARY KEY, title TEXT, status TEXT, duration_s REAL)`,
    );
    old.close();
    const rOld = new ArchiveReader(oldPath);
    const pOld = rOld.moodProfile();
    expect(pOld.available).toBe(true);
    expect(pOld.analyzed).toBe(0);
    expect(Number.isNaN(pOld.avg.valence)).toBe(false);
    rOld.close();
    rmSync(oldDir, { recursive: true, force: true });
    // mood table EXISTS but is empty → analyzed 0, no NaN
    seed.exec(`
      CREATE TABLE IF NOT EXISTS mood (
        video_id TEXT PRIMARY KEY, dance REAL NOT NULL, aggressive REAL NOT NULL,
        happy REAL NOT NULL, electronic REAL NOT NULL, party REAL NOT NULL,
        valence REAL NOT NULL, arousal REAL NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    seed.exec("DELETE FROM mood");
    const r = reader();
    const p = r.moodProfile();
    expect(p.analyzed).toBe(0);
    expect(p.extremes.valence).toEqual([]);
    expect(Number.isNaN(p.avg.dance)).toBe(false);
    r.close();
  });
});
