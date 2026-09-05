// archive.ts — O82b: read-only archive queries for agents.
//
// The ideas doc's O82b spec: `search_tracks`, `track_stats`, `ingest_status`,
// `playlist_diff`, `lowq_queue` — "the same thin-wrapper pattern over the
// archive DB". This module is the pure half (schema in → data out, no I/O
// beyond one readonly sqlite handle); index.ts + mcp.ts wrap it.
//
// READ-ONLY, by construction and by promise: opened with `readonly: true` so
// a bug here physically cannot corrupt megadj's state (P9 safety rails).
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

/** Rows of megadj's `tracks` table (src/state.ts) — the fields agents ask
 *  about. Kept structurally compatible, not imported: the archive DB may be
 *  older/newer than this build. */
export interface ArchiveTrack {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  bitrate_kbps: number | null;
  codec: string | null;
  file_path: string | null;
  duration_s: number | null;
  genre: string | null;
  energy: number | null;
  source: string;
  liked_position: number | null;
  first_seen_at: string;
  updated_at: string;
}

const TRACK_COLS = `video_id, title, artist, album, status, bitrate_kbps,
  codec, file_path, duration_s, genre, energy, source, liked_position,
  first_seen_at, updated_at`;

export class ArchiveReader {
  private db: Database | null = null;
  constructor(readonly path: string) {}

