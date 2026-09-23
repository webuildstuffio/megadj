import { describe, expect, test, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveState } from "../core/state";
import { rbAdopt, type RekordboxContentRow } from "./rb-adopt";
import { reconcileRekordboxRows, rekordboxCodec } from "./rb-adopt-apply";
import { tempDir, stateIn } from "../test-support/testutil";

const t = tempDir("megadj-rb-adopt-").rippable();
afterAll(() => t.rippleAll());

function fixture(): {
  root: string;
  state: ArchiveState;
  existingPath: string;
  newPath: string;
} {
  const root = t.dir();
  const existingPath = join(root, "existing.aiff");
  const newPath = join(root, "new.mp3");
  writeFileSync(existingPath, "existing audio");
  writeFileSync(newPath, "new audio");
  const state = stateIn(root);
  state.upsertTrackFromPlaylist("youtube-real-id", 0, "Existing");
  state.markDownloaded("youtube-real-id", {
    title: "Existing",
    artist: "Original artist",
    album: null,
    formatId: null,
    bitrateKbps: null,
    codec: null,
    filePath: existingPath,
    fileSizeBytes: 14,
    durationS: 120,
  });
  return { root, state, existingPath, newPath };
}

function rows(existingPath: string, newPath: string): RekordboxContentRow[] {
  return [
    {
      contentId: "1001",
      folderPath: existingPath,
      title: "Existing from Rekordbox",
      artist: "RB artist",
      album: "RB album",
      genre: "House",
      durationS: 120,
      bitrateKbps: 1411,
      fileSizeBytes: 14,
      year: "2024",
      metadata: { ID: "1001", Rating: 5, BPM: 12800 },
    },
    {
      contentId: "1002",
      folderPath: newPath,
      title: "New from Rekordbox",
      artist: "New artist",
      album: null,
      genre: "Techno",
      durationS: 180,
      bitrateKbps: 320,
      fileSizeBytes: 9,
      year: "2025",
      metadata: { ID: "1002", Rating: 4, BPM: 13000 },
    },
    // Rekordbox can contain multiple Content IDs for one physical file.
    // Both identities must survive while archive keeps one track per file.
    {
      contentId: "1003",
      folderPath: newPath,
      title: "New duplicate Content row",
      artist: "New artist",
      album: null,
      genre: "Techno",
      durationS: 180,
      bitrateKbps: 320,
      fileSizeBytes: 9,
      year: "2025",
      metadata: { ID: "1003", Rating: 4, BPM: 13000 },
    },
  ];
}

