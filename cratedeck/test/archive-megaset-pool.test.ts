// archive-megaset-pool.test.ts — the setCandidates POOL contract, split
// from archive-megaset-surface.test.ts (file-length guard). Everything
// here drives `setCandidates` directly with a stubbed ArchiveQuery (or a
// scratch sqlite DB): the admission gate (B1), the cues-ledger join
// (#106 Phase D), dedupe, mirror fallback, relocation, and the readonly
// key-cache guarantees.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { setCandidates } from "../src/archive_similar";
import { ArchiveReader } from "../src/archive";
import type { ArchiveQuery } from "../src/archive_types";

describe("setCandidates pool contract", () => {
  test("the full DB is audited, but unmeasurable missing files cannot enter a proposal", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-pool-"));
    const existingPath = join(dir, "actual.m4a");
    const missingPath = join(dir, "missing.m4a");
    writeFileSync(existingPath, "cached test fixture");
    const dbRows = [
      {
        video_id: "actual",
        title: "Actual",
        artist: "DJ",
        duration_s: 300,
        file_path: existingPath,
        bpm_folded: 128,
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
      {
        video_id: "missing",
        title: "Missing",
        artist: "DJ",
        duration_s: 300,
        file_path: missingPath,
        // no measured tempo anywhere (null ledger + null mirror) — the
        // B1 gate keeps this row OUT: metadata without a tempo cannot
        // be sequenced
        bpm_folded: null,
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
      {
        video_id: "null-path",
        title: "No path",
        artist: "DJ",
        duration_s: 300,
        file_path: null,
        bpm_folded: null,
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ beats_at: null, mood_at: null }) as T,
      keyRecord: () => ({ key: "8A", analyzedAt: "2026-09-11" }),
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    try {
      const result = setCandidates(reader, 0);

      expect(result.sourceTotal).toBe(3);
      expect(result.total).toBe(1);
      expect(result.missingFiles).toBe(2);
      expect(result.metadataOnly).toBe(0);
      expect(result.duplicateFiles).toBe(0);
      expect(result.candidates.map((candidate) => candidate.videoId)).toEqual([
        "actual",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("B1 (#104): a missing file with MEASURED tempo stays in the pool as metadata-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-pool-"));
    const existingPath = join(dir, "actual.m4a");
    const missingPath = join(dir, "missing-but-analyzed.m4a");
    writeFileSync(existingPath, "cached test fixture");
    const dbRows = [
      {
        video_id: "actual",
        title: "Actual",
        artist: "DJ",
        duration_s: 300,
        file_path: existingPath,
        bpm_folded: 128,
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
      {
        video_id: "meta",
        title: "Meta Only",
        artist: "DJ",
        duration_s: 300,
        file_path: missingPath,
        // beats-ledger BPM present, file gone (shelf asleep) — the B1
        // admission: scored from measured metadata, no file needed
        bpm_folded: 126,
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ beats_at: null, mood_at: null }) as T,
      // the cache can NEVER match a null path; key must come from the
      // mirror or stay null — no live read is attempted (keyRecord is
      // the only key source this stub offers and it validates paths)
      keyRecord: (_videoId, path) =>
        path === null ? null : { key: "8A", analyzedAt: "2026-09-11" },
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    try {
      const result = setCandidates(reader, 0);

      expect(result.sourceTotal).toBe(2);
      // the offline shelf no longer zeroes the pool: both rows survive
      expect(result.total).toBe(2);
      expect(result.missingFiles).toBe(1);
      expect(result.metadataOnly).toBe(1);
      const meta = result.candidates.find((c) => c.videoId === "meta");
      expect(meta?.metadataOnly).toBe(true);
      expect(meta?.bpm).toBe(126); // the measured tempo travelled
      expect(meta?.filePath).toBeNull(); // no dead path on the wire
      expect(meta?.key).toBeNull(); // no file → no live TKEY read
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("B1 (#104): the rekordbox mirror BPM alone admits a metadata-only row", () => {
    const missingPath = join(tmpdir(), "never-exists-mirror-admit.m4a");
    const dbRows = [
      {
        video_id: "rb-meta",
        title: "RB Mirror Only",
        artist: "DJ",
        duration_s: null,
        file_path: missingPath,
        bpm_folded: null, // no beats ledger…
        rekordbox_bpm: 125, // …but the mirror has the pre-divided 125.0
        rekordbox_key: "8A",
        valence: 5,
        arousal: 6,
        dance: 0.8,
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ beats_at: null, mood_at: null }) as T,
      keyRecord: () => null,
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    const result = setCandidates(reader, 0);
    expect(result.total).toBe(1);
    expect(result.metadataOnly).toBe(1);
    expect(result.rekordboxBpmHits).toBe(1);
    const meta = result.candidates[0]!;
    expect(meta.metadataOnly).toBe(true);
    expect(meta.bpm).toBe(125); // the mirror's already-divided BPM value
    expect(meta.key).toBe("8A"); // the mirror key is the metadata-only ceiling
    expect(meta.filePath).toBeNull();
  });

  test("#106 Phase D: the cues ledger join fills SetCandidate.cues from cues_json", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-cues-"));
    const audioPath = join(dir, "cued.m4a");
    writeFileSync(audioPath, "cached test fixture");
    const cuesJson = JSON.stringify([
      { index: 0, bar: 1, position: 0 },
      { index: 1, bar: 25, position: 45.1 },
    ]);
    const dbRows = [
      {
        video_id: "cued",
        title: "Cued",
        artist: "DJ",
        duration_s: 300,
        file_path: audioPath,
        bpm_folded: 128,
        valence: 5,
        arousal: 6,
        dance: 0.8,
        cues_json: cuesJson,
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ present: 1, beats_at: null, mood_at: null }) as T,
      keyRecord: () => null,
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    const result = setCandidates(reader, 0);
    const cued = result.candidates[0]!;
    expect(cued.cues).toEqual([
      { bar: 1, position: 0 },
      { bar: 25, position: 45.1 },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("#106 Phase D: malformed cues_json degrades to [] (warned, never fatal)", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-cues-bad-"));
    const audioPath = join(dir, "cued.m4a");
    writeFileSync(audioPath, "cached test fixture");
    const dbRows = [
      {
        video_id: "broken",
        title: "Broken",
        artist: "DJ",
        duration_s: 300,
        file_path: audioPath,
        bpm_folded: 128,
        valence: 5,
        arousal: 6,
        dance: 0.8,
        cues_json: "{not json",
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ present: 1, beats_at: null, mood_at: null }) as T,
      keyRecord: () => null,
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    const result = setCandidates(reader, 0);
    expect(result.candidates[0]!.cues).toEqual([]); // degrade, don't crash
    rmSync(dir, { recursive: true, force: true });
  });

  test("#106 Phase D: a pre-cues archive DB (no cues table) still builds a pool", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-precues-"));
    const audioPath = join(dir, "old.m4a");
    writeFileSync(audioPath, "cached test fixture");
    const dbRows = [
      {
        video_id: "old",
        title: "Old DB",
        artist: "DJ",
        duration_s: 300,
        file_path: audioPath,
        bpm_folded: 128,
        valence: 5,
        arousal: 6,
        dance: 0.8,
        cues_json: null, // column absent → SELECT NULL AS cues_json
      },
    ];
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      // present: 0 → the cues join is skipped entirely
      row: <T>() => ({ present: 0, beats_at: null, mood_at: null }) as T,
      keyRecord: () => null,
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    const result = setCandidates(reader, 0);
    expect(result.total).toBe(1);
    expect(result.candidates[0]!.cues).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("one physical file can enter the candidate pool only once", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-dedupe-"));
    const audioPath = join(dir, "same-track.m4a");
    writeFileSync(audioPath, "cached test fixture");
    const dbRows = ["older-id", "newer-id"].map((video_id) => ({
      video_id,
      title: "Same track",
      artist: "DJ",
      duration_s: 300,
      file_path: audioPath,
      bpm_folded: 128,
      valence: 5,
      arousal: 6,
      dance: 0.8,
    }));
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() => dbRows as T[],
      row: <T>() => ({ beats_at: null, mood_at: null }) as T,
      keyRecord: () => ({ key: "8A", analyzedAt: "2026-09-11" }),
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    try {
      const result = setCandidates(reader, 0);

      expect(result.sourceTotal).toBe(2);
      expect(result.total).toBe(1);
      expect(result.missingFiles).toBe(0);
      expect(result.duplicateFiles).toBe(1);
      expect(result.candidates).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Rekordbox metadata supplies key and BPM without probing the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-rb-source-"));
    const audioPath = join(dir, "master-track.m4a");
    writeFileSync(audioPath, "the file must not be decoded for known metadata");
    const reader: ArchiveQuery = {
      available: () => true,
      rows: <T>() =>
        [
          {
            video_id: "master-track",
            title: "Master Track",
            artist: "DJ",
            duration_s: 300,
            file_path: audioPath,
            bpm_folded: null,
            rekordbox_bpm: 127.5,
            rekordbox_key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
          },
        ] as T[],
      row: <T>(sql: string) =>
        (sql.includes("sqlite_master")
          ? { present: 1 }
          : { beats_at: null, mood_at: null }) as T,
      keyRecord: () => null,
      rememberKeyRecord: () => undefined,
      trackCols: () => "",
    };

    const result = setCandidates(reader, 0);
    expect(result.rekordboxBpmHits).toBe(1);
    expect(result.rekordboxKeyHits).toBe(1);
    expect(result.keyReads).toBe(0);
    const candidate = result.candidates[0]!;
    expect(candidate.bpm).toBe(127.5);
    expect(candidate.key).toBe("8A");
    rmSync(dir, { recursive: true, force: true });
  });

  test("paths moved from DJ-Imports resolve under the mounted shelf", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-relocated-"));
    const path = join(dir, "archive.db");
    const shelfContents = join(dir, "SHELF1", "Contents");
    const relative = join("2026-09-11 intake", "track.m4a");
    const stalePath = join(dir, "Music", "DJ-Imports", relative);
    const actualPath = join(shelfContents, relative);
    mkdirSync(join(shelfContents, "2026-09-11 intake"), { recursive: true });
    writeFileSync(actualPath, "actual shelf file");
    const db = new Database(path, { create: true });
    db.exec(`
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration_s REAL,
        file_path TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE beats (
        video_id TEXT PRIMARY KEY, bpm_folded REAL, analyzed_at TEXT NOT NULL
      );
      CREATE TABLE mood (
        video_id TEXT PRIMARY KEY, valence REAL, arousal REAL, dance REAL,
        analyzed_at TEXT NOT NULL
      );
      CREATE TABLE rekordbox_content (
        content_id TEXT PRIMARY KEY, video_id TEXT NOT NULL,
        folder_path TEXT NOT NULL, metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.query(`INSERT INTO tracks VALUES (?, ?, ?, ?, ?, 'downloaded', ?)`).run(
      "track",
      "Track",
      "DJ",
      300,
      stalePath,
      "2026-09-11",
    );
    db.query(`INSERT INTO beats VALUES (?, ?, ?)`).run(
      "track",
      128,
      "2026-09-11",
    );
    db.query(`INSERT INTO mood VALUES (?, ?, ?, ?, ?)`).run(
      "track",
      5,
      6,
      0.8,
      "2026-09-11",
    );
    db.query(`INSERT INTO rekordbox_content VALUES (?, ?, ?, ?, ?)`).run(
      "rb-track",
      "track",
      actualPath,
      JSON.stringify({ BPM: 12_800, KeyName: "8A" }),
      "2026-09-11",
    );
    db.close();

    try {
      const reader = new ArchiveReader(path, shelfContents);
      const result = reader.setCandidates(0);

      expect(result.total).toBe(1);
      expect(result.missingFiles).toBe(0);
      expect(result.duplicateFiles).toBe(0);
      expect(result.relocatedFiles).toBe(1);
      expect(result.candidates[0]?.filePath).toBe(actualPath);
      expect(result.candidates[0]?.key).toBe("8A");
      expect(result.rekordboxKeyHits).toBe(1);
      expect(result.keyReads).toBe(0);
      reader.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a proposal cannot create or write a key-cache table", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-readonly-"));
    const path = join(dir, "archive.db");
    const audioPath = join(dir, "track.m4a");
    writeFileSync(audioPath, "not real audio");
    const db = new Database(path, { create: true });
    db.exec(`
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration_s REAL,
        file_path TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE beats (
        video_id TEXT PRIMARY KEY, bpm_folded REAL, analyzed_at TEXT NOT NULL
      );
      CREATE TABLE mood (
        video_id TEXT PRIMARY KEY, valence REAL, arousal REAL, dance REAL,
        analyzed_at TEXT NOT NULL
      );
    `);
    db.query(`INSERT INTO tracks VALUES (?, ?, ?, ?, ?, 'downloaded', ?)`).run(
      "track",
      "Track",
      "DJ",
      300,
      audioPath,
      "2026-09-11",
    );
    db.query(
      `INSERT INTO tracks VALUES (?, ?, ?, ?, NULL, 'downloaded', ?)`,
    ).run("no-path", "No path", "DJ", 300, "2026-09-11");
    db.query(`INSERT INTO beats VALUES (?, ?, ?)`).run(
      "track",
      128,
      "2026-09-11",
    );
    db.query(`INSERT INTO mood VALUES (?, ?, ?, ?, ?)`).run(
      "track",
      5,
      6,
      0.8,
      "2026-09-11",
    );
    db.close();

    try {
      const reader = new ArchiveReader(path);
      const result = reader.setCandidates(0);
      expect(result.sourceTotal).toBe(2);
      expect(result.missingFiles).toBe(1);
      reader.close();
      const check = new Database(path, { readonly: true });
      const cacheTable = check
        .query(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'track_keys'`,
        )
        .get();
      check.close();
      expect(cacheTable).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a changed file invalidates its cached musical key", () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-setbuild-key-cache-"));
    const path = join(dir, "archive.db");
    const audioPath = join(dir, "track.m4a");
    writeFileSync(audioPath, "newer contents");
    const db = new Database(path, { create: true });
    db.exec(`
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL
      );
      CREATE TABLE track_keys (
        video_id TEXT PRIMARY KEY, key TEXT NOT NULL,
        source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
      );
    `);
    db.query(`INSERT INTO tracks VALUES (?, ?)`).run(
      "track",
      "2026-09-11T00:00:00.000Z",
    );
    db.query(`INSERT INTO track_keys VALUES (?, ?, ?, ?)`).run(
      "track",
      "8A",
      audioPath,
      "2000-01-01T00:00:00.000Z",
    );
    db.close();

    try {
      const reader = new ArchiveReader(path);
      expect(reader.keyRecord("track", audioPath)).toBeNull();
      reader.rememberKeyRecord({
        videoId: "track",
        key: "9A",
        sourcePath: audioPath,
      });
      expect(reader.keyRecord("track", audioPath)?.key).toBe("9A");
      writeFileSync(audioPath, "replacement contents with a distinct size");
      expect(reader.keyRecord("track", audioPath)).toBeNull();
      reader.close();

      // The refreshed value is process-local: the archive ledger remains
      // untouched, preserving the route's physical readonly guarantee.
      const check = new Database(path, { readonly: true });
      const persisted = check
        .query(`SELECT key FROM track_keys WHERE video_id = ?`)
        .get("track") as { key: string };
      expect(persisted.key).toBe("8A");
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
