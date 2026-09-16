export type TrackStatus =
  | "pending"
  | "downloaded"
  | "gone"
  | "failed"
  | "skipped_low_quality"
  | "skipped_not_music"
  | "skipped_short";

export interface TrackRow {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: TrackStatus;
  format_id: string | null;
  bitrate_kbps: number | null;
  codec: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  duration_s: number | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  liked_position: number | null;
  source: string;
  genre: string | null;
  energy: number | null;
  artwork_status: string | null;
  year: string | null;
  content_hash: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  attempted: number;
  downloaded: number;
  gone: number;
  failed: number;
  bytes_downloaded: number;
}

/** The row `ArchiveTracks.markDownloaded` accepts — the ONE declaration
 *  of the downloaded-row shape (#190). Previously hand-mirrored as
 *  `MarkDownloadedRow` in getdat/commands/ingest-register.ts; that site
 *  now derives from this leaf (which imports nothing, so the getdat leaf
 *  seam can import it without any cycle). `exactOptionalPropertyTypes`
 *  shape: optional fields are `| undefined` explicitly. */
export interface MarkDownloadedInfo {
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
}
