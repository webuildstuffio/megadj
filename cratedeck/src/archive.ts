// archive.ts — O82b: read-only archive queries for agents.
//
// The ideas doc's O82b spec: `search_tracks`, `track_stats`, `ingest_status`,
// `playlist_diff`, `lowq_queue` — "the same thin-wrapper pattern over the
// archive DB". This module is the pure half (schema in → data out, no I/O
// beyond one readonly sqlite handle); index.ts + mcp.ts wrap it.
//
// READ-ONLY, by construction and by promise: opened with `readonly: true` so
// a bug here physically cannot corrupt megadj's state (P9 safety rails).
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { similarTracks as similarTracksImpl } from "./archive_similar";
import {
  cueStats as cueStatsImpl,
  libraryOverview as libraryOverviewImpl,
} from "./archive_overview";
import { tagCensus as tagCensusImpl } from "./archive_tagcensus";
import {
  poolFreshness as poolFreshnessImpl,
  setCandidates as setCandidatesImpl,
} from "./archive_pool";
import { trackTagCompare as trackTagCompareImpl } from "./archive_tagcompare";
import { gridCrossCheck as gridCrossCheckImpl } from "./archive_grid";
import { moodProfile as moodProfileImpl } from "./archive_mood";
import type { ArchiveQuery, ArchiveTrack } from "./archive_types";
import type {
  ArchiveAnalysisCoverage,
  ArchiveCueStats,
  ArchiveFreshness,
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLibraryOverview,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
  ArchiveSetCandidates,
  ArchiveSimilar,
  ArchiveSkipCensus,
  ArchiveSourceCensus,
  ArchiveTagCensus,
  ArchiveTrackTagCompare,
} from "../shared/archive-wire";
// ArchiveTrack is canonically defined in the leaf archive_types.ts (along
// with the ArchiveQuery seam the split-out modules type against); re-export
// keeps every existing `from "./archive"` import working unchanged.
export type { ArchiveTrack } from "./archive_types";

/** Rows of megadj's `tracks` table — see archive_types.ts. */

const TRACK_COLS = `video_id, title, artist, album, status, bitrate_kbps,
  codec, file_path, duration_s, genre, energy, source, liked_position,
  first_seen_at, updated_at`;

/** Read-only connection and key-cache query family. */
class ArchiveReaderCore {
  private db: Database | null = null;
  private hasKeyCache: boolean | null = null;
  /** Fresh file reads remembered for this reader's lifetime. This preserves
   *  the strict DB-readonly contract without paying the same stale/missing
   *  ledger miss on every set-builder request handled by the server. */
  private liveKeys = new Map<
    string,
    { key: string; analyzedAt: string; size: number; mtimeMs: number }
  >();
  readonly path: string;
  protected readonly shelfContents: string | undefined;

  constructor(path: string, shelfContents?: string) {
    this.path = path;
    this.shelfContents = shelfContents;
  }

  /** Public "is the archive DB present" probe (routes/agents use this to
   *  degrade gracefully; keeps `handle( + ` private). */
  available(): boolean {
    return this.handle() !== null;
  }

  /** Public readonly access to the opened handle — tests (readonly-flag
   *  regression) and split modules probe it without private-state casts;
   *  bun's `readonly: true` keeps writes throwing at the driver level. */
  get handleOrNull(): Database | null {
    return this.db;
  }

