import { ArchiveCore } from "./state_core";
import type { TrackRow, TrackStatus } from "./state-types";

/** Track lifecycle and inventory queries. */
export class ArchiveTracks extends ArchiveCore {
  upsertTrackFromPlaylist(
    videoId: string,
    position: number,
    title: string | null,
    source = "liked",
  ): void {
    const now = this.now();
    this.db
      .query(
        `INSERT INTO tracks (video_id, liked_position, title, source, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           liked_position = excluded.liked_position,
           title = COALESCE(excluded.title, tracks.title),
           updated_at = excluded.updated_at`,
      )
      .run(videoId, position, title, source, now, now);
  }

  markAttempt(videoId: string, error: string | null): void {
    const now = this.now();
    const row = this.db
      .query("SELECT attempts FROM tracks WHERE video_id = ?")
      .get(videoId) as { attempts: number } | null;
    this.db
      .query(
        "UPDATE tracks SET attempts = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE video_id = ?",
      )
      .run((row?.attempts ?? 0) + 1, now, error, now, videoId);
  }

  markDownloaded(
    videoId: string,
    info: {
      title: string | null;
      artist: string | null;
      album: string | null;
      genre?: string | null | undefined;
      formatId: string | null;
      bitrateKbps: number | null;
      codec: string | null;
      filePath: string | null;
      fileSizeBytes: number | null;
      durationS: number | null;
      energy?: number | null | undefined;
      artworkStatus?: string | null | undefined;
    },
  ): void {
    const now = this.now();
    this.db
      .query(
        `UPDATE tracks SET
           status = 'downloaded', title = COALESCE(?, title),
           artist = COALESCE(?, artist), album = COALESCE(?, album),
           genre = COALESCE(?, genre), energy = COALESCE(?, energy),
           artwork_status = COALESCE(?, artwork_status),
           format_id = ?, bitrate_kbps = ?, codec = ?, file_path = ?,
           file_size_bytes = ?, duration_s = ?, last_error = NULL, updated_at = ?
         WHERE video_id = ?`,
      )
      .run(
        info.title,
        info.artist,
        info.album,
        info.genre ?? null,
        info.energy ?? null,
        info.artworkStatus ?? null,
        info.formatId,
        info.bitrateKbps,
        info.codec,
        info.filePath,
        info.fileSizeBytes,
        info.durationS,
        now,
        videoId,
      );
  }

  markGone(videoId: string, reason: string): void {
    this.markStatus(videoId, "gone", { lastError: reason });
  }

  markFailed(videoId: string, error: string): void {
    this.markStatus(videoId, "failed", { lastError: error });
  }

  resetFailures(): number {
    return this.db
      .query(
        "UPDATE tracks SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE status = 'failed'",
      )
      .run(this.now()).changes;
  }

  markNotMusic(videoId: string, category: string | null): void {
    this.markStatus(videoId, "skipped_not_music", {
      lastError: `category: ${category ?? "unknown"}`,
    });
  }

  private markStatus(
    videoId: string,
    status: TrackStatus,
    fields: {
      filePath?: string;
      durationS?: number | null;
      lastError?: string;
    } = {},
  ): void {
    this.db
      .query(
        "UPDATE tracks SET status = ?, file_path = COALESCE(?, file_path), duration_s = COALESCE(?, duration_s), last_error = COALESCE(?, last_error), updated_at = ? WHERE video_id = ?",
      )
      .run(
        status,
        fields.filePath ?? null,
        fields.durationS ?? null,
        fields.lastError ?? null,
        this.now(),
        videoId,
      );
  }

  updateFilePath(videoId: string, newFilePath: string): void {
    this.db
      .query(
        "UPDATE tracks SET file_path = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(newFilePath, this.now(), videoId);
  }

  updateEnergyColumn(videoId: string, energy: number): void {
    this.db
      .query("UPDATE tracks SET energy = ?, updated_at = ? WHERE video_id = ?")
      .run(energy, this.now(), videoId);
  }

  trackByFilePath(filePath: string): TrackRow | null {
    return (
      (this.db
        .query(
          "SELECT * FROM tracks WHERE file_path = ? AND status = 'downloaded' LIMIT 1",
        )
        .get(filePath) as TrackRow | undefined) ?? null
    );
  }

  markShortSkipped(
    videoId: string,
    filePath: string,
    durationS: number | null,
  ): void {
    this.markStatus(videoId, "skipped_short", { filePath, durationS });
  }

  updateGenre(videoId: string, genre: string | null): void {
    this.db
      .query(
        "UPDATE tracks SET genre = COALESCE(?, genre), updated_at = ? WHERE video_id = ?",
      )
      .run(genre, this.now(), videoId);
  }

  genreSeeds(): {
    seeds: { video_id: string; genre: string; vec_json: string }[];
    queries: { video_id: string; title: string | null; vec_json: string }[];
  } {
    const seeds = this.db
      .query(
        `SELECT e.video_id, t.genre, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''`,
      )
      .all() as { video_id: string; genre: string; vec_json: string }[];
    const queries = this.db
      .query(
        `SELECT e.video_id, t.title, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND (t.genre IS NULL OR t.genre = '')`,
      )
      .all() as { video_id: string; title: string | null; vec_json: string }[];
    return { seeds, queries };
  }

  /** Eval population for `genre --eval`: every embedded downloaded track
   *  with a label AND its duration + artist — the LOO harness applies the
   *  measured 90–480 s band itself (G5: hygiene, applied at eval time
   *  only, never a data change); artist feeds the Tier-0 diagnostics and
   *  the --artist-disjoint rerun (research review 0.1/0.2/F2). Reads the
   *  same rows `genreSeeds` sees plus `duration_s`/`artist` so one query
   *  keeps the views identical. */
  evalPopulation(): {
    video_id: string;
    genre: string;
    duration_s: number | null;
    artist: string | null;
    vec_json: string;
  }[] {
    return this.db
      .query(
        `SELECT e.video_id, t.genre, t.duration_s, t.artist, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''`,
      )
      .all() as {
      video_id: string;
      genre: string;
      duration_s: number | null;
      artist: string | null;
      vec_json: string;
    }[];
  }

  updateArtworkStatus(videoId: string, status: string): void {
    this.db
      .query(
        "UPDATE tracks SET artwork_status = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(status, this.now(), videoId);
  }

  queuedArtworkTracks(): TrackRow[] {
    return this.db
      .query(
        "SELECT * FROM tracks WHERE artwork_status = 'queued' ORDER BY updated_at",
      )
      .all() as TrackRow[];
  }

  pendingTracks(): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY status = 'pending' DESC, liked_position IS NULL, liked_position, first_seen_at`,
      )
      .all() as TrackRow[];
  }

  downloadedCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as n FROM tracks WHERE status = 'downloaded'")
      .get() as { n: number };
    return row.n;
  }

  statusCounts(): Record<string, number> {
    const rows = this.db
      .query("SELECT status, COUNT(*) as n FROM tracks GROUP BY status")
      .all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  }

  allTracks(): TrackRow[] {
    return this.db
      .query("SELECT * FROM tracks ORDER BY liked_position")
      .all() as TrackRow[];
  }

  downloadedWithFiles(): TrackRow[] {
    return this.allTracks().filter(
      (track) => track.status === "downloaded" && track.file_path,
    );
  }
}
