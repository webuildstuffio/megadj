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
    artwork_status TEXT, year TEXT, first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  seed.exec("DELETE FROM tracks WHERE video_id LIKE 'vx%'");
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

  it("cueStats: per-track phrase-cue counts off the cues ledger", () => {
    // cues table mirrors megadj's src/state.ts schema
    seed.exec(`
      CREATE TABLE IF NOT EXISTS cues (
        video_id TEXT PRIMARY KEY, cues_json TEXT NOT NULL,
        model TEXT NOT NULL, derived_at TEXT NOT NULL
      );
    `);
    seed.exec("DELETE FROM cues");
    const insC = seed.query(
      `INSERT OR REPLACE INTO cues (video_id, cues_json, model, derived_at)
       VALUES (?, ?, ?, ?)`,
    );
    const cueSet = (n: number): string =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          index: i,
          position: i * 16,
          bar: i * 8 + 1,
        })),
      );
    insC.run("v1", cueSet(12), "phrase-cues@1", "t"); // 12 cues, first at 0
    insC.run("v2", cueSet(9), "phrase-cues@1", "t"); // 9 cues
    const r = reader();
    const c = r.cueStats();
    expect(c.available).toBe(true);
    expect(c.analyzed).toBe(2);
    expect(c.total_cues).toBe(21);
    expect(c.avg_cues).toBeCloseTo(10.5, 1);
    expect(c.tracks[0]!.cue_count).toBe(12);
    expect(c.tracks[0]!.first_cue_at).toBe(0);
    expect(c.tracks[0]!.model).toBe("phrase-cues@1");
    // corrupt JSON row → skipped, not crashed
    insC.run("v2", "{not json", "m", "t");
    const cBad = r.cueStats();
    expect(cBad.analyzed).toBe(1);
    expect(cBad.total_cues).toBe(12);
    r.close();
  });

  it("cueStats degrades on a schema without cues", () => {
    const oldDir = mkdtempSync("/tmp/cratedeck-archive-nocues-");
    const oldPath = join(oldDir, "archive.db");
    const old = new Database(oldPath, { create: true });
    old.exec(
      `CREATE TABLE tracks (video_id TEXT PRIMARY KEY, title TEXT, status TEXT)`,
    );
    old.close();
    const r = new ArchiveReader(oldPath);
    const c = r.cueStats();
    expect(c.available).toBe(true);
    expect(c.analyzed).toBe(0);
    expect(c.tracks).toEqual([]);
    r.close();
    rmSync(oldDir, { recursive: true, force: true });
  });

  it("libraryOverview: genres/years/artwork/energy/codec profile of the archive", () => {
    // gridCrossCheck/moodProfile tests seeded extra downloaded tracks (v5–v8);
    // pin the expectation to THIS test's own view: count distinct fixtures.
    const r = reader();
    const lib = r.libraryOverview();
    expect(lib.available).toBe(true);
    // every downloaded fixture row carries genre "Techno"
    expect(lib.genres).toEqual([{ name: "Techno", count: lib.tracks }]);
    // artwork_status is NULL on the fixtures unless the sibling test set it;
    // embedded + queued + missing must always sum to tracks
    expect(
      lib.artwork.embedded + lib.artwork.queued + lib.artwork.missing,
    ).toBe(lib.tracks);
    expect(lib.energy.stamped <= lib.tracks).toBe(true);
    // codec counts sum to the playable total, ordered worst-first by count
    expect(lib.codecs.reduce((s, c) => s + c.count, 0)).toBe(lib.tracks);
    for (let j = 1; j < lib.codecs.length; j++)
      expect(lib.codecs[j]!.count <= lib.codecs[j - 1]!.count).toBe(true);
    expect(lib.recent.length).toBeGreaterThan(0);
    // recent rows carry the ArchiveTrack shape through (spot-check fields)
    const first = lib.recent[0]!;
    expect(typeof first.video_id).toBe("string");
    expect("year" in first && "artwork_status" in first).toBe(true);
    r.close();
  });

  it("libraryOverview counts artwork rungs, years and energy when stamped", () => {
    // self-contained fixtures (own video ids, cleaned in this test) so the
    // assertion doesn't depend on sibling tests' seeded rows. The shared
    // base fixture stamps energy=7 on every row — normalize it first so
    // "stamped" is exactly the v9 row below.
    seed.exec(`UPDATE tracks SET energy = NULL WHERE video_id <> 'v9'`);
    const insT9 = seed.query(
      `INSERT INTO tracks (video_id, title, artist, status, bitrate_kbps, codec,
       file_path, duration_s, genre, energy, source, liked_position,
       first_seen_at, updated_at)
       VALUES (?, ?, 'A', 'downloaded', 320, 'mp3', '/p9', 300,
               'Techno', NULL, 'liked', 1, '2026-09-01', '2026-09-05')`,
    );
    insT9.run("v9", "Stamped");
    insT9.run("va", "Queued Art");
    insT9.run("vb", "Bare");
    seed.exec(`
      UPDATE tracks SET artwork_status = 'embedded:sc-page-1080', year = '2026',
        energy = 7 WHERE video_id = 'v9';
      UPDATE tracks SET artwork_status = 'queued' WHERE video_id = 'va';
    `);
    const r = reader();
    const lib = r.libraryOverview();
    expect(lib.artwork.embedded).toBe(1);
    expect(lib.artwork.queued).toBe(1);
    expect(
      lib.artwork.embedded + lib.artwork.queued + lib.artwork.missing,
    ).toBe(lib.tracks);
    expect(lib.years.known).toBe(1);
    expect(lib.years.min).toBe("2026");
    expect(lib.years.max).toBe("2026");
    expect(lib.years.unknown).toBe(lib.tracks - 1);
    expect(lib.energy.stamped).toBe(1);
    // recent rows carry the enrichment columns through
    const v9 = lib.recent.find((t) => t.video_id === "v9");
    expect(v9?.year).toBe("2026");
    expect(v9?.artwork_status).toBe("embedded:sc-page-1080");
    // put the fixtures back (restore the base fixture's energy stamp)
    seed.exec(`DELETE FROM tracks WHERE video_id IN ('v9','va','vb')`);
    seed.exec(`UPDATE tracks SET energy = 7`);
    r.close();
  });

  it("libraryOverview degrades on an empty archive", () => {
    const oldDir = mkdtempSync("/tmp/cratedeck-archive-nolib-");
    const oldPath = join(oldDir, "archive.db");
    const old = new Database(oldPath, { create: true });
    old.exec(
      `CREATE TABLE tracks (video_id TEXT PRIMARY KEY, title TEXT, status TEXT)`,
    );
    old.close();
    const r = new ArchiveReader(oldPath);
    const lib = r.libraryOverview();
    expect(lib.available).toBe(true);
    expect(lib.tracks).toBe(0);
    expect(lib.genres).toEqual([]);
    expect(lib.codecs).toEqual([]);
    expect(lib.recent).toEqual([]);
    r.close();
    rmSync(oldDir, { recursive: true, force: true });
  });

  it("skipCensus buckets gone + skipped reasons, gone first", () => {
    // self-contained gone/skipped fixtures (vx ids cleaned in beforeEach)
    seed
      .query(
        `INSERT INTO tracks (video_id, title, status, last_error, source,
         first_seen_at, updated_at)
         VALUES ('vxg1', 'Gone One', 'gone', 'video unavailable', 'liked',
                 '2026-09-01', '2026-09-05'),
                ('vxg2', 'Gone Two', 'gone', 'video unavailable', 'liked',
                 '2026-09-01', '2026-09-05'),
                ('vxs1', 'Skip Podcast', 'skipped_not_music',
                 'category: Comedy', 'liked', '2026-09-01', '2026-09-05'),
                ('vxs2', 'Skip News', 'skipped_not_music',
                 'category: News', 'liked', '2026-09-01', '2026-09-05'),
                ('vxs3', 'Skip Other', 'skipped_not_music',
                 'category: Comedy', 'liked', '2026-09-01', '2026-09-05')`,
      )
      .run();
    const r = reader();
    const s = r.skipCensus();
    expect(s.available).toBe(true);
    expect(s.gone).toBe(2);
    expect(s.skipped).toBe(3);
    // gone buckets come first (they're the actionable ones)
    expect(s.buckets[0]!.kind).toBe("gone");
    expect(s.buckets[0]!.reason).toBe("video unavailable");
    expect(s.buckets[0]!.count).toBe(2);
    // skipped buckets follow, biggest first
    const skipBuckets = s.buckets.filter((b) => b.kind === "skipped");
    expect(skipBuckets[0]!.reason).toBe("category: Comedy");
    expect(skipBuckets[0]!.count).toBe(2);
    r.close();
  });

  it("skipCensus degrades to zeros on a missing archive", () => {
    const r = new ArchiveReader("/tmp/cratedeck-archive-does-not-exist.db");
    const s = r.skipCensus();
    expect(s.available).toBe(false);
    expect(s.buckets).toEqual([]);
    expect(s.gone).toBe(0);
    expect(s.skipped).toBe(0);
    r.close();
  });

  it("skipCensus totals never shrink when buckets exceed the limit", () => {
    // regression: totals were computed by summing the LIMIT-clamped bucket
    // list — a 13th reason shrank `skipped` below the truth.
    seed
      .query(
        `INSERT INTO tracks (video_id, title, status, last_error, source,
         first_seen_at, updated_at)
         VALUES ('vxb1', 'B1', 'skipped_not_music', 'category: A', 'liked',
                 '2026-09-01', '2026-09-05'),
                ('vxb2', 'B2', 'skipped_not_music', 'category: B', 'liked',
                 '2026-09-01', '2026-09-05'),
                ('vxb3', 'B3', 'skipped_not_music', 'category: C', 'liked',
                 '2026-09-01', '2026-09-05'),
                ('vxb4', 'B4', 'skipped_not_music', 'category: D', 'liked',
                 '2026-09-01', '2026-09-05')`,
      )
      .run();
    const r = reader();
    const s = r.skipCensus(2); // limit 2 buckets per kind
    expect(s.buckets.filter((b) => b.kind === "skipped").length).toBe(2);
    // but the total must still count ALL skipped rows
    expect(s.skipped).toBe(4);
    r.close();
  });

  it("sourceCensus lists every source tag with playable split", () => {
    const r = reader();
    const c = r.sourceCensus();
    expect(c.available).toBe(true);
    const liked = c.sources.find((s) => s.source === "liked");
    expect(liked).toBeTruthy();
    // base fixtures (v1–v4, liked) + gridCrossCheck's v5/v6 + moodProfile's
    // v7/v8 all use source 'liked' — count whatever exists, assert the
    // playable split math instead of a brittle absolute.
    expect(liked!.tracks).toBeGreaterThanOrEqual(3);
    const failedLiked = (
      seed
        .query(
          `SELECT COUNT(*) n FROM tracks WHERE source = 'liked' AND status = 'failed'`,
        )
        .all() as { n: number }[]
    )[0]!.n;
    expect(liked!.playable).toBe(liked!.tracks - failedLiked);
    const zip = c.sources.find((s) => s.source === "PLzip123");
    expect(zip!.tracks).toBe(1);
    expect(zip!.playable).toBe(1);
    // ordered biggest first
    expect(c.sources[0]!.tracks).toBeGreaterThanOrEqual(
      c.sources[c.sources.length - 1]!.tracks,
    );
    r.close();
  });

  it("analysisCoverage joins the playable archive against every ledger", () => {
    // ledger tables already exist here (gridCrossCheck/moodProfile/cueStats
    // created them); clear + seed exactly the rows this test asserts on.
    seed.exec(`DELETE FROM beats; DELETE FROM mood; DELETE FROM cues;`);
    const insBCov = seed.query(
      `INSERT INTO beats (video_id, beats_json, downbeats_json, model, source_path, analyzed_at)
       VALUES (?, '[]', '[]', 'cov-test', '', '2026-09-05')`,
    );
    insBCov.run("v1");
    insBCov.run("v4");
    const insMCov = seed.query(
      `INSERT INTO mood (video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at)
       VALUES (?, 0.5, 0.5, 0.5, 0.5, 0.5, 5, 5, '', '2026-09-05')`,
    );
    insMCov.run("v1");
    const insCCov = seed.query(
      `INSERT INTO cues (video_id, cues_json, model, derived_at)
       VALUES (?, '[]', 'cov-test', '2026-09-05')`,
    );
    insCCov.run("v4");
    const r = reader();
    const cov = r.analysisCoverage();
    expect(cov.available).toBe(true);
    expect(cov.tracks).toBeGreaterThan(0);
    expect(cov.beats).toBe(2);
    expect(cov.mood).toBe(1);
    expect(cov.cues).toBe(1);
    r.close();
  });

  it("analysisCoverage reports null for absent ledgers, not 0", () => {
    const oldDir = mkdtempSync("/tmp/cratedeck-archive-nol ledger-");
    const oldPath = join(oldDir, "archive.db");
    const old = new Database(oldPath, { create: true });
    old.exec(
      `CREATE TABLE tracks (video_id TEXT PRIMARY KEY, title TEXT, status TEXT)`,
    );
    old.close();
    const r = new ArchiveReader(oldPath);
    const cov = r.analysisCoverage();
    expect(cov.available).toBe(true);
    expect(cov.tracks).toBe(0);
    expect(cov.beats).toBeNull();
    expect(cov.mood).toBeNull();
    expect(cov.cues).toBeNull();
    r.close();
    rmSync(oldDir, { recursive: true, force: true });
  });
});
