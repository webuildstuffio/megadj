/**
 * bench/stages/genre-l2.ts — genre family (L2) accuracy bench.
 *
 * Grades the current genre pipeline against answer keys:
 * - AK3 (verified-store silver): leave-source-out accuracy
 * - AK4 (agent silver): same metrics on hard cases
 * - AK5 (binary disputes): system sides with user
 *
 * Gates (§6):
 * - ≥90% precision at ≥80% coverage AND ≥ ladder +5 pts at equal coverage
 * - ≥80% agreement on house/techno disputes (AK5)
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { isUmbrella } from "../../genre/taxonomy-v3";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface TrackGenreRow {
  video_id: string;
  genre: string | null;
  genre_votes: string | null;
}

interface AKRow {
  track_id: string;
  value: string;
  source_of_truth: string;
}

/** Extract the elected family from genre_votes JSON or fall back to genre. */
function electedFamily(row: TrackGenreRow): string | null {
  if (row.genre_votes) {
    try {
      const votes = JSON.parse(row.genre_votes) as Record<string, unknown>[];
      const elected = votes.find((v) => (v as Record<string, unknown>).elected === true);
      if (elected && typeof elected.family === "string") {
        return elected.family;
      }
    } catch {
      // fall through to genre field
    }
  }
  return row.genre ?? null;
}

function runGenreL2Stage(db: Database, answerKey: string, _split: BenchSplit): StageResult {
  const tracks = db
    .query(
      `SELECT video_id, genre, genre_votes FROM tracks
       WHERE status = 'downloaded' AND genre IS NOT NULL`,
    )
    .all() as TrackGenreRow[];

  const benchRows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = { n_tracks: tracks.length };

  const akIds = answerKey === "all" ? ["AK3", "AK4", "AK5"] : [answerKey];

  for (const akId of akIds) {
    const ak = db
      .query(
        `SELECT track_id, value, source_of_truth FROM answer_keys
         WHERE key_id = ? AND field = 'genre_family'`,
      )
      .all(akId) as AKRow[];
    const truthMap = new Map(ak.map((r) => [r.track_id, r]));
    let correct = 0;
    let matched = 0;
    const familyCorrect = new Map<string, { tp: number; total: number }>();

    for (const t of tracks) {
      const truthRow = truthMap.get(t.video_id);
      if (!truthRow) continue;
      matched++;
      const pred = electedFamily(t);
      if (pred !== null && isUmbrella(pred)) continue;
      const truth = truthRow.value;
      const isCorrect = pred !== null && pred.toLowerCase() === truth.toLowerCase();
      if (isCorrect) correct++;
      let bucket = familyCorrect.get(truth);
      if (!bucket) {
        bucket = { tp: 0, total: 0 };
        familyCorrect.set(truth, bucket);
      }
      bucket.total++;
      if (isCorrect) bucket.tp++;
      benchRows.push({
        runId: "",
        trackId: t.video_id,
        truth,
        pred: pred ?? "unknown",
        conf: null,
        correct: isCorrect ? 1 : 0,
      });
    }

    const prefix = akId.toLowerCase();
    metrics[`${prefix}_matched`] = matched;
    metrics[`${prefix}_accuracy`] = matched > 0 ? round4(correct / matched) : null;

    let macroF1Sum = 0;
    let classCount = 0;
    for (const [, bucket] of familyCorrect) {
      if (bucket.total === 0) continue;
      classCount++;
      const precision = bucket.tp / bucket.total;
      macroF1Sum += precision;
    }
    metrics[`${prefix}_macro_precision`] = classCount > 0 ? round4(macroF1Sum / classCount) : null;
  }

  return { stage: "genre-l2", answerKey, rows: benchRows, metrics, configHash: "genre-l2-v1" };
}

registerStage("genre-l2", runGenreL2Stage);
