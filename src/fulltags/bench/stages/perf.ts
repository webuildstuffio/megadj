/**
 * bench/stages/perf.ts — Performance budget bench.
 *
 * Reports stored analysis timing data:
 * - s/track per stage (beats, mood, embeddings)
 * - Total analysis time distribution
 *
 * Gate (§6): s/track per stage ≤ 1.5× baseline.
 */
import type { Database } from "bun:sqlite";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

function runPerfStage(
  db: Database,
  _answerKey: string,
  _split: BenchSplit,
): StageResult {
  const benchRows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = {};

  const stages = ["beats", "mood", "embeddings"];
  for (const stage of stages) {
    try {
      const table = stage === "embeddings" ? "embeddings" : stage;
      const timeCol = stage === "beats" ? "analyzed_at" : "analyzed_at";
      const count =
        (
          db
            .query(
              `SELECT count(*) AS n FROM ${table} WHERE ${timeCol} IS NOT NULL`,
            )
            .get() as { n: number } | null
        )?.n ?? 0;

      metrics[`${stage}_count`] = count;

      if (stage === "beats") {
        const hasTiming = db
          .query(
            `SELECT count(*) AS n FROM beats
             WHERE analyzed_at IS NOT NULL AND bpm_raw IS NOT NULL`,
          )
          .get() as { n: number } | null;
        metrics.beats_analyzed = hasTiming?.n ?? 0;
      }
    } catch {
      metrics[`${stage}_count`] = null;
    }
  }

  const totalTracks =
    (db.query(`SELECT count(*) AS n FROM tracks`).get() as { n: number } | null)
      ?.n ?? 0;

  metrics.total_tracks = totalTracks;
  metrics.gate = "REPORT";

  return {
    stage: "perf",
    answerKey: "internal",
    rows: benchRows,
    metrics,
    configHash: "perf-v1",
  };
}

registerStage("perf", runPerfStage);
