import { ArchiveTracks } from "./state-tracks";
import { sqliteRowId } from "./sweeps";
import type { RunRow, TrackRow } from "./state-types";
import { isFiniteNumberArray } from "../shared/leaf/guards";

function parseNumberArray(
  raw: string,
  field: string,
  videoId: string,
): number[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isFiniteNumberArray(parsed)) {
      return parsed;
    }
    console.error(`beat record ${videoId} has invalid ${field}`);
  } catch (error) {
    console.error(`beat record ${videoId} has corrupt ${field}`, error);
  }
  return null;
}

/** Sync-run and beat-analysis persistence. */
export class ArchiveBeats extends ArchiveTracks {
  /** The most recent `started_at` per track source cohort (#251): the
   *  freshness block in `status --json` — source → last sync age. The
   *  LL 27-day freeze was invisible in every normal command output; a
   *  stale cohort is now one query away from the same status call. */
  lastSyncAtBySource(): Record<string, string | null> {
    const rows = this.db
      .query(
        `SELECT source, MAX(last_attempt_at) AS last_at
         FROM tracks GROUP BY source`,
      )
      .all() as { source: string; last_at: string | null }[];
    return Object.fromEntries(rows.map((r) => [r.source, r.last_at]));
  }

  startRun(): number {
    const result = this.db
      .query("INSERT INTO runs (started_at) VALUES (?)")
      .run(this.now());
    return sqliteRowId(result.lastInsertRowid);
  }

  finishRun(
    id: number,
    counts: {
      attempted: number;
      downloaded: number;
      gone: number;
      failed: number;
      bytesDownloaded: number;
    },
  ): void {
    this.db
      .query(
        "UPDATE runs SET finished_at = ?, attempted = ?, downloaded = ?, gone = ?, failed = ?, bytes_downloaded = ? WHERE id = ?",
      )
      .run(
        this.now(),
        counts.attempted,
        counts.downloaded,
        counts.gone,
        counts.failed,
        counts.bytesDownloaded,
        id,
      );
  }

  /** Whether a run row already has its finished_at stamp (the orphan-run
   *  guard in sync()'s finally reads this — finish-then-finalize must
   *  never double-stamp or zero a finished run's real totals). */
  runIsFinished(id: number): boolean {
    const row = this.db
      .query("SELECT finished_at FROM runs WHERE id = ?")
      .get(id) as { finished_at: string | null } | null;
    return row !== null && row.finished_at !== null;
  }

  lastRuns(n: number): RunRow[] {
    return this.db
      .query("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
      .all(n) as RunRow[];
  }

  setBeatRecord(rec: {
    videoId: string;
    bpmRaw: number | null;
    bpmFolded: number | null;
    beats: number[];
    downbeats: number[];
    model: string;
    sourcePath: string;
    bpmFitted?: number | null;
    residualStd?: number | null;
  }): void {
    this.db
      .query(
        `INSERT INTO beats (video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at, bpm_fitted, bpm_residual_std)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           bpm_raw = excluded.bpm_raw, bpm_folded = excluded.bpm_folded,
           beats_json = excluded.beats_json, downbeats_json = excluded.downbeats_json,
           model = excluded.model, source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at, bpm_fitted = excluded.bpm_fitted,
           bpm_residual_std = excluded.bpm_residual_std`,
      )
      .run(
        rec.videoId,
        rec.bpmRaw,
        rec.bpmFolded,
        JSON.stringify(rec.beats),
        JSON.stringify(rec.downbeats),
        rec.model,
        rec.sourcePath,
        this.now(),
        rec.bpmFitted ?? null,
        rec.residualStd ?? null,
      );
  }

  beatRecord(videoId: string): {
    videoId: string;
    bpmRaw: number | null;
    bpmFolded: number | null;
    beats: number[];
    downbeats: number[];
    model: string;
    sourcePath: string;
    analyzedAt: string;
    bpmFitted: number | null;
    residualStd: number | null;
  } | null {
    const row = this.db
      .query(
        `SELECT video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model,
                source_path, analyzed_at, bpm_fitted, bpm_residual_std
         FROM beats WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      bpm_raw: number | null;
      bpm_folded: number | null;
      beats_json: string;
      downbeats_json: string;
      model: string;
      source_path: string;
      analyzed_at: string;
      bpm_fitted: number | null;
      bpm_residual_std: number | null;
    } | null;
    if (!row) return null;
    const beats = parseNumberArray(row.beats_json, "beats_json", videoId);
    const downbeats = parseNumberArray(
      row.downbeats_json,
      "downbeats_json",
      videoId,
    );
    if (!beats || !downbeats) return null;
    return {
      videoId: row.video_id,
      bpmRaw: row.bpm_raw,
      bpmFolded: row.bpm_folded,
      beats,
      downbeats,
      model: row.model,
      sourcePath: row.source_path,
      analyzedAt: row.analyzed_at,
      bpmFitted: row.bpm_fitted,
      residualStd: row.bpm_residual_std,
    };
  }

  beatAnalyzedTracks(): {
    track: TrackRow;
    beats: number[];
    downbeats: number[];
    bpmRaw: number | null;
    bpmFolded: number | null;
    bpmFitted: number | null;
    residualStd: number | null;
  }[] {
    const rows = this.db
      .query(
        `SELECT t.*, b.beats_json, b.downbeats_json, b.bpm_raw, b.bpm_folded,
                b.bpm_fitted, b.bpm_residual_std
         FROM tracks t JOIN beats b ON b.video_id = t.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as (TrackRow & {
      beats_json: string;
      downbeats_json: string;
      bpm_raw: number | null;
      bpm_folded: number | null;
      bpm_fitted: number | null;
      bpm_residual_std: number | null;
    })[];
    return rows.flatMap((row) => {
      const beats = parseNumberArray(
        row.beats_json,
        "beats_json",
        row.video_id,
      );
      const downbeats = parseNumberArray(
        row.downbeats_json,
        "downbeats_json",
        row.video_id,
      );
      if (!beats || !downbeats) return [];
      return [
        {
          track: row,
          beats,
          downbeats,
          bpmRaw: row.bpm_raw,
          bpmFolded: row.bpm_folded,
          bpmFitted: row.bpm_fitted,
          residualStd: row.bpm_residual_std,
        },
      ];
    });
  }

  setContentHash(videoId: string, hash: string): void {
    this.db
      .query(
        "UPDATE tracks SET content_hash = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(hash, this.now(), videoId);
  }

  tracksMissingContentHash(): { videoId: string; filePath: string | null }[] {
    const rows = this.db
      .query(
        `SELECT video_id, file_path FROM tracks
         WHERE status = 'downloaded' AND content_hash IS NULL`,
      )
      .all() as { video_id: string; file_path: string | null }[];
    return rows.map((row) => ({
      videoId: row.video_id,
      filePath: row.file_path,
    }));
  }
}
