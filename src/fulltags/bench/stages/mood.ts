/**
 * bench/stages/mood.ts — mood distribution check (no external gold needed).
 *
 * The mood bench doesn't grade against truth labels — it checks that the
 * five heads (dance, aggressive, happy, electronic, party) have healthy
 * fire-rate distributions. A head that fires on >70% of tracks carries
 * no information; a head that never fires is dead.
 *
 * Gate (§6): no rendered head fires on >70% of tracks.
 * Metrics: fire rate per head, entropy per head, valence/arousal spread.
 */
import type { Database } from "bun:sqlite";
import { round3, round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

const MOOD_HEADS = [
  "dance",
  "aggressive",
  "happy",
  "electronic",
  "party",
] as const;
type MoodHead = (typeof MOOD_HEADS)[number];

interface MoodRow {
  video_id: string;
  dance: number;
  aggressive: number;
  happy: number;
  electronic: number;
  party: number;
  valence: number;
  arousal: number;
}

/** Fire rate: fraction of tracks where the head's value ≥ 0.5. */
function fireRate(rows: readonly MoodRow[], head: MoodHead): number {
  if (rows.length === 0) return 0;
  const fired = rows.filter((r) => r[head] >= 0.5).length;
  return round4(fired / rows.length);
}

/** Shannon entropy of a binary classifier head (bits). Max = 1.0 for 50/50. */
function binaryEntropy(rate: number): number {
  if (rate <= 0 || rate >= 1) return 0;
  return round4(-(rate * Math.log2(rate) + (1 - rate) * Math.log2(1 - rate)));
}

/** Standard deviation. */
function std(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const ss = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

function runMoodStage(
  db: Database,
  _answerKey: string,
  _split: BenchSplit,
): StageResult {
  const rows = db
    .query(
      `SELECT video_id, dance, aggressive, happy, electronic, party, valence, arousal
       FROM mood`,
    )
    .all() as MoodRow[];

  const metrics: Record<string, number | string | null> = {
    n_tracks: rows.length,
  };
  const benchRows: BenchRow[] = [];
  let anyOverThreshold = false;

  for (const head of MOOD_HEADS) {
    const rate = fireRate(rows, head);
    const entropy = binaryEntropy(rate);
    metrics[`fire_rate_${head}`] = rate;
    metrics[`entropy_${head}`] = entropy;
    const overThreshold = rate > 0.7;
    if (overThreshold) anyOverThreshold = true;
    metrics[`gate_${head}`] = overThreshold ? "FAIL" : "PASS";
    for (const r of rows) {
      benchRows.push({
        runId: "",
        trackId: r.video_id,
        truth: r[head] >= 0.5 ? "fired" : "silent",
        pred: r[head] >= 0.5 ? "fired" : "silent",
        conf: round3(r[head]),
        correct: 1,
      });
    }
  }

  metrics.valence_mean = round4(
    rows.reduce((s, r) => s + r.valence, 0) / (rows.length || 1),
  );
  metrics.valence_std = round4(std(rows.map((r) => r.valence)));
  metrics.arousal_mean = round4(
    rows.reduce((s, r) => s + r.arousal, 0) / (rows.length || 1),
  );
  metrics.arousal_std = round4(std(rows.map((r) => r.arousal)));
  metrics.gate_pass = anyOverThreshold ? "FAIL" : "PASS";

  return {
    stage: "mood",
    answerKey: "distribution",
    rows: benchRows,
    metrics,
    configHash: "mood-v1",
  };
}

registerStage("mood", runMoodStage);
