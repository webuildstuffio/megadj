// archive.ts — O82b: read-only archive queries for agents.
//
// The ideas doc's O82b spec: `search_tracks`, `track_stats`, `ingest_status`,
// `playlist_diff`, `lowq_queue` — "the same thin-wrapper pattern over the
// archive DB". This module is the public façade; the SQLite query body
// (readonly handle, rows/row seam, track_keys cache, TRACK_COLS) lives in
// archive/reader-core.ts (#205 split, the #203/#204 pattern). index.ts +
// mcp.ts wrap it.
//
// READ-ONLY, by construction and by promise: opened with `readonly: true` so
// a bug here physically cannot corrupt megadj's state (P9 safety rails).
import { similarTracks as similarTracksImpl } from "./archive/similar";
import {
  genreWhy as genreWhyImpl,
  type ArchiveGenreWhy,
} from "./archive/genre";
import {
  cueStats as cueStatsImpl,
  libraryOverview as libraryOverviewImpl,
} from "./archive/overview";
import { tagCensus as tagCensusImpl } from "./archive/tag-census";
import {
  poolFreshness as poolFreshnessImpl,
  setCandidates as setCandidatesImpl,
} from "./archive/pool";
import { trackTagCompare as trackTagCompareImpl } from "./archive/tag-compare";
import { gridCrossCheck as gridCrossCheckImpl } from "./archive/grid";
import { moodProfile as moodProfileImpl } from "./archive/mood";
import type { ArchiveQuery, ArchiveTrack } from "./archive/types";
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
// ArchiveTrack is canonically defined in the leaf archive/types.ts (along
// with the ArchiveQuery seam the split-out modules type against); re-export
// keeps every existing `from "./archive"` import working unchanged.
export type { ArchiveTrack } from "./archive/types";
// The core stays importable from archive/reader-core.ts (the canonical
// home); no re-export here — the split modules type against the
// ArchiveQuery leaf, not this class.
import { ArchiveReaderCore, TRACK_COLS } from "./archive/reader-core";

