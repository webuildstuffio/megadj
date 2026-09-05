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
});
