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
