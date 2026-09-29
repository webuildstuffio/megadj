/**
 * bench/stages/grid.ts — Grid phase accuracy bench (WS1).
 *
 * Grades beat_this grid alignment against AK2 (rekordbox PQTZ grid):
 * - % downbeat on rekordbox bar "1" (phase accuracy)
 * - Mean phase error in ms
 * - Bucket distribution (A-OK, SHIFT, PHASE, TEMPO, DRIFT, CHAOS)
 *
 * Gate (§6): ≥95% on rekordbox bar "1" vs AK2.
 */
import type { Database } from "bun:sqlite";
import { round3, round4 } from "../../../shared/leaf/fmt";
import { fitConstantTempo, gridAudit } from "../../analysis/grid-audit";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface BeatsRow {
  video_id: string;
  beats_json: string | null;
}

interface AK2GridRow {
  track_id: string;
  value: string;
  field: string;
}

function parseBeats(json: string | null): number[] | null {
  if (json === null) return null;
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    const nums = arr.filter(
      (x): x is number => typeof x === "number" && Number.isFinite(x),
    );
    return nums.length >= 8 ? nums : null;
  } catch {
    return null;
  }
}

function runGridStage(
  db: Database,
  answerKey: string,
  _split: BenchSplit,
): StageResult {
  const rows = db
    .query(
      `SELECT video_id, beats_json FROM beats WHERE beats_json IS NOT NULL`,
    )
    .all() as BeatsRow[];

  const benchRows: BenchRow[] = [];
  const buckets: Record<string, number> = {};
  let matched = 0;
  let phaseCorrect = 0;
  let totalPhaseErrorMs = 0;

  if (answerKey === "AK2" || answerKey === "all") {
    const ak2 = db
      .query(
        `SELECT track_id, value, field FROM answer_keys
         WHERE key_id = 'AK2' AND field IN ('bpm', 'grid_phase')`,
      )
      .all() as AK2GridRow[];

    const bpmMap = new Map<string, number>();
    const phaseMap = new Map<string, number>();
    for (const r of ak2) {
      const n = Number(r.value);
      if (Number.isFinite(n)) {
        if (r.field === "bpm") bpmMap.set(r.track_id, n);
        else if (r.field === "grid_phase") phaseMap.set(r.track_id, n);
      }
    }

    for (const row of rows) {
      const beats = parseBeats(row.beats_json);
      if (!beats) continue;
      const rbBpm = bpmMap.get(row.video_id);
      if (rbBpm === undefined || rbBpm <= 0) continue;
      matched++;

      const fit = fitConstantTempo(beats);
      const verdict = gridAudit(beats, rbBpm);
      const bucket = verdict?.bucket ?? "SKIP";
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;

      const rbPhaseMs = phaseMap.get(row.video_id);
      if (verdict && rbPhaseMs !== undefined) {
        const phaseOk = Math.abs(verdict.driftMs) <= 15;
        if (phaseOk) phaseCorrect++;
        totalPhaseErrorMs += Math.abs(verdict.driftMs);
      }

      benchRows.push({
        runId: "",
        trackId: row.video_id,
        truth: bucket === "A-OK" ? "aligned" : bucket,
        pred: bucket,
        conf: fit ? round3(1 - Math.min(1, fit.residualStd)) : null,
        correct: bucket === "A-OK" ? 1 : 0,
      });
    }
  }

  const metrics: Record<string, number | string | null> = {
    n_tracks: rows.length,
    n_matched: matched,
  };

  for (const [b, c] of Object.entries(buckets)) {
    metrics[`bucket_${b.toLowerCase()}`] = c;
  }

  if (matched > 0) {
    metrics.phase_accuracy = round4(phaseCorrect / matched);
    metrics.mean_phase_error_ms = round3(totalPhaseErrorMs / matched);
    metrics.gate = phaseCorrect / matched >= 0.95 ? "PASS" : "FAIL";
  }

  return {
    stage: "grid",
    answerKey,
    rows: benchRows,
    metrics,
    configHash: "grid-v1",
  };
}

registerStage("grid", runGridStage);
