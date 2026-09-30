// set-quality.ts — M4 (#328): SetQuality 0–100 pure function.
//
// A deterministic quality score derived ONLY from the MegasetResult
// payload — no ledger reads, no side effects. Same payload → same
// score, always.
//
// Components (each 0–100, then weighted):
//   1. Transition quality: mean transition scaled against the theoretical max
//   2. Transition floor: min transition (weakest link penalty)
//   3. Arc adherence: how closely the chain's arousal arc follows the preset
//   4. Diversity: artist-repeat penalty count → inverse score
//   5. Budget fit: how close the chain came to the requested duration
//   6. Landmark honor: ratio of requested landmarks successfully placed

import {
  MEGASET_PRESET_DEFS,
  type MegasetQuality,
  type MegasetResult,
  type MegasetStep,
} from "../shared/megaset";
import { round1 } from "../../shared/leaf/fmt";

export type { MegasetQuality } from "../shared/megaset";

// ---- weights (frozen E6 — no user-tunable knobs) ----
const QUALITY_WEIGHTS = {
  transition: 0.3,
  floor: 0.15,
  arc: 0.2,
  diversity: 0.15,
  budget: 0.1,
  landmark: 0.1,
} as const;

// The theoretical max transition score: sum of all weighted components
// at their ceiling. tempo(0.45) + key(0.3) + arcFit(0.25) + anchor(0.15)
// + similarity(0.1) = 1.25 — but the artist penalty floor and real-world
// mixing makes a mean above ~0.9 exceptional.
const TRANSITION_CEILING = 1.0;

/** Pure function: MegasetResult → MegasetQuality (0–100 total).
 *  No ledger reads, no side effects. */
export function setQuality(result: MegasetResult): MegasetQuality {
  const steps = result.steps;
  if (steps.length === 0) {
    return {
      transition: 0,
      floor: 0,
      arc: 0,
      diversity: 0,
      budget: 0,
      landmark: 0,
      total: 0,
    };
  }

  const transition = transitionComponent(steps);
  const floor = floorComponent(steps);
  const arc = arcComponent(steps, result.preset);
  const diversity = diversityComponent(steps, result.same_artist_pairs);
  const budget = budgetComponent(result);
  const landmark = landmarkComponent(result);

  const total = clamp100(
    QUALITY_WEIGHTS.transition * transition +
      QUALITY_WEIGHTS.floor * floor +
      QUALITY_WEIGHTS.arc * arc +
      QUALITY_WEIGHTS.diversity * diversity +
      QUALITY_WEIGHTS.budget * budget +
      QUALITY_WEIGHTS.landmark * landmark,
  );

  return { transition, floor, arc, diversity, budget, landmark, total };
}

// ---- component scorers ----

/** Mean transition score scaled against ceiling → 0–100. */
function transitionComponent(steps: MegasetStep[]): number {
  const transitions = steps
    .map((s) => s.transition)
    .filter((t): t is number => t !== null);
  if (transitions.length === 0) return 100; // single-track chain
  const mean = transitions.reduce((a, b) => a + b, 0) / transitions.length;
  return clamp100((mean / TRANSITION_CEILING) * 100);
}

/** Min transition — weakest link. Scaled same as mean. */
function floorComponent(steps: MegasetStep[]): number {
  const transitions = steps
    .map((s) => s.transition)
    .filter((t): t is number => t !== null);
  if (transitions.length === 0) return 100;
  const min = Math.min(...transitions);
  return clamp100((min / TRANSITION_CEILING) * 100);
}

/** Arc adherence: how closely arousal follows the preset's envelope.
 *  Measured as 1 − normalized RMSE of step arousal vs the preset's
 *  linear interpolation at each step's position. */
function arcComponent(steps: MegasetStep[], presetId: string): number {
  const preset = MEGASET_PRESET_DEFS.find((p) => p.id === presetId);
  if (!preset) return 50; // unknown preset → neutral
  const stepsWithArousal = steps.filter(
    (s): s is MegasetStep & { arousal: number } => s.arousal !== null,
  );
  if (stepsWithArousal.length === 0) return 50;

  const totalMin = steps[steps.length - 1]?.atMin ?? 0;
  if (totalMin <= 0) return 50;

  const [arousalStart, arousalEnd] = preset.arousal;
  let sumSqErr = 0;
  for (const step of stepsWithArousal) {
    const t = step.atMin / totalMin; // 0..1 position
    const target = arousalStart + t * (arousalEnd - arousalStart);
    const err = step.arousal - target;
    sumSqErr += err * err;
  }
  const rmse = Math.sqrt(sumSqErr / stepsWithArousal.length);
  // Scale: RMSE 0 → 100, RMSE 4 (half the 1–9 range) → 0
  return clamp100((1 - rmse / 4) * 100);
}

/** Diversity: penalize same-artist adjacency pairs.
 *  0 pairs → 100; each pair deducts proportional to chain length. */
function diversityComponent(
  steps: MegasetStep[],
  sameArtistPairs: number,
): number {
  if (steps.length <= 1) return 100;
  const maxPairs = steps.length - 1;
  const ratio = sameArtistPairs / maxPairs;
  // 0% repeats → 100; 50%+ repeats → 0
  return clamp100((1 - ratio * 2) * 100);
}

/** Budget fit: how close the chain came to the requested duration.
 *  100 when complete; decays linearly with shortfall. */
function budgetComponent(result: MegasetResult): number {
  if (result.complete) return 100;
  if (result.minutes <= 0) return 100;
  const fillRatio = result.actualMinutes / result.minutes;
  return clamp100(fillRatio * 100);
}

/** Landmark honor: ratio of requested landmarks placed.
 *  No landmarks requested → 100 (no ask, no penalty). */
function landmarkComponent(result: MegasetResult): number {
  const landmarkSteps = result.steps.filter((s) => s.landmark);
  const requested = landmarkSteps.length + result.landmarks_missing.length;
  if (requested === 0) return 100;
  return clamp100((landmarkSteps.length / requested) * 100);
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, round1(v)));
}