  /** Lazily open readonly; missing DB → null (agents get a clean "no
   *  archive yet" result, not a stack trace). */
  protected handle(): Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    this.db = new Database(this.path, { readonly: true });
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.hasKeyCache = null;
    this.liveKeys.clear();
  }

  /** Public read access for the split-out modules (archive_similar.ts):
   * parameterised SELECT only — still read-only by construction. */
  rows<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    const db = this.handle();
    if (!db) return [];
    return db.query(sql).all(...params) as T[];
  }

  /** rows(...)[0] — undefined on empty. ArchiveQuery leaf contract; see
   *  archive_types.ts. */
  row<T>(sql: string, ...params: SQLQueryBindings[]): T | undefined {
    return this.rows<T>(sql, ...params)[0];
  }

  // ---------- track_keys read-cache (strictly readonly) ----------

  private sourceIdentity(sourcePath: string): {
    size: number;
    mtimeMs: number;
  } | null {
    try {
      const stat = statSync(sourcePath);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch (error) {
      // A file can vanish between the candidate census and this lookup. A
      // missing identity must never validate a stale key record.
      console.debug("archive key cache could not stat candidate", error);
      return null;
    }
  }

  keyRecord(
    videoId: string,
    sourcePath: string,
  ): { key: string; analyzedAt: string } | null {
    const memoryKey = `${videoId}\0${sourcePath}`;
    const identity = this.sourceIdentity(sourcePath);
    if (!identity) return null;
    const live = this.liveKeys.get(memoryKey);
    if (
      live &&
      live.size === identity.size &&
      live.mtimeMs === identity.mtimeMs
    )
      return live;
    if (this.hasKeyCache === null) {
      this.hasKeyCache =
        this.row<{ present: number }>(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'track_keys'`,
        ) !== undefined;
    }
    if (!this.hasKeyCache) return null;
    const row = this.row<{
      key: string;
      analyzed_at: string;
      track_updated_at: string;
    }>(
      `SELECT k.key, k.analyzed_at, t.updated_at AS track_updated_at
       FROM track_keys k
       JOIN tracks t ON t.video_id = k.video_id
       WHERE k.video_id = ? AND k.source_path = ?`,
      videoId,
      sourcePath,
    );
    if (!row) return null;
    const analyzedAt = Date.parse(row.analyzed_at);
    const trackUpdatedAt = Date.parse(row.track_updated_at);
    if (
      !Number.isFinite(analyzedAt) ||
      !Number.isFinite(trackUpdatedAt) ||
      trackUpdatedAt > analyzedAt ||
      identity.mtimeMs > analyzedAt
    )
      return null;
    return { key: row.key, analyzedAt: row.analyzed_at };
  }

  rememberKeyRecord(rec: {
    videoId: string;
    key: string;
    sourcePath: string;
  }): void {
    const identity = this.sourceIdentity(rec.sourcePath);
    if (!identity) return;
    this.liveKeys.set(`${rec.videoId}\0${rec.sourcePath}`, {
      key: rec.key,
      analyzedAt: new Date().toISOString(),
      ...identity,
    });
  }

  /** The ArchiveTrack column list, shared by every query that returns
   *  full rows (search/stats/recent) so the wire shape can't fork. */
  trackCols(): string {
    return TRACK_COLS;
  }
}

/** Public archive-query facade over the read-only core. */
export class ArchiveReader extends ArchiveReaderCore implements ArchiveQuery {
  /**
   * STRUCTURE CUES ledger (roadmap "structure cues" slice): DJ phrase
   * markers (every 8 bars) derived from the beats ledger's downbeats by
   * `megadj cues`. Implementation lives in archive_overview.ts
   * (file-length guard); this delegate keeps the call surface unchanged.
   * Degrades to available:false on pre-cues DBs (no `cues` table).
   */
  cueStats(limit = 40): ArchiveCueStats {
    return cueStatsImpl(this, limit);
  }

  /** Case-insensitive substring search over artist/title/album/file path. */
  searchTracks(q: string, limit = 50): ArchiveTrack[] {
    const needle = `%${q.trim()}%`;
    if (q.trim().length < 2) return [];
    return this.rows(
      `SELECT ${TRACK_COLS} FROM tracks
       WHERE status = 'downloaded' AND (
         title LIKE ? OR artist LIKE ? OR album LIKE ? OR file_path LIKE ?)
       ORDER BY artist, title LIMIT ?`,
      needle,
      needle,
      needle,
      needle,
      Math.min(Math.max(limit, 1), 200),
    );
  }

  /** One track (by video id) + its enrichments, for "tell me about X". */
  trackStats(videoId: string): ArchiveTrack | null {
    return (
      (
        this.rows(
          `SELECT ${TRACK_COLS} FROM tracks WHERE video_id = ?`,
          videoId,
        ) as ArchiveTrack[]
      )[0] ?? null
    );
  }

  /** D30 archive-integrity sweep input: every downloaded track's path +
   *  size hint, for comparing the music tree against known-good hashes. */
  downloadedForSweep(): {
    file_path: string | null;
    title: string | null;
    artist: string | null;
    size_hint: number | null;
  }[] {
    return this.rows(
      `SELECT file_path, title, artist, file_size_bytes AS size_hint
       FROM tracks
       WHERE status = 'downloaded' AND file_path IS NOT NULL
       ORDER BY file_path`,
    );
  }

  /** New-music radar mirror side (#148): every downloaded row's path +
   *  identity + first-seen. The radar engine folds/strips the path; this
   *  query stays raw so the pure half owns all matching decisions. */
  downloadedForRadar(): {
    video_id: string;
    file_path: string | null;
    title: string | null;
    artist: string | null;
    first_seen_at: string | null;
  }[] {
    return this.rows(
      `SELECT video_id, file_path, title, artist, first_seen_at
       FROM tracks
       WHERE status = 'downloaded'
       ORDER BY first_seen_at DESC`,
    );
  }

  /**
   * SKIP-REASON CENSUS (GetDat Pipeline/Backlog): why non-downloaded rows
   * didn't land. Every track carries `last_error` — for gone/skipped rows
   * it holds the reason ("gone" set it to the YouTube error, the ingest
   * skipper set it to "category: …"). This read buckets them so the UI can
   * show "what the pipeline decided and why" without an agent pasting
   * queries. GONE tracks surface first (they're the actionable ones).
   */
  skipCensus(limit = 12): ArchiveSkipCensus {
    const empty = {
      available: this.handle() !== null,
      skipped: 0,
      gone: 0,
      buckets: [],
    };
    if (!this.handle()) return empty;
    // Totals come from dedicated COUNT queries — NEVER from summing the
    // bucket list, which is LIMIT-clamped (a 13th reason would silently
    // shrink the reported totals).
    const total = (kind: string): number =>
      this.rows<{ n: number }>(
        `SELECT COUNT(*) n FROM tracks WHERE status = ?`,
        kind,
      )[0]?.n ?? 0;
    const bucket = (kind: string): { reason: string; count: number }[] =>
      this.rows<{ reason: string; count: number }>(
        `SELECT COALESCE(NULLIF(TRIM(last_error), ''), 'unknown reason') reason,
               COUNT(*) count
         FROM tracks
         WHERE status = '${kind === "gone" ? "gone" : "skipped_not_music"}'
         GROUP BY 1 ORDER BY count DESC, reason LIMIT ?`,
        Math.min(Math.max(limit, 1), 50),
      );
    // gone first (actionable), then the skip categories (bookkeeping).
    const gone = total("gone");
    const skipped = total("skipped_not_music");
    return {
      available: true,
      skipped,
      gone,
      buckets: [
        ...bucket("gone").map((b) => ({ ...b, kind: "gone" })),
        ...bucket("skipped_not_music").map((b) => ({
          ...b,
          kind: "skipped",
        })),
      ],
    };
  }

  /**
   * SOURCE CENSUS (GetDat Sources): every source tag with its track count,
   * split playable vs not. The Sources tab's diff form needs to know what
   * tags EXIST before it can ask "diff which two?" — until now the UI
   * guessed with placeholder text. GONE/deleted rows still count (they
   * describe the source's history), playable is the live half.
   */
  sourceCensus(): ArchiveSourceCensus {
    const rows = this.rows<{
      source: string;
      tracks: number;
      playable: number;
    }>(
      `SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') source,
              COUNT(*) tracks,
              SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) playable
       FROM tracks GROUP BY 1 ORDER BY tracks DESC, source LIMIT 50`,
    );
    return { available: this.handle() !== null, sources: rows };
  }

  /**
   * ANALYSIS COVERAGE (FullTags): one read that joins every analysis
   * ledger against the playable archive — how many downloaded tracks have
   * beats / mood / cues, so the UI shows ONE progress picture instead of
   * three separate "X of the archive" meters that can silently disagree.
   * Degrades per-ledger on pre-ledger DBs (missing table → null).
   */
  analysisCoverage(): ArchiveAnalysisCoverage {
    const db = this.handle();
    const tracks = db
      ? (this.rows<{ n: number }>(
          `SELECT COUNT(*) n FROM tracks WHERE status = 'downloaded'`,
        )[0]?.n ?? 0)
      : 0;
    const ledger = (name: string): number | null => {
      const has = this.rows<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        name,
      );
      if (!has.length) return null;
      return (
        this.rows<{ n: number }>(`SELECT COUNT(*) n FROM ${name}`)[0]?.n ?? 0
      );
    };
    return {
      available: db !== null,
      tracks,
      beats: ledger("beats"),
      mood: ledger("mood"),
      cues: ledger("cues"),
    };
  }

  /** Ingest pipeline status: per-status counts, recent runs, newest files. */
  ingestStatus(): ArchiveIngestStatus {
    const db = this.handle();
    if (!db) {
      return {
        available: false,
        counts: {},
        total: 0,
        recent_runs: [],
        recent_tracks: [],
      };
    }
    const countRows = this.rows<{
      status: string;
      n: number;
    }>(`SELECT status, COUNT(*) n FROM tracks GROUP BY status`);
    const runs = this.rows<{
      started_at: string;
      finished_at: string | null;
      attempted: number | null;
      downloaded: number;
      failed: number;
      gone: number;
      bytes_downloaded: number | null;
    }>(
      `SELECT started_at, finished_at, attempted, downloaded, failed, gone,
              bytes_downloaded
       FROM runs ORDER BY id DESC LIMIT 5`,
    );
    const recent = this.rows<ArchiveTrack>(
      `SELECT ${TRACK_COLS} FROM tracks ORDER BY updated_at DESC LIMIT 10`,
    );
    const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n]));
    return {
      available: true,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      recent_runs: runs,
      recent_tracks: recent,
    };
  }

  /** LOWQ upgrade queue (D24): downloaded tracks below the DJ quality bar —
   *  lossy codecs under bitrate floors. Duration NULLs excluded (unknown). */
  lowqQueue(): ArchiveLowqQueue {
    const rows = this.rows<ArchiveTrack>(
      `SELECT ${TRACK_COLS} FROM tracks
       WHERE status = 'downloaded' AND bitrate_kbps IS NOT NULL
         AND duration_s IS NOT NULL AND (
           (codec IN ('mp4a', 'aac') AND bitrate_kbps < 256) OR
           (codec IN ('mp3') AND bitrate_kbps < 320))
       ORDER BY bitrate_kbps ASC LIMIT 200`,
    );
    return {
      available: this.handle() !== null,
      tracks: rows.map((t) => ({
        ...t,
        reason: `${t.bitrate_kbps} kbps ${t.codec ?? "audio"} — below the set-ready floor`,
      })),
    };
  }

  /** Playlist diff across ARCHIVE sources: track sets that live in one
   *  source's liked list but not another (e.g. liked vs a specific playlist
   *  sync source). N75-style fleet diff, but for the archive's own
   *  source-tagged rows. */
  sourceDiff(
    sourceA: string,
    sourceB: string,
  ): {
    available: boolean;
    a: string;
    b: string;
    only_in_a: ArchiveTrack[];
    only_in_b: ArchiveTrack[];
    shared: number;
  } | null {
    // Source tags are case-sensitive in storage ("liked", "PLxxxx"); compare
    // case-insensitively via LOWER() on BOTH sides so agents can pass either.
    const a = sourceA.trim().toLowerCase();
    const b = sourceB.trim().toLowerCase();
    const rowsA = this.rows<{ video_id: string } & ArchiveTrack>(
      `SELECT ${TRACK_COLS} FROM tracks WHERE LOWER(source) = ?`,
      a,
    );
    const rowsB = this.rows<{ video_id: string } & ArchiveTrack>(
      `SELECT ${TRACK_COLS} FROM tracks WHERE LOWER(source) = ?`,
      b,
    );
    const setB = new Set(rowsB.map((r) => r.video_id));
    const setA = new Set(rowsA.map((r) => r.video_id));
    return {
      available: this.handle() !== null,
      a,
      b,
      only_in_a: rowsA.filter((r) => !setB.has(r.video_id)),
      only_in_b: rowsB.filter((r) => !setA.has(r.video_id)),
      shared: rowsA.filter((r) => setB.has(r.video_id)).length,
    };
  }

  /**
   * INDEPENDENT beatgrid cross-check (roadmap rev 5 §2/#2 → plan.md
   * GA-04/GA-05): beat_this's grid vs rekordbox BPM, a SECOND analyzer's
   * verdicts against the stored tempo. Implementation lives in
   * archive_grid.ts (file-length guard); delegate keeps the surface.
   */
  gridCrossCheck(limit = 200): ArchiveGridCrossCheck {
    return gridCrossCheckImpl(this, limit);
  }

  /**
   * MOOD / dance / valence profile (roadmap #4): the aggregate + extremes
   * of megadj's `mood` ledger — the vibe-map view. Implementation lives
   * in archive_mood.ts (file-length guard); delegate keeps the surface.
   */
  moodProfile(limit = 5): ArchiveMoodProfile {
    return moodProfileImpl(this, limit);
  }

  // I49 sounds-like + set-builder extensions live in archive_similar.ts
  // (file-length guard);
  // these delegates keep the call sites (`archive.similarTracks(...)`)
  // unchanged while the implementations stay outside this file.
  similarTracks(videoId: string, k = 10, space = "raw"): ArchiveSimilar {
    return similarTracksImpl(this, videoId, k, space);
  }

  setCandidates(limit?: number): ArchiveSetCandidates {
    return setCandidatesImpl(this, limit, this.shelfContents);
  }

  /** Newest beats/mood ledger timestamps — set-builder staleness UX.
   *  Implementation in archive_pool.ts (poolFreshness). */
  freshness(): ArchiveFreshness {
    return poolFreshnessImpl(this);
  }

  /**
   * LIBRARY OVERVIEW (FullTags read side): what the enrichment engine has
   * actually stamped across the playable archive. Implementation lives in
   * archive_overview.ts (file-length guard); delegate keeps the surface.
   */
  libraryOverview(recentLimit = 60): ArchiveLibraryOverview {
    return libraryOverviewImpl(this, recentLimit);
  }

  /**
   * TAG CENSUS (FullTags ↔ rekordbox): which playable tracks' two DB
   * mirrors disagree, on what. Pure-DB; files are never read on the
   * census path. Implementation in archive_tagcensus.ts (file-length
   * guard). Degrades to rekordboxMirror:false when rb-adopt never ran.
   */
  tagCensus(limit = 200): ArchiveTagCensus {
    return tagCensusImpl(this, limit);
  }

  /**
   * TAG COMPARE (one track, three sources): the LIVE file read (ground
   * truth) + archive mirror + RB mirror, with the difference table
   * precomputed. One ffprobe+mutagen read per request — census calls
   * this never.
   */
  trackTagCompare(videoId: string): ArchiveTrackTagCompare {
    return trackTagCompareImpl(this, videoId);
  }
}
