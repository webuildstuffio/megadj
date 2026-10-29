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

  /** Mark a track's mood analysis status (analyzed, too-short, over-cap, failed, file-missing). */
  setMoodStatus(videoId: string, status: string): void {
    this.db.query("UPDATE tracks SET mood_status = ? WHERE video_id = ?").run(status, videoId);
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
    this.keysLedger.setKeyRecord(record);
  }

  keyRecord(videoId: string, sourcePath: string): { key: string; analyzedAt: string } | null {
    return this.keysLedger.keyRecord(videoId, sourcePath);
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
