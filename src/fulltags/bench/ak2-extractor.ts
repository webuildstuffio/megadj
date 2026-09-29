/**
 * ak2-extractor.ts — AK2 rekordbox reference extractor (B6.2).
 *
 * Reads BPM and key from the rb-adopt mirror (`rekordbox_content` table)
 * in archive.db and populates the bench `answer_keys` table as AK2.
 *
 * rekordbox stores BPMAverage as integer ×100 (e.g. 12800 → 128.00 BPM).
 * Key comes from the resolved djmdKey.ScaleName via the adopt pipeline.
 *
 * Fields extracted:
 * - bpm: BPMAverage / 100
 * - key: KeyName (e.g. "Abm", "F#", "Cm")
 */
import type { Database } from "bun:sqlite";
import { migrateBenchTables, upsertAnswerKeys } from "./store";
import type { AnswerKeyRow } from "./types";

interface MirrorRow {
  video_id: string;
  metadata_json: string;
}

interface RbMetadata {
  BPMAverage?: number | null;
  KeyName?: string | null;
}

/**
 * Extract AK2 answer keys from the rekordbox_content mirror in archive.db.
 * Returns the count of answer key rows written.
 */
export function extractAK2(db: Database): {
  bpmCount: number;
  keyCount: number;
  total: number;
} {
  migrateBenchTables(db);

  let mirrors: MirrorRow[];
  try {
    mirrors = db
      .query(
        `SELECT rc.video_id, rc.metadata_json
         FROM rekordbox_content rc
         WHERE rc.metadata_json IS NOT NULL AND rc.metadata_json != ''`,
      )
      .all() as MirrorRow[];
  } catch {
    return { bpmCount: 0, keyCount: 0, total: 0 };
  }

  const now = new Date().toISOString();
  const bpmRows: AnswerKeyRow[] = [];
  const keyRows: AnswerKeyRow[] = [];

  for (const row of mirrors) {
    let meta: RbMetadata;
    try {
      meta = JSON.parse(row.metadata_json) as RbMetadata;
    } catch {
      continue;
    }

    if (
      meta.BPMAverage !== null &&
      meta.BPMAverage !== undefined &&
      Number.isFinite(meta.BPMAverage) &&
      meta.BPMAverage > 0
    ) {
      const bpm = meta.BPMAverage / 100;
      bpmRows.push({
        keyId: "AK2",
        trackId: row.video_id,
        field: "bpm",
        value: bpm.toFixed(2),
        confidence: 1.0,
        sourceOfTruth: "rekordbox",
        split: "eval",
        evidence: null,
        createdAt: now,
      });
    }

    if (
      meta.KeyName &&
      typeof meta.KeyName === "string" &&
      meta.KeyName.trim()
    ) {
      keyRows.push({
        keyId: "AK2",
        trackId: row.video_id,
        field: "key",
        value: meta.KeyName.trim(),
        confidence: 1.0,
        sourceOfTruth: "rekordbox",
        split: "eval",
        evidence: null,
        createdAt: now,
      });
    }
  }

  upsertAnswerKeys(db, bpmRows);
  upsertAnswerKeys(db, keyRows);

  return {
    bpmCount: bpmRows.length,
    keyCount: keyRows.length,
    total: mirrors.length,
  };
}
