// transition-types.ts — M5 (#329): typed transition grammar.
//
// Closed, hand-written type set — NO automatic grammar learning (the
// co-occurrence trap, explicitly refused by v3 §3). Each type describes
// a DJ mixing technique derivable from the cues ledger + scoring evidence.
//
// The engine assigns `transitionType` per step; `hold` is the honest
// fallback for no-cue or no-legal-type steps. Grammar types never
// synthesize or render audio (v3 §3.9 stays out of scope).

import type { MegasetStep } from "../shared/megaset";

/** The closed set of transition types a step can carry. */
export type TransitionType =
  | "long-blend"
  | "phrase-cut"
  | "energy-swap"
  | "half-time-shift"
  | "drop-entry"
  | "hold";

/** One step's transition classification with its reasoning. */
export interface TransitionClassification {
  type: TransitionType;
  /** Why this type was chosen — honest when `hold` (no cues / no match). */
  reason: string;
}

/** Human-readable labels for M3U8 #EXTREM tags and UI display. */
export const TRANSITION_TYPE_LABELS: Record<TransitionType, string> = {
  "long-blend": "Long Blend",
  "phrase-cut": "Phrase Cut",
  "energy-swap": "Energy Swap",
  "half-time-shift": "Half-Time Shift",
  "drop-entry": "Drop Entry",
  hold: "Hold",
};

// ---- thresholds (frozen E6) ----
const LONG_BLEND_MIN_OVERLAP_BARS = 16;
const ENERGY_SWAP_AROUSAL_DELTA = 1.5;
const DROP_ENTRY_AROUSAL_MIN = 6.0;

/** Classify a transition between two consecutive steps.
 *  Pure function — reads only from the step pair, no ledger. */
export function classifyTransition(prev: MegasetStep, curr: MegasetStep): TransitionClassification {
  // No transition data = hold (honest gap)
  if (curr.transition === null) {
    return { type: "hold", reason: "opener — no transition" };
  }

  // Half-time shift: the evidence says halftime
  if (curr.evidence?.halftime === true) {
    return { type: "half-time-shift", reason: "B8 half/double-time lane active" };
  }

  // Both steps have cues — classify by overlap and energy shape
  const hasCues = prev.mixOutCue !== null && curr.mixInCue !== null;

  if (hasCues) {
    const outBar = prev.mixOutCue?.bar ?? 0;
    const inBar = curr.mixInCue?.bar ?? 0;
    const overlapBars = Math.abs(outBar - inBar);
    const currArousal = curr.arousal ?? 0;
    const prevArousal = prev.arousal ?? 0;

    // Drop entry: high-energy step entering near the top (bar ≤ 4)
    // Checked BEFORE long-blend — a drop entry IS a long overlap
    // but the DJ intent is the energy hit, not the blend shape.
    if (currArousal >= DROP_ENTRY_AROUSAL_MIN && inBar <= 4) {
      return {
        type: "drop-entry",
        reason: `arousal ${currArousal.toFixed(1)} ≥ ${DROP_ENTRY_AROUSAL_MIN}, cue bar ${inBar}`,
      };
    }

    // Energy swap: significant arousal delta between steps
    // Checked before long-blend — the energy move IS the transition,
    // regardless of phrase overlap length.
    if (Math.abs(currArousal - prevArousal) >= ENERGY_SWAP_AROUSAL_DELTA) {
      return {
        type: "energy-swap",
        reason: `arousal delta ${Math.abs(currArousal - prevArousal).toFixed(1)} ≥ ${ENERGY_SWAP_AROUSAL_DELTA}`,
      };
    }

    // Long blend: large phrase overlap
    if (overlapBars >= LONG_BLEND_MIN_OVERLAP_BARS) {
      return {
        type: "long-blend",
        reason: `${overlapBars}-bar overlap (≥${LONG_BLEND_MIN_OVERLAP_BARS})`,
      };
    }

    // Phrase cut: cues present but no special condition
    return { type: "phrase-cut", reason: `${overlapBars}-bar overlap, standard phrase alignment` };
  }

  // No cues — classify by evidence alone
  const currArousal = curr.arousal ?? 0;
  const prevArousal = prev.arousal ?? 0;
  if (Math.abs(currArousal - prevArousal) >= ENERGY_SWAP_AROUSAL_DELTA) {
    return {
      type: "energy-swap",
      reason: `arousal delta ${Math.abs(currArousal - prevArousal).toFixed(1)}, no cues`,
    };
  }

  return { type: "hold", reason: "no cues — phrase boundary unknown" };
}

/** Classify all transitions in a step chain.
 *  The opener (first step) always gets `hold` with reason "opener". */
export function classifyChain(steps: MegasetStep[]): TransitionClassification[] {
  if (steps.length === 0) return [];
  const result: TransitionClassification[] = [{ type: "hold", reason: "opener — first track" }];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    if (prev !== undefined && curr !== undefined) {
      result.push(classifyTransition(prev, curr));
    }
  }
  return result;
}

/** Classify a chain and zip each transition's type back onto its step —
 *  the call-site shape shared by the megaset CLI and the API payload. */
export function classifySteps(steps: MegasetStep[]): MegasetStep[] {
  const classifications = classifyChain(steps);
  return steps.map((s, i) => ({ ...s, transitionType: classifications[i]?.type }));
}

/** Count how many steps in a chain carry a non-hold type.
 *  Used for the 95% coverage gate (M5 acceptance). */
export function typedCoverage(classifications: TransitionClassification[]): {
  typed: number;
  total: number;
  ratio: number;
} {
  // Exclude the opener (always hold by definition)
  const transitions = classifications.slice(1);
  const total = transitions.length;
  if (total === 0) return { typed: 0, total: 0, ratio: 1 };
  const typed = transitions.filter((c) => c.type !== "hold").length;
  return { typed, total, ratio: typed / total };
}
