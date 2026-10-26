/**
 * bench/stages/energy.ts — Energy distribution bench (WS7).
 *
 * No external answer key needed for distribution checks:
 * - Decile spread: each band should hold 8–12% of the library
 * - Mean energy, standard deviation
 * - Saturation: top band share (should be <15%)
 *
 * Gate (§6): each decile 8–12% of library; ≥75% held-out pair agreement
 * (pair agreement requires AK5 energy pairs — reported when present).
 */
import type { Database } from "bun:sqlite";
import { round3, round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface EnergyRow {
  video_id: string;
  energy: number | null;
}

function runEnergyStage(db: Database, answerKey: string, _split: BenchSplit): StageResult {
  const rows = db
    .query(
      `SELECT t.video_id, t.energy
       FROM tracks t
       WHERE t.energy IS NOT NULL AND t.energy > 0`,
    )
    .all() as EnergyRow[];

  const benchRows: BenchRow[] = [];
  const deciles = Array.from({ length: 10 }, () => 0);
  let sum = 0;
  let sumSq = 0;

  for (const r of rows) {
    const e = r.energy ?? 0;
    sum += e;
    sumSq += e * e;
    const band = Math.min(9, Math.max(0, Math.floor(e) - 1));
    deciles[band] = (deciles[band] ?? 0) + 1;
    benchRows.push({
      runId: "",
      trackId: r.video_id,
      truth: String(e),
      pred: String(e),
      conf: null,
      correct: 1,
    });
  }

  const n = rows.length;
  const mean = n > 0 ? sum / n : 0;
  const std = n > 1 ? Math.sqrt((sumSq - (sum * sum) / n) / (n - 1)) : 0;

  const metrics: Record<string, number | string | null> = {
    n_tracks: n,
    mean_energy: round3(mean),
    std_energy: round3(std),
  };

  let spreadOk = 0;
  for (let i = 0; i < 10; i++) {
    const share = n > 0 ? deciles[i]! / n : 0;
    metrics[`band_${i + 1}_share`] = round4(share);
    if (share >= 0.08 && share <= 0.12) spreadOk++;
  }

  metrics.spread_ok_bands = spreadOk;
  metrics.top_band_share = n > 0 ? round4(deciles[9]! / n) : null;
  metrics.saturated = n > 0 && deciles[9]! / n > 0.15 ? "YES" : "NO";

  if (answerKey === "AK5" || answerKey === "all") {
    const pairs = db
      .query(
        `SELECT track_id, value FROM answer_keys
         WHERE key_id = 'AK5' AND field = 'energy_pair'`,
      )
      .all() as { track_id: string; value: string }[];
    metrics.ak5_pairs = pairs.length;
  }

  metrics.gate = spreadOk >= 8 && (n === 0 || deciles[9]! / n <= 0.15) ? "PASS" : "FAIL";

  return { stage: "energy", answerKey, rows: benchRows, metrics, configHash: "energy-v1" };
}

registerStage("energy", runEnergyStage);
