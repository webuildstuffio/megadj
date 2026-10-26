/**
 * bar-features.ts — Per-bar feature store (B2.1).
 *
 * Stores per-bar pooled features for every analyzed track:
 * - effnet PCA-256 fp16 embeddings per bar
 * - LUFS short-term loudness per bar
 * - onset density per bar
 * - low-band energy share per bar
 * - spectral flux per bar
 *
 * Size target: ≤ 80 KB/track (256 floats × 4 bytes × ~100 bars = ~100 KB
 * before fp16 compression).
 *
 * The bar boundaries come from the beats analysis (beats.ts) — each bar
 * is 4 beats for 4/4 time.
 */
import type { Database } from "bun:sqlite";

/** One bar's feature vector. */
export interface BarFeature {
  readonly barIndex: number;
  readonly startTime: number;
  readonly endTime: number;
  /** PCA-reduced effnet embedding (256-d). Stored as base64 fp16. */
  readonly embedding: string | null;
  /** Short-term LUFS loudness (dB). */
  readonly lufs: number | null;
  /** Onset density (onsets per second in this bar). */
  readonly onsetDensity: number | null;
  /** Low-band energy share (ratio of energy below 300 Hz). */
  readonly lowBandShare: number | null;
  /** Spectral flux (mean frame-to-frame spectral change). */
  readonly spectralFlux: number | null;
}

/** Full per-bar feature set for one track. */
export interface TrackBarFeatures {
  readonly videoId: string;
  readonly pcaVersion: string;
  readonly barCount: number;
  readonly bars: readonly BarFeature[];
}

/**
 * Create the bar_features table. Idempotent.
 */
export function migrateBarFeaturesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bar_features (
      video_id       TEXT NOT NULL,
      bar_index      INTEGER NOT NULL,
      start_time     REAL NOT NULL,
      end_time       REAL NOT NULL,
      embedding      TEXT,
      lufs           REAL,
      onset_density  REAL,
      low_band_share REAL,
      spectral_flux  REAL,
      pca_version    TEXT NOT NULL DEFAULT 'v1',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (video_id, bar_index)
    );
    CREATE INDEX IF NOT EXISTS idx_bar_features_video
      ON bar_features(video_id);
  `);
}

/**
 * Insert or replace bar features for a track.
 * Replaces all existing bars for the track in one transaction.
 */
export function upsertBarFeatures(db: Database, trackFeatures: TrackBarFeatures): number {
  const { videoId, pcaVersion, bars } = trackFeatures;
  if (bars.length === 0) return 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.run("DELETE FROM bar_features WHERE video_id = ?", [videoId]);
    const stmt = db.prepare(`
      INSERT INTO bar_features
        (video_id, bar_index, start_time, end_time, embedding,
         lufs, onset_density, low_band_share, spectral_flux, pca_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const bar of bars) {
      stmt.run(
        videoId,
        bar.barIndex,
        bar.startTime,
        bar.endTime,
        bar.embedding,
        bar.lufs,
        bar.onsetDensity,
        bar.lowBandShare,
        bar.spectralFlux,
        pcaVersion,
      );
    }
    db.exec("COMMIT");
    return bars.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Load all bar features for a track.
 */
export function loadBarFeatures(db: Database, videoId: string): TrackBarFeatures | null {
  const rows = db
    .query(
      `SELECT bar_index, start_time, end_time, embedding,
              lufs, onset_density, low_band_share, spectral_flux, pca_version
       FROM bar_features WHERE video_id = ? ORDER BY bar_index`,
    )
    .all(videoId) as BarFeatureDbRow[];

  if (rows.length === 0) return null;

  return {
    videoId,
    pcaVersion: rows[0]?.pca_version ?? "v1",
    barCount: rows.length,
    bars: rows.map((r) => ({
      barIndex: r.bar_index,
      startTime: r.start_time,
      endTime: r.end_time,
      embedding: r.embedding,
      lufs: r.lufs,
      onsetDensity: r.onset_density,
      lowBandShare: r.low_band_share,
      spectralFlux: r.spectral_flux,
    })),
  };
}

/**
 * Count tracks with bar features stored.
 */
export function barFeatureCount(db: Database): number {
  const row = db.query("SELECT count(DISTINCT video_id) AS n FROM bar_features").get() as {
    n: number;
  } | null;
  return row?.n ?? 0;
}

/**
 * List track IDs that have bar features.
 */
export function barFeatureTrackIds(db: Database): string[] {
  return (
    db.query("SELECT DISTINCT video_id FROM bar_features ORDER BY video_id").all() as {
      video_id: string;
    }[]
  ).map((r) => r.video_id);
}

interface BarFeatureDbRow {
  bar_index: number;
  start_time: number;
  end_time: number;
  embedding: string | null;
  lufs: number | null;
  onset_density: number | null;
  low_band_share: number | null;
  spectral_flux: number | null;
  pca_version: string;
}
