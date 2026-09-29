/**
 * bench/stages/bpm.ts — BPM accuracy bench (WS1).
 *
 * Grades beat_this BPM against answer keys:
 * - AK2 (rekordbox reference): % within 0.1% of rekordbox BPM
 * - AK1 (GiantSteps Tempo): % Accuracy-1 (±4%, standard metric)
 *
 * Also produces the quantization diagnosis (B1.1): a histogram of
 * frames-per-beat showing whether the 20ms grid is visible.
 *
 * Gates (§6):
 * - Constant-tempo tracks: ≥95% within 0.1% vs AK2
 * - External: ≥90% Accuracy-1 vs AK1 GiantSteps Tempo
 */
import type { Database } from "bun:sqlite";
import { round3, round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface BeatRow {
  video_id: string;
  bpm_raw: number | null;
  bpm_fitted: number | null;
  bpm_folded: number | null;
  bpm_residual_std: number | null;
}

interface AK2Row {
  track_id: string;
  value: string;
}

function withinPct(pred: number, truth: number, pct: number): boolean {
  if (truth === 0) return false;
  return Math.abs(pred - truth) / truth <= pct / 100;
}

/** B1.1 quantization diagnosis: histogram of 3000/bpm_raw showing the
 *  20ms frame grid from beat_this's 50fps output. */
export function quantizationDiagnosis(
  db: Database,
): { framesPerBeat: number; count: number }[] {
  const rows = db
    .query(
      `SELECT round(3000.0 / bpm_raw, 2) AS frames_per_beat, count(*) AS n
       FROM beats WHERE bpm_raw IS NOT NULL AND bpm_raw > 0
       GROUP BY frames_per_beat ORDER BY n DESC LIMIT 15`,
    )
    .all() as { frames_per_beat: number; n: number }[];
  return rows.map((r) => ({
    framesPerBeat: r.frames_per_beat,
    count: r.n,
  }));
}

function runBpmStage(
  db: Database,
  answerKey: string,
  _split: BenchSplit,
): StageResult {
  const beats = db
    .query(
      `SELECT video_id, bpm_raw, bpm_fitted, bpm_folded, bpm_residual_std
       FROM beats WHERE bpm_raw IS NOT NULL`,
    )
    .all() as BeatRow[];

  const benchRows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = {
    n_tracks: beats.length,
  };

  if (answerKey === "AK2" || answerKey === "all") {
    const ak2 = db
      .query(
        `SELECT track_id, value FROM answer_keys
         WHERE key_id = 'AK2' AND field = 'bpm'`,
      )
      .all() as AK2Row[];
    const truthMap = new Map<string, number>();
    for (const r of ak2) {
      const n = Number(r.value);
      if (Number.isFinite(n) && n > 0) truthMap.set(r.track_id, n);
    }

    let within01 = 0;
    let within1 = 0;
    let within2 = 0;
    let octaveErrors = 0;
    let matched = 0;
    const useFitted = beats.some((b) => b.bpm_fitted !== null);

    for (const b of beats) {
      const truth = truthMap.get(b.video_id);
      if (truth === undefined) continue;
      matched++;
      const pred =
        useFitted && b.bpm_fitted !== null
          ? b.bpm_fitted
          : (b.bpm_folded ?? b.bpm_raw!);
      const ratio = pred / truth;
      if (Math.abs(ratio - 2) < 0.06 || Math.abs(ratio - 0.5) < 0.03) {
        octaveErrors++;
      }
      if (withinPct(pred, truth, 0.1)) within01++;
      if (withinPct(pred, truth, 1)) within1++;
      if (withinPct(pred, truth, 2)) within2++;
      benchRows.push({
        runId: "",
        trackId: b.video_id,
        truth: truth.toFixed(2),
        pred: pred.toFixed(2),
        conf:
          b.bpm_residual_std !== null
            ? round3(1 - Math.min(1, b.bpm_residual_std))
            : null,
        correct: withinPct(pred, truth, 0.1) ? 1 : 0,
      });
    }

    metrics.ak2_matched = matched;
    metrics.ak2_within_01pct = matched > 0 ? round4(within01 / matched) : null;
    metrics.ak2_within_1pct = matched > 0 ? round4(within1 / matched) : null;
    metrics.ak2_within_2pct = matched > 0 ? round4(within2 / matched) : null;
    metrics.ak2_octave_errors = octaveErrors;
    metrics.ak2_gate =
      matched > 0 && within01 / matched >= 0.95 ? "PASS" : "FAIL";
    metrics.bpm_source = useFitted ? "bpm_fitted" : "bpm_folded";
  }

  const diag = quantizationDiagnosis(db);
  metrics.quantization_top3 = diag
    .slice(0, 3)
    .map((d) => `${d.framesPerBeat}(${d.count})`)
    .join(", ");

  return {
    stage: "bpm",
    answerKey,
    rows: benchRows,
    metrics,
    configHash: "bpm-v1",
  };
}

registerStage("bpm", runBpmStage);