describe("rb-adopt", () => {
  test("top-level apply requires confirmation and snapshots archive.db", () => {
    const { root, state, existingPath, newPath } = fixture();
    const mount = join(root, "SHELF1");
    const master = join(mount, "PIONEER", "Master", "master.db");
    mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
    writeFileSync(master, "reader seam fixture");
    let reads = 0;
    const readContent = (): RekordboxContentRow[] => {
      reads += 1;
      return rows(existingPath, newPath);
    };
    try {
      const refused = rbAdopt({
        state,
        archiveDb: join(root, "archive.db"),
        mount,
        apply: true,
        readContent,
      });
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain("--yes");
      expect(reads).toBe(0);

      const applied = rbAdopt({
        state,
        archiveDb: join(root, "archive.db"),
        mount,
        apply: true,
        yes: true,
        readContent,
      });
      expect(applied).toMatchObject({ ok: true, total: 3, applied: 3 });
      expect(applied.backedUpTo).not.toBeNull();
      expect(existsSync(applied.backedUpTo!)).toBe(true);
      const backup = new Database(applied.backedUpTo!, {
        readonly: true,
        create: false,
      });
      try {
        expect(
          backup.query("SELECT COUNT(*) AS n FROM tracks").get() as {
            n: number;
          },
        ).toEqual({ n: 1 });
      } finally {
        backup.close();
      }
    } finally {
      state.close();
    }
  });

  test("an empty master census can never prune the archive mirror", () => {
    const { state } = fixture();
    try {
      const result = reconcileRekordboxRows({
        state,
        sourceDb: "/empty/master.db",
        rows: [],
        apply: true,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("empty");
      expect(
        state.db.query("SELECT COUNT(*) AS n FROM tracks").get() as {
          n: number;
        },
      ).toEqual({ n: 1 });
    } finally {
      state.close();
    }
  });

  test("dry-run plans the complete master census without changing archive", () => {
    const { state, existingPath, newPath } = fixture();
    try {
      const result = reconcileRekordboxRows({
        state,
        sourceDb: "/Volumes/SHELF1/PIONEER/Master/master.db",
        rows: rows(existingPath, newPath),
        apply: false,
      });

      expect(result).toMatchObject({
        ok: true,
        total: 3,
        uniqueFiles: 2,
        matchedExisting: 1,
        wouldCreate: 1,
        duplicateContentPaths: 1,
        missingFiles: 0,
        applied: 0,
      });
      expect(
        state.db.query("SELECT COUNT(*) AS n FROM tracks").get() as {
          n: number;
        },
      ).toEqual({ n: 1 });
      expect(
        state.db
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='rekordbox_content'",
          )
          .get(),
      ).toBeNull();
    } finally {
      state.close();
    }
  });

  test("apply preserves source IDs, mirrors every Content row, and is idempotent", () => {
    const { state, existingPath, newPath } = fixture();
    try {
      const input = rows(existingPath, newPath);
      const first = reconcileRekordboxRows({
        state,
        sourceDb: "/Volumes/SHELF1/PIONEER/Master/master.db",
        rows: input,
        apply: true,
      });
      expect(first).toMatchObject({
        ok: true,
        total: 3,
        linked: 3,
        created: 1,
        applied: 3,
      });

      const tracks = state.db
        .query(
          "SELECT video_id, file_path, source, status FROM tracks ORDER BY video_id",
        )
        .all() as {
        video_id: string;
        file_path: string;
        source: string;
        status: string;
      }[];
      expect(tracks).toHaveLength(2);
      expect(
        tracks.find((row) => row.file_path === existingPath)?.video_id,
      ).toBe("youtube-real-id");
      expect(tracks.find((row) => row.file_path === newPath)).toMatchObject({
        video_id: "rb-1002",
        source: "rekordbox",
        status: "downloaded",
      });

      const links = state.db
        .query(
          "SELECT content_id, video_id, metadata_json FROM rekordbox_content ORDER BY content_id",
        )
        .all() as {
        content_id: string;
        video_id: string;
        metadata_json: string;
      }[];
      expect(links).toHaveLength(3);
      expect(links[0]).toMatchObject({
        content_id: "1001",
        video_id: "youtube-real-id",
      });
      expect(links[1]?.video_id).toBe("rb-1002");
      expect(links[2]?.video_id).toBe("rb-1002");
      expect(JSON.parse(links[0]!.metadata_json)).toMatchObject({
        ID: "1001",
        Rating: 5,
      });

      state.db
        .query(
          `INSERT INTO rekordbox_content (
             content_id, video_id, source_db, folder_path, metadata_json,
             first_seen_at, updated_at
           ) VALUES ('stale', 'youtube-real-id', '/Volumes/SHELF1/PIONEER/Master/master.db', '/gone', '{}', 'old', 'old')`,
        )
        .run();

      const second = reconcileRekordboxRows({
        state,
        sourceDb: "/Volumes/SHELF1/PIONEER/Master/master.db",
        rows: input,
        apply: true,
      });
      expect(second.created).toBe(0);
      expect(second.staleLinksRemoved).toBe(1);
      expect(
        state.db.query("SELECT COUNT(*) AS n FROM tracks").get() as {
          n: number;
        },
      ).toEqual({ n: 2 });
      expect(
        state.db.query("SELECT COUNT(*) AS n FROM rekordbox_content").get() as {
          n: number;
        },
      ).toEqual({ n: 3 });
      expect(existsSync(existingPath)).toBe(true);
      expect(existsSync(newPath)).toBe(true);
    } finally {
      state.close();
    }
  });

  test("codec derives from the Content FileType/BitDepth, never the extension", () => {
    // pyrekordbox FileType enum (db6/tables.py): MP3=1 M4A=4 FLAC=5 WAV=11
    // AIFF/AIF=12. WAV/AIFF need BitDepth for the exact pcm_* codec; a
    // missing depth stays null (honest gap), an unknown FileType too.
    expect(rekordboxCodec({ FileType: 1 })).toBe("mp3");
    expect(rekordboxCodec({ FileType: 4 })).toBe("aac");
    expect(rekordboxCodec({ FileType: 5 })).toBe("flac");
    expect(rekordboxCodec({ FileType: 11, BitDepth: 16 })).toBe("pcm_s16le");
    expect(rekordboxCodec({ FileType: 11, BitDepth: 24 })).toBe("pcm_s24le");
    expect(rekordboxCodec({ FileType: 11, BitDepth: 32 })).toBe("pcm_s32le");
    expect(rekordboxCodec({ FileType: 12, BitDepth: 16 })).toBe("pcm_s16be");
    expect(rekordboxCodec({ FileType: 12, BitDepth: 24 })).toBe("pcm_s24be");
    // honest gaps: missing depth / unknown type / missing metadata
    expect(rekordboxCodec({ FileType: 11 })).toBeNull();
    expect(rekordboxCodec({ FileType: 99 })).toBeNull();
    expect(rekordboxCodec({})).toBeNull();
    // .m4a name with FileType 11 (WAV) = WAV — extensions lie
    expect(
      rekordboxCodec({ FileType: 11, BitDepth: 16, FileNameL: "x.m4a" }),
    ).toBe("pcm_s16le");
  });

  test("re-adopt backfills codec on pre-existing mirror rows", () => {
    const { state, existingPath, newPath } = fixture();
    try {
      const input = rows(existingPath, newPath).map((row) => ({
        ...row,
        // realistic Content metadata: WAV 24-bit and MP3
        metadata:
          row.contentId === "1001"
            ? { ID: row.contentId, FileType: 12, BitDepth: 24 }
            : { ID: row.contentId, FileType: 1 },
      }));
      // First apply seeds rows; strip codecs to simulate the legacy mirror
      // that never wrote the column (the Sep 19 Codecs-card 3,133 case).
      reconcileRekordboxRows({
        state,
        sourceDb: "/Volumes/SHELF1/PIONEER/Master/master.db",
        rows: input,
        apply: true,
      });
      state.db.exec("UPDATE tracks SET codec = NULL");
      const again = reconcileRekordboxRows({
        state,
        sourceDb: "/Volumes/SHELF1/PIONEER/Master/master.db",
        rows: input,
        apply: true,
      });
      expect(again.ok).toBe(true);
      const codecs = state.db
        .query(
          "SELECT video_id, codec FROM tracks WHERE status = 'downloaded' ORDER BY video_id",
        )
        .all() as { video_id: string; codec: string | null }[];
      expect(codecs).toEqual([
        { video_id: "rb-1002", codec: "mp3" },
        { video_id: "youtube-real-id", codec: "pcm_s24be" },
      ]);
    } finally {
      state.close();
    }
  });
});
