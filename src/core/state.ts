import { statSync } from "node:fs";
import type { CueRecord, CueRecordInput, MoodRecord, MoodRecordInput } from "./ledgers";
import { ArchiveBeats } from "./state-beats";
import type { RunRow } from "./state-types";

export type { RunRow, TrackRow } from "./state-types";

/**
 * Stable archive-state facade. Connection/schema, track lifecycle, and beat
 * persistence live in cohesive base stores; analysis-ledger delegates remain
 * here so every existing call site keeps the same API.
 */
export class ArchiveState extends ArchiveBeats {
  /** The on-disk path this state was opened at (#251): storage probes
   *  (status --json's storage block) read the ledger location from the
   *  state itself — never a re-derived env/config twin. */
  readonly dbPath: string;

  constructor(dbPath: string) {
    super(dbPath);
    this.dbPath = dbPath;
  }

  /** Run history remains explicit on the stable public facade type. */
  override lastRuns(n: number): RunRow[] {
    return super.lastRuns(n);
  }

  setMoodRecord(record: MoodRecordInput): void {
    this.ledgers.setMoodRecord(record);
  }

  moodRecord(videoId: string): MoodRecord | null {
    return this.ledgers.moodRecord(videoId);
  }

  moodSummary(): {
    available: boolean;
    analyzed: number;
    avg: { dance: number; valence: number; arousal: number; party: number; electronic: number };
  } {
    return this.ledgers.moodSummary();
  }

  setCueRecord(record: CueRecordInput): void {
    this.ledgers.setCueRecord(record);
  }

  cueRecord(videoId: string): CueRecord | null {
    return this.ledgers.cueRecord(videoId);
  }

  cueAnalyzedTracks(): {
    videoId: string;
    title: string | null;
    cues: { index: number; position: number; bar: number }[];
    source: string;
  }[] {
    return this.ledgers.cueAnalyzedTracks();
  }

  setEmbeddingRecord(record: {
    videoId: string;
    vec: number[];
    sourcePath: string;
    model: string;
  }): void {
    this.embeddingsLedger.setEmbeddingRecord(record);
  }

  embeddingRecord(videoId: string) {
    return this.embeddingsLedger.embeddingRecord(videoId);
  }

  embeddingCorpus(modelFilter?: string) {
    return this.embeddingsLedger.embeddingCorpus(modelFilter);
  }

  setSectionEmbeddingRecord(record: {
    videoId: string;
    vec: number[];
    sourcePath: string;
    model: string;
    sectionStart?: number;
    sectionEnd?: number;
  }): void {
    this.embeddingsLedger.setSectionEmbeddingRecord(record);
  }

  sectionPreferredCorpus() {
    return this.embeddingsLedger.sectionPreferredCorpus();
  }

  setKeyRecord(record: { videoId: string; key: string; sourcePath: string }): void {
    this.db
      .query(
        `INSERT INTO track_keys (video_id, key, source_path, analyzed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           key = excluded.key, source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(record.videoId, record.key, record.sourcePath, this.now());
  }

  /** Cached key (by video id) at the SAME source path, null when absent or
   *  stale. Mirrors the live reader contract (ArchiveReaderCore.keyRecord,
   *  src/deck/db/reader-core.ts): a moved/re-ripped file or a track
   *  re-analyzed after the key was cached reads as a miss, so a cache
   *  warm-up re-reads exactly the rows the set-builder reader would. */
  keyRecord(videoId: string, sourcePath: string): { key: string; analyzedAt: string } | null {
    let mtimeMs: number;
    try {
      const stat = statSync(sourcePath);
      if (!stat.isFile()) return null;
      mtimeMs = stat.mtimeMs;
    } catch (error) {
      // stderr, never stdout: this fires per dead path inside `adopt --shelf
      // --json`'s cache warm-up, and stdout carries the writeJson summary.
      console.error("archive key cache could not stat candidate", error);
      return null;
    }
    const row = this.db
      .query(
        `SELECT k.key, k.analyzed_at, t.updated_at AS track_updated_at
         FROM track_keys k
         JOIN tracks t ON t.video_id = k.video_id
         WHERE k.video_id = ? AND k.source_path = ?`,
      )
      .get(videoId, sourcePath) as {
      key: string;
      analyzed_at: string;
      track_updated_at: string;
    } | null;
    if (row === null) return null;
    const analyzedMs = Date.parse(row.analyzed_at);
    const trackMs = Date.parse(row.track_updated_at);
    if (
      !Number.isFinite(analyzedMs) ||
      !Number.isFinite(trackMs) ||
      trackMs > analyzedMs ||
      mtimeMs > analyzedMs
    )
      return null;
    return { key: row.key, analyzedAt: row.analyzed_at };
  }

  relabelKeySource(videoId: string, fromPath: string, toPath: string): void {
    this.db
      .query(
        `UPDATE track_keys SET source_path = ?, analyzed_at = ?
         WHERE video_id = ? AND source_path = ?`,
      )
      .run(toPath, this.now(), videoId, fromPath);
  }

  // ---------- stem cache (#555/#556) ----------

  setStemRecord(rec: {
    videoId: string;
    model: string;
    stemDir: string;
    vocalsPath: string | null;
    drumsPath: string | null;
    bassPath: string | null;
    otherPath: string | null;
    sampleRate: number;
    sourcePath: string;
    elapsedS: number;
  }): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO stem_cache
         (video_id, model, stem_dir, vocals_path, drums_path, bass_path, other_path,
          sample_rate, source_path, analyzed_at, elapsed_s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.videoId,
        rec.model,
        rec.stemDir,
        rec.vocalsPath,
        rec.drumsPath,
        rec.bassPath,
        rec.otherPath,
        rec.sampleRate,
        rec.sourcePath,
        this.now(),
        rec.elapsedS,
      );
  }

  stemRecord(
    videoId: string,
  ): {
    model: string;
    stemDir: string;
    vocalsPath: string | null;
    drumsPath: string | null;
    bassPath: string | null;
    otherPath: string | null;
    sampleRate: number;
    sourcePath: string;
    analyzedAt: string;
    elapsedS: number | null;
  } | null {
    const row = this.db.query("SELECT * FROM stem_cache WHERE video_id = ?").get(videoId) as Record<
      string,
      unknown
    > | null;
    if (row === null) return null;
    const sampleRate = Number(row["sample_rate"]);
    if (!Number.isFinite(sampleRate)) return null;
    const elapsedRaw = Number(row["elapsed_s"]);
    const elapsedS = Number.isFinite(elapsedRaw) ? elapsedRaw : null;
    return {
      model: String(row["model"]),
      stemDir: String(row["stem_dir"]),
      vocalsPath: row["vocals_path"] !== null ? String(row["vocals_path"]) : null,
      drumsPath: row["drums_path"] !== null ? String(row["drums_path"]) : null,
      bassPath: row["bass_path"] !== null ? String(row["bass_path"]) : null,
      otherPath: row["other_path"] !== null ? String(row["other_path"]) : null,
      sampleRate,
      sourcePath: String(row["source_path"]),
      analyzedAt: String(row["analyzed_at"]),
      elapsedS,
    };
  }

  stemCacheCount(): number {
    const row = this.db.query("SELECT COUNT(*) AS n FROM stem_cache").get() as { n: number };
    return row.n;
  }
}

export { cosineSimilarity, similarTracks } from "./similar";