  /** Lazily open readonly; missing DB → null (agents get a clean "no
   *  archive yet" result, not a stack trace). */
  private handle(): Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    this.db = new Database(this.path, { readonly: true });
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private rows<T>(sql: string, ...params: unknown[]): T[] {
    const db = this.handle();
    if (!db) return [];
    return db.query(sql).all(...(params as never[])) as T[];
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

  /** Ingest pipeline status: per-status counts, recent runs, newest files. */
  ingestStatus(): {
    available: boolean;
    counts: Record<string, number>;
    total: number;
    recent_runs: {
      started_at: string;
      finished_at: string | null;
      downloaded: number;
      failed: number;
      gone: number;
    }[];
    recent_tracks: ArchiveTrack[];
  } {
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
      downloaded: number;
      failed: number;
      gone: number;
    }>(
      `SELECT started_at, finished_at, downloaded, failed, gone FROM runs
       ORDER BY id DESC LIMIT 5`,
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
  lowqQueue(): {
    available: boolean;
    tracks: (ArchiveTrack & { reason: string })[];
  } {
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
   * INDEPENDENT beatgrid cross-check (roadmap rev 5 §2/#2): beat_this's
   * beat arrays (megadj `beats` ledger) vs the track's rekordbox BPM +
   * duration. The verify pipeline's own grid check is self-referential
   * (duration × BPM vs beat count from the SAME analysis) — this one
   * compares a SECOND analyzer's grid against RB's numbers, so a drifted
   * or octave-locked grid actually shows.
   *
   * Per-track verdict: ok | off (grid implies a tempo >2% from RB's) |
   * octave (fold mismatch — grid locks half/double) | no-data.
   */
  gridCrossCheck(limit = 200): {
    available: boolean;
    ledgered: number;
    checked: number;
    ok: number;
    off: Array<{
      video_id: string;
      title: string | null;
      rbBpm: number;
      ledgerBpm: number;
    }>;
    octave: Array<{
      video_id: string;
      title: string | null;
      rbBpm: number;
      ledgerBpm: number;
    }>;
  } {
    // Pre-ledger archive DBs have no `beats` table — degrade to an empty
    // result (the SQLiteError would otherwise break every caller).
    const hasBeats = this.rows<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'beats'`,
    );
    if (!hasBeats.length) {
      return {
        available: this.handle() !== null,
        ledgered: 0,
        checked: 0,
        ok: 0,
        off: [],
        octave: [],
      };
    }
    const rows = this.rows<{
      video_id: string;
      title: string | null;
      duration_s: number | null;
      beats_json: string;
      bpm_folded: number | null;
    }>(
      `SELECT t.video_id, t.title, t.duration_s, b.beats_json, b.bpm_folded
       FROM tracks t JOIN beats b ON b.video_id = t.video_id
       WHERE t.status = 'downloaded' AND t.duration_s IS NOT NULL
       ORDER BY t.updated_at DESC LIMIT ?`,
      Math.min(Math.max(limit, 1), 500),
    );
    const off: {
      video_id: string;
      title: string | null;
      rbBpm: number;
      ledgerBpm: number;
    }[] = [];
    const octave: {
      video_id: string;
      title: string | null;
      rbBpm: number;
      ledgerBpm: number;
    }[] = [];
    const result = {
      available: this.handle() !== null,
      ledgered: rows.length,
      checked: 0,
      ok: 0,
      off,
      octave,
    };
    for (const r of rows) {
      if (r.bpm_folded == null) continue;
      let beats: number[] = [];
      try {
        beats = JSON.parse(r.beats_json) as number[];
      } catch {
        continue;
      }
      if (beats.length < 8 || !r.duration_s) continue;
      result.checked++;
      const gridSpan = beats[beats.length - 1]! - beats[0]!;
      if (gridSpan <= 0) continue;
      // Tempo the beat_this GRID implies, over its own wall-clock span.
      const gridBpm = ((beats.length - 1) / gridSpan) * 60;
      // Tempo RB's DB implies for the same track: its BPM × duration.
      // The independent ruler is duration: how many beat_this beats fit
      // in the track vs how many RB BPM beats SHOULD fit.
      const rbBpm = r.bpm_folded;
      const expectedBeats = (r.duration_s / 60) * rbBpm;
      const beatCountDev =
        Math.abs(beats.length - expectedBeats) / expectedBeats;
      const folded = (b: number): number => {
        let x = b;
        while (x < 70) x *= 2;
        while (x > 180) x /= 2;
        return x;
      };
      const gridFolded = folded(gridBpm);
      const ratio = gridFolded / rbBpm;
      // Octave lock: the grid counts half/double the beats RB expects.
      const isOctave =
        Math.abs(ratio - 2) < 0.06 ||
        Math.abs(ratio - 0.5) < 0.03 ||
        Math.abs(beats.length / expectedBeats - 2) < 0.06 ||
        Math.abs(beats.length / expectedBeats - 0.5) < 0.03;
      if (isOctave) {
        octave.push({
          video_id: r.video_id,
          title: r.title,
          rbBpm,
          ledgerBpm: Math.round(gridFolded * 10) / 10,
        });
      } else if (beatCountDev > 0.02) {
        off.push({
          video_id: r.video_id,
          title: r.title,
          rbBpm,
          ledgerBpm: Math.round(gridBpm * 10) / 10,
        });
      } else {
        result.ok++;
      }
    }
    result.ok = result.checked - off.length - octave.length;
    return result;
  }

  /**
   * MOOD / dance / valence profile (roadmap #4): the aggregate + the
   * extremes of megadj's `mood` ledger (mirror of the TXXX:MOOD file
   * stamps, written by `megadj mood`). Gives agents/UI the vibe-map view
   * without touching audio: averages for pickers, highest/lowest
   * valence + arousal + danceability tracks for "play me something…".
   * Degrades to available:false on pre-mood DBs (no `mood` table).
   */
  moodProfile(limit = 5): {
    available: boolean;
    analyzed: number;
    avg: {
      dance: number;
      valence: number;
      arousal: number;
      party: number;
      electronic: number;
      aggressive: number;
    };
    extremes: {
      valence: MoodExtreme[];
      arousal: MoodExtreme[];
      dance: MoodExtreme[];
    };
  } {
    const empty = {
      available: this.handle() !== null,
      analyzed: 0,
      avg: {
        dance: 0,
        valence: 0,
        arousal: 0,
        party: 0,
        electronic: 0,
        aggressive: 0,
      },
      extremes: {
        valence: [] as MoodExtreme[],
        arousal: [] as MoodExtreme[],
        dance: [] as MoodExtreme[],
      },
    };
    const hasMood = this.rows<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mood'`,
    );
    if (!hasMood.length) return empty;
    const agg = this.rows<{
      n: number;
      dance: number | null;
      valence: number | null;
      arousal: number | null;
      party: number | null;
      electronic: number | null;
      aggressive: number | null;
    }>(
      `SELECT COUNT(*) n, AVG(dance) dance, AVG(valence) valence,
              AVG(arousal) arousal, AVG(party) party,
              AVG(electronic) electronic, AVG(aggressive) aggressive
       FROM mood`,
    )[0];
    if (!agg || !agg.n) return empty;
    const r4 = (v: number | null): number => Math.round((v ?? 0) * 1000) / 1000;
    const n = Math.min(Math.max(limit, 1), 25);
    const top = (col: string, dir: "DESC" | "ASC"): MoodExtreme[] =>
      this.rows<{
        video_id: string;
        title: string | null;
        artist: string | null;
        v: number;
      }>(
        `SELECT m.video_id, t.title, t.artist, m.${col} v
         FROM mood m LEFT JOIN tracks t ON t.video_id = m.video_id
         ORDER BY m.${col} ${dir}, m.video_id LIMIT ?`,
        n,
      ).map((row) => ({ ...row, v: r4(row.v) }));
    return {
      available: true,
      analyzed: agg.n,
      avg: {
        dance: r4(agg.dance),
        valence: r4(agg.valence),
        arousal: r4(agg.arousal),
        party: r4(agg.party),
        electronic: r4(agg.electronic),
        aggressive: r4(agg.aggressive),
      },
      extremes: {
        valence: [...top("valence", "DESC"), ...top("valence", "ASC")],
        arousal: [...top("arousal", "DESC"), ...top("arousal", "ASC")],
        dance: [...top("dance", "DESC"), ...top("dance", "ASC")],
      },
    };
  }
}

interface MoodExtreme {
  video_id: string;
  title: string | null;
  artist: string | null;
  v: number;
}
