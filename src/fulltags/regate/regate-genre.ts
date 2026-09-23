// regate-genre.ts — `megadj regate genre` (#169): the standing one-command
// re-gate for the genre kNN. Runs the SAME LOO harness `genre --eval`
// runs (evalLeaveOneOut in src/core/similar.ts — no second eval
// implementation) over the same evalPopulation read, and reports against
// the ≥65% ship gate from the tier-0 work (genre-pipeline.md §V2, measured
// 69.2% at baseline). Effnet rides the same shape: its reference ledger
// (audio-true genre labels on the effnet tower's own vectors) does not
// exist yet, so the CLI honestly reports unavailable — never a
// manufactured pass (roadmap §4 gap 2's own rule).

import type { ArchiveState } from "../../core/state";
import {
  evalLeaveOneOut,
  genreFamily,
  parseEmbeddingVector,
} from "../../core/similar";
import type { GateResult } from "../gates";

/** The genre ship gate (genre-pipeline.md §V2, tier-0 arbitration bar). */
export const GENRE_GATE_PERCENT = 65;

/** The per-dimension result: measured agreement + gate verdict from the
 * EXISTING eval engine, or an honest unavailability. */
export interface GenreRegateResult {
  command: "regate";
  dimension: "genre" | "effnet";
  detector: "ledger";
  /** true = reference population absent → measured/gate are null */
  unavailable: boolean;
  /** why the ledger is unavailable (only when unavailable) */
  reason?: string;
  measured: number | null;
  gate: GateResult | null;
  evaluated: number;
  ok: boolean;
}

/** Build the eval population from the archive state: every embedded
 * downloaded track with a label (the same rows `genre --eval` feeds the
 * harness). Returns null when the population is empty — an honest gap,
 * not a zero-scored pass. */
export function genreEvalSeeds(state: ArchiveState): {
  seeds: { videoId: string; genre: string; vec: number[] }[];
  durations: { videoId: string; durationS: number | null }[];
} {
  const pop = state.evalPopulation();
  const seeds: { videoId: string; genre: string; vec: number[] }[] = [];
  const durations: { videoId: string; durationS: number | null }[] = [];
  for (const row of pop) {
    seeds.push({
      videoId: row.video_id,
      genre: row.genre,
      vec: parseEmbeddingVector(row.vec_json, `regate ${row.video_id}`),
    });
    durations.push({ videoId: row.video_id, durationS: row.duration_s });
  }
  return { seeds, durations };
}

/** `regate genre` — LOO agreement vs the ≥65% gate, through the shared
 * harness. Corrupt vector rows throw with their context (parseEmbedding
 * Vector's contract): a poisoned ledger must surface, not silently shrink
 * the population. */
export function regateGenre(state: ArchiveState): GenreRegateResult {
  const { seeds, durations } = genreEvalSeeds(state);
  const familyEvaluable = seeds.filter(
    (s) => genreFamily(s.genre) !== null,
  ).length;
  if (familyEvaluable === 0) {
    return {
      command: "regate",
      dimension: "genre",
      detector: "ledger",
      unavailable: true,
      reason:
        "no genre-labeled embeddings in the ledger — run `megadj mood --embeddings` and fetch genres first",
      measured: null,
      gate: null,
      evaluated: 0,
      ok: true, // honest gap: exit 0, the JSON states the census
    };
  }
  const summary = evalLeaveOneOut(seeds, 5, 0.6, durations);
  const measured = Math.round(summary.agreement * 1000) / 1000;
  // gate verdict shape mirrors runRegate's GateResult (passPercent vs
  // requiredPercent) so consumers never branch on dimension
  const gate: GateResult = {
    dimension: "genre",
    tolerancePercent: 0,
    passPercent: measured * 100,
    requiredPercent: GENRE_GATE_PERCENT,
    passed: familyEvaluable > 0 && measured * 100 >= GENRE_GATE_PERCENT,
    tracks: [],
  };
  return {
    command: "regate",
    dimension: "genre",
    detector: "ledger",
    unavailable: false,
    measured,
    gate,
    evaluated: summary.evaluated,
    ok: gate.passed,
  };
}

/** `regate effnet` — the reference ledger (audio-true genre labels scored
 * over the effnet tower's own 1280-d vectors, distinct from the whitened
 * genre kNN space) does not exist yet. Honest unavailability: exit 0,
 * `unavailable: true`, the reason on the wire. NEVER a manufactured pass
 * (docs/fulltags/fulltags-roadmap.md §4 gap 2's own rule). */
export function regateEffnet(): GenreRegateResult {
  return {
    command: "regate",
    dimension: "effnet",
    detector: "ledger",
    unavailable: true,
    reason:
      "the effnet reference ledger (audio-true genre labels on the effnet tower's vectors) is not populated — `regate genre` measures the whitened kNN space today",
    measured: null,
    gate: null,
    evaluated: 0,
    ok: true,
  };
}
