/**
 * bench/stages/genre-loo.ts — Port of the existing genre LOO eval (B0.2).
 *
 * Wraps the legacy `evalLeaveOneOut` harness as a bench stage so its
 * numbers appear in `bench run all` and can be compared across commits.
 * Parity: harness numbers = legacy `regate genre` output ±0.1 pt.
 *
 * This stage does NOT use answer keys — it evaluates the pipeline's own
 * consistency via leave-one-out cross-validation on the embedded population.
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { evalLeaveOneOut, genreFamily } from "../../../core/similar-genre";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface EvalRow {
  video_id: string;
  genre: string;
  vec_json: string;
  duration_s: number | null;
}

function runGenreLooStage(
  db: Database,
  _answerKey: string,
  _split: BenchSplit,
): StageResult {
  // Pull the eval population: downloaded tracks with genre + embedding
  const pop = db
    .query(
      `SELECT t.video_id, t.genre, e.vec_json, t.duration_s
       FROM tracks t
       JOIN embeddings e ON e.video_id = t.video_id
       WHERE t.status = 'downloaded' AND t.genre IS NOT NULL
         AND e.vec_json IS NOT NULL`,
    )
    .all() as EvalRow[];

  const rows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = {
    population: pop.length,
  };

  if (pop.length === 0) {
    return {
      stage: "genre-loo",
      answerKey: "internal",
      rows: [],
      metrics: { ...metrics, agreement: null, evaluated: 0 },
      configHash: "genre-loo-v1",
    };
  }

  // Parse vectors
  const seeds: { videoId: string; genre: string; vec: number[] }[] = [];
  const durations: { videoId: string; durationS: number | null }[] = [];
  let parseErrors = 0;

  for (const r of pop) {
    try {
      const vec = JSON.parse(r.vec_json) as number[];
      if (!Array.isArray(vec) || vec.length === 0) {
        parseErrors++;
        continue;
      }
      seeds.push({ videoId: r.video_id, genre: r.genre, vec });
      durations.push({ videoId: r.video_id, durationS: r.duration_s });
    } catch {
      parseErrors++;
    }
  }

  const familyEvaluable = seeds.filter(
    (s) => genreFamily(s.genre) !== null,
  ).length;

  if (familyEvaluable === 0) {
    return {
      stage: "genre-loo",
      answerKey: "internal",
      rows: [],
      metrics: {
        ...metrics,
        agreement: null,
        evaluated: 0,
        parse_errors: parseErrors,
      },
      configHash: "genre-loo-v1",
    };
  }

  const summary = evalLeaveOneOut(seeds, 5, 0.6, durations);

  // Convert LOO row outcomes to bench rows
  for (const r of summary.rows) {
    rows.push({
      runId: "",
      trackId: r.videoId,
      truth: r.family,
      pred: r.predicted ?? "abstain",
      conf: r.agreement,
      correct: r.predicted === r.family ? 1 : 0,
    });
  }

  metrics.evaluated = summary.evaluated;
  metrics.agreement =
    summary.evaluated > 0 ? round4(summary.agree / summary.evaluated) : null;
  metrics.agree = summary.agree;
  metrics.disagree = summary.disagree;
  metrics.refused = summary.refused;
  metrics.parse_errors = parseErrors;
  metrics.family_evaluable = familyEvaluable;

  return {
    stage: "genre-loo",
    answerKey: "internal",
    rows,
    metrics,
    configHash: "genre-loo-v1",
  };
}

registerStage("genre-loo", runGenreLooStage);
