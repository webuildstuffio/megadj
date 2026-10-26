/**
 * bench/stages/bpm-gold.ts — Port of the existing BPM gold-set eval (B0.2).
 *
 * Wraps the legacy `regateBpm` gold-annotation harness as a bench stage.
 * Reads the gold set from MEGADJ_MUSIC_DIR/gold/ and compares against
 * the beats ledger.
 *
 * This is distinct from the AK2-based `bpm` stage (which uses rekordbox
 * reference BPM). This stage uses the hand-curated gold annotations.
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface BeatRow {
  video_id: string;
  content_hash: string | null;
  bpm_fitted: number | null;
  bpm_raw: number | null;
}

function runBpmGoldStage(db: Database, _answerKey: string, _split: BenchSplit): StageResult {
  // Load analyzed beats from the DB
  const analyzed = db
    .query(
      `SELECT t.video_id, t.content_hash, b.bpm_fitted, b.bpm_raw
       FROM tracks t
       JOIN beats b ON b.video_id = t.video_id
       WHERE t.content_hash IS NOT NULL`,
    )
    .all() as BeatRow[];

  // Load gold annotations from answer_keys table (AK1 field=bpm)
  const goldRows = db
    .query(
      `SELECT track_id, value FROM answer_keys
       WHERE field = 'bpm' AND (key_id = 'AK1' OR key_id = 'gold')`,
    )
    .all() as { track_id: string; value: string }[];

  const rows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = {
    analyzed_tracks: analyzed.length,
    gold_rows: goldRows.length,
  };

  if (goldRows.length === 0) {
    return {
      stage: "bpm-gold",
      answerKey: "AK1",
      rows: [],
      metrics: { ...metrics, matched: 0, accuracy_1pct: null, accuracy_2pct: null },
      configHash: "bpm-gold-v1",
    };
  }

  // Build lookup by content_hash (gold annotations are hash-keyed)
  const byHash = new Map<string, BeatRow>();
  for (const r of analyzed) {
    if (r.content_hash !== null) byHash.set(r.content_hash, r);
  }

  let matched = 0;
  let within1pct = 0;
  let within2pct = 0;
  let octaveErrors = 0;

  for (const g of goldRows) {
    const expected = Number(g.value);
    if (!Number.isFinite(expected) || expected <= 0) continue;

    const row = byHash.get(g.track_id);
    const actual = row?.bpm_fitted ?? row?.bpm_raw ?? null;
    if (actual === null || !Number.isFinite(actual)) continue;

    matched++;
    const error = Math.abs(actual - expected) / expected;
    const isWithin1 = error <= 0.01;
    const isWithin2 = error <= 0.02;
    if (isWithin1) within1pct++;
    if (isWithin2) within2pct++;

    // Octave error detection
    const ratio = actual / expected;
    const isOctave = (ratio > 1.9 && ratio < 2.1) || (ratio > 0.45 && ratio < 0.55);
    if (isOctave) octaveErrors++;

    rows.push({
      runId: "",
      trackId: g.track_id,
      truth: String(expected),
      pred: String(actual),
      conf: null,
      correct: isWithin2 ? 1 : 0,
    });
  }

  metrics.matched = matched;
  metrics.accuracy_1pct = matched > 0 ? round4(within1pct / matched) : null;
  metrics.accuracy_2pct = matched > 0 ? round4(within2pct / matched) : null;
  metrics.octave_errors = octaveErrors;
  metrics.octave_rate = matched > 0 ? round4(octaveErrors / matched) : null;

  return { stage: "bpm-gold", answerKey: "AK1", rows, metrics, configHash: "bpm-gold-v1" };
}

registerStage("bpm-gold", runBpmGoldStage);