/** Public archive-query facade over the read-only core. */
export class ArchiveReader extends ArchiveReaderCore implements ArchiveQuery {
  /**
   * STRUCTURE CUES ledger (roadmap "structure cues" slice): DJ phrase
   * markers (every 8 bars) derived from the beats ledger's downbeats by
   * `megadj cues`. Implementation lives in archive/overview.ts
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

  /** Ingest pipeline status: per-status counts, recent runs, newest files.
   *  #256: the surfaced-link cohort rides along (its own list — surfaced
   *  rows are "go buy it / grab the official file" work, not library). */
  ingestStatus(): ArchiveIngestStatus {
    const db = this.handle();
    if (!db) {
      return {
        available: false,
        counts: {},
        total: 0,
        recent_runs: [],
        recent_tracks: [],
        surfaced: [],
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
    // Surfaced-link workflow (Sep 19): source_links JSON is the URL
    // source of truth (last_error is prose); surfaced_done_at is the
    // user's checklist. Parsed here so every client gets typed URLs.
    const surfacedRaw = this.rows<{
      video_id: string;
      title: string | null;
      artist: string | null;
      source_links: string | null;
      surfaced_done_at: string | null;
    }>(
      `SELECT video_id, title, artist, source_links, surfaced_done_at
       FROM tracks WHERE status = 'link_surfaced'
       ORDER BY surfaced_done_at IS NOT NULL, updated_at DESC LIMIT 200`,
    );
    const surfaced = surfacedRaw.map((r) => {
      let links: { kind: string; url: string }[] = [];
      try {
        const parsed: unknown = JSON.parse(r.source_links ?? "[]");
        if (Array.isArray(parsed))
          links = parsed.flatMap((l) => {
            if (typeof l !== "object" || l === null) return [];
            const rec = l as Record<string, unknown>;
            if (typeof rec.url !== "string") return [];
            return [
              {
                kind: typeof rec.kind === "string" ? rec.kind : "link",
                url: rec.url,
              },
            ];
          });
      } catch (error) {
        // Corrupt source_links JSON must be visible, never a silent
        // empty list (boundary-json census: the guard must report).
        console.error(`surfaced links unparsable for ${r.video_id}:`, error);
      }
      return {
        video_id: r.video_id,
        title: r.title,
        artist: r.artist,
        url: links[0]?.url ?? null,
        links,
        done: r.surfaced_done_at !== null,
        done_at: r.surfaced_done_at,
      };
    });
    const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n]));
    return {
      available: true,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      recent_runs: runs,
      recent_tracks: recent,
      surfaced,
    };
  }

  /** LOWQ upgrade queue (D24): downloaded tracks below the DJ quality bar —
   *  lossy codecs under bitrate floors. Duration NULLs excluded (unknown).
   *  #258: soundcloud-source rows use the SC platform ceiling instead
   *  (160k aac / 128k mp3 — hls_aac_160k is the best SC serves), and are
   *  the ONLY rows here that cannot be upgraded by re-download. */
  lowqQueue(): ArchiveLowqQueue {
    const rows = this.rows<ArchiveTrack>(
      `SELECT ${TRACK_COLS} FROM tracks
       WHERE status = 'downloaded' AND bitrate_kbps IS NOT NULL
         AND duration_s IS NOT NULL AND (
           (source = 'soundcloud' AND
             ((codec IN ('mp4a', 'aac') AND bitrate_kbps < 160) OR
              (codec = 'mp3' AND bitrate_kbps < 128)))
           OR
           (source != 'soundcloud' AND
             ((codec IN ('mp4a', 'aac') AND bitrate_kbps < 256) OR
              (codec = 'mp3' AND bitrate_kbps < 320))))
       ORDER BY bitrate_kbps ASC LIMIT 200`,
    );
    return {
      available: this.handle() !== null,
      tracks: rows.map((t) => ({
        ...t,
        reason:
          t.source === "soundcloud"
            ? `${t.bitrate_kbps} kbps ${t.codec ?? "audio"} — below the SoundCloud ceiling (160k aac)`
            : `${t.bitrate_kbps} kbps ${t.codec ?? "audio"} — below the set-ready floor`,
      })),
    };
  }

  /** The download queue awaiting `sync` (the Backlog tab's pending card):
   *  what sync WOULD attempt next, so the user can review it and mark
   *  non-music rows out (megadj skip). Source + attempts shown so a
   *  YouTube-shaped row is recognizable before committing. */
  pendingQueue(limit = 200): {
    available: boolean;
    tracks: {
      video_id: string;
      title: string | null;
      artist: string | null;
      duration_s: number | null;
      status: string;
      source: string;
      attempts: number;
    }[];
  } {
    const rows = this.rows<{
      video_id: string;
      title: string | null;
      artist: string | null;
      duration_s: number | null;
      status: string;
      source: string;
      attempts: number;
    }>(
      `SELECT video_id, title, artist, duration_s, status, source, attempts
       FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
       ORDER BY status = 'pending' DESC, liked_position IS NULL, liked_position, first_seen_at
       LIMIT ?`,
      limit,
    );
    return { available: this.handle() !== null, tracks: rows };
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
   * archive/grid.ts (file-length guard); delegate keeps the surface.
   */
  gridCrossCheck(limit = 200): ArchiveGridCrossCheck {
    return gridCrossCheckImpl(this, limit);
  }

  /**
   * MOOD / dance / valence profile (roadmap #4): the aggregate + extremes
   * of megadj's `mood` ledger — the vibe-map view. Implementation lives
   * in archive/mood.ts (file-length guard); delegate keeps the surface.
   */
  moodProfile(limit = 5): ArchiveMoodProfile {
    return moodProfileImpl(this, limit);
  }

  // I49 sounds-like + set-builder extensions live in archive/similar.ts
  // (file-length guard);
  // these delegates keep the call sites (`archive.similarTracks(...)`)
  // unchanged while the implementations stay outside this file.
  similarTracks(videoId: string, k = 10, space = "raw"): ArchiveSimilar {
    return similarTracksImpl(this, videoId, k, space);
  }

  /**
   * GENRE-WHY (#215): one track's #173 vote-ladder breakdown, re-elected
   * through the write path's exact seam. Implementation lives in
   * archive/genre.ts (file-length guard); delegate keeps the surface.
   */
  genreWhy(videoId: string): ArchiveGenreWhy {
    return genreWhyImpl(this, videoId);
  }

  setCandidates(limit?: number): ArchiveSetCandidates {
    return setCandidatesImpl(this, limit, this.shelfContents);
  }

  /** Newest beats/mood ledger timestamps — set-builder staleness UX.
   *  Implementation in archive/pool.ts (poolFreshness). */
  freshness(): ArchiveFreshness {
    return poolFreshnessImpl(this);
  }

  /**
   * LIBRARY OVERVIEW (FullTags read side): what the enrichment engine has
   * actually stamped across the playable archive. Implementation lives in
   * archive/overview.ts (file-length guard); delegate keeps the surface.
   */
  libraryOverview(recentLimit = 60): ArchiveLibraryOverview {
    return libraryOverviewImpl(this, recentLimit);
  }

  /**
   * TAG CENSUS (FullTags ↔ rekordbox): which playable tracks' two DB
   * mirrors disagree, on what. Pure-DB; files are never read on the
   * census path. Implementation in archive/tag-census.ts (file-length
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
