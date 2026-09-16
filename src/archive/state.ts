import type {
  CueRecord,
  CueRecordInput,
  MoodRecord,
  MoodRecordInput,
} from "./ledgers";
import { ArchiveBeats } from "./state_beats";
import type { RunRow } from "./state-types";

export type { RunRow, TrackRow, MarkDownloadedInfo } from "./state-types";

/**
 * Stable archive-state facade. Connection/schema, track lifecycle, and beat
 * persistence live in cohesive base stores; analysis-ledger delegates remain
 * here so every existing call site keeps the same API.
 */
export class ArchiveState extends ArchiveBeats {
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
    avg: {
      dance: number;
      valence: number;
      arousal: number;
      party: number;
      electronic: number;
    };
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
  }): void {
    this.embeddingsLedger.setEmbeddingRecord(record);
  }

  embeddingRecord(videoId: string) {
    return this.embeddingsLedger.embeddingRecord(videoId);
  }

  embeddingCorpus() {
    return this.embeddingsLedger.embeddingCorpus();
  }

  setKeyRecord(record: {
    videoId: string;
    key: string;
    sourcePath: string;
  }): void {
    this.keysLedger.setKeyRecord(record);
  }

  keyRecord(
    videoId: string,
    sourcePath: string,
  ): { key: string; analyzedAt: string } | null {
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
}

export { cosineSimilarity, similarTracks } from "./similar";
