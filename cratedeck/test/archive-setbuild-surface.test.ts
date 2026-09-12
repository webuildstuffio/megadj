import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { setCandidates } from "../src/archive_similar";
import { archiveRoutes } from "../src/archive_routes";
import { archiveTools } from "../src/archive_tools";
import { ArchiveReader } from "../src/archive";
import type { CrateConfig } from "../src/config";
import type { DB } from "../src/db";
import type { ArchiveQuery } from "../src/archive_types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type SetBuildTool = {
  run(args: Record<string, unknown>): Promise<unknown>;
};

function captureSetBuildRequest(): {
  urls: URL[];
  tool: SetBuildTool;
} {
  const urls: URL[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      return Response.json({ ok: true });
    },
    { preconnect: originalFetch.preconnect },
  );
  return {
    urls,
    tool: archiveTools().archive_set_build as SetBuildTool,
  };
}

describe("archive_set_build candidate-pool contract", () => {
  test("an absent limit requests the entire downloaded archive DB", async () => {
    const { urls, tool } = captureSetBuildRequest();

    await tool.run({});

    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toBe("/api/archive/setbuild");
    expect(urls[0]!.searchParams.has("limit")).toBe(false);
  });

  test("an explicit limit remains bounded", async () => {
    const { urls, tool } = captureSetBuildRequest();

    await tool.run({ limit: 99_999 });

    expect(urls[0]!.searchParams.get("limit")).toBe("1000");
  });

  test("an explicitly invalid limit is rejected instead of triggering a full scan", async () => {
    const { urls, tool } = captureSetBuildRequest();

    expect(tool.run({ limit: "all" })).rejects.toThrow(
      "limit must be a finite number",
    );
    expect(urls).toHaveLength(0);
  });

  test("the HTTP surface rejects an invalid limit instead of silently scanning everything", async () => {
    const response = await archiveRoutes(
      "/archive/setbuild",
      new URL("http://localhost/api/archive/setbuild?limit=all"),
      {
        archive: {} as ArchiveReader,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: "limit must be a finite number",
    });
  });

  test("the Rekordbox export surface returns an importable read-only M3U8", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const archive = {
      setCandidates: () => ({
        available: true,
        sourceTotal: 1,
        total: 1,
        missingFiles: 0,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    const response = await archiveRoutes(
      "/archive/setbuild",
      new URL(
        "http://localhost/api/archive/setbuild?preset=warmup&minutes=10&format=m3u8",
      ),
      {
        archive,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("mpegurl");
    expect(response?.headers.get("content-disposition")).toContain("5m.m3u8");
    expect(await response?.text()).toBe(
      `#EXTM3U\n#EXTINF:300,Test Artist - Test Track\n${filePath}\n`,
    );
  });

  test("the full DB is audited, but missing files cannot enter a proposal", () => {
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
        bpm_folded: 128,
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
        bpm_folded: 128,
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
      expect(result.duplicateFiles).toBe(0);
      expect(result.candidates.map((candidate) => candidate.videoId)).toEqual([
        "actual",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    db.close();

    try {
      const reader = new ArchiveReader(path, shelfContents);
      const result = reader.setCandidates(0);

      expect(result.total).toBe(1);
      expect(result.missingFiles).toBe(0);
      expect(result.duplicateFiles).toBe(0);
      expect(result.relocatedFiles).toBe(1);
      expect(result.candidates[0]?.filePath).toBe(actualPath);
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
