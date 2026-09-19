// megaset/search.ts — the set-builder's SELECTION family (#89 diet
// extraction): greedy and beam-search chain builders over scored
// candidates. Pure functions, deterministic (ties break by (score,
// videoId), never pool row order), no I/O. buildMegaset (pool filter,
// opener pick, commit loop, wire assembly) stays in megaset.ts and
// imports from here — the dependency arrow runs one way.
import { MEGASET_BEAM_WIDTH } from "../../shared/types";
import { transitionScore, type SetCandidate, type SetPreset } from "./scoring";

/** One committed proposal slot: the candidate plus the transition score
 *  INTO it (null for the opener). Selection functions return these; the
 *  single commit loop in buildMegaset turns them into wire steps. */
export interface PickedStep {
  candidate: SetCandidate;
  transition: number | null;
}

/** Why the chain stopped. "budget" = time target filled (leftovers are
 *  excluded as "set budget filled"); "deadend" = nothing compatible
 *  remained (leftovers keep the no-transition/no-BPM reasons);
 *  "exhausted" = pool fully consumed (no leftovers to explain). */
export type StopCause = "budget" | "deadend" | "exhausted";

const candidateDuration = (c: SetCandidate): number => {
  const seconds = c.durationS;
  return seconds !== null && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : 300;
};

/** Beam-search state: one partial chain with its running clock and score.
 *  Module scope so the ranking helper stays pure (oxlint scoping). */
interface BeamState {
  chain: SetCandidate[];
  transitions: (number | null)[];
  elapsedS: number;
  score: number;
  /** Budget filled — terminal by completion, not by dead end. */
  done: boolean;
}

/** Deterministic state signature for tie-breaks (never pool row order). */
const chainSignature = (chain: readonly { videoId: string }[]): string =>
  chain.map((c) => c.videoId).join(">");

/** Best-state ranking: prefer budget-complete chains first, then score,
 *  chain length, then signature for deterministic tie-breaks.
 *  Returns < 0 when `a` ranks before `b`. Used by frontier + final pick. */
const rankBeamState = (a: BeamState, b: BeamState): number =>
  (b.done ? 1 : 0) - (a.done ? 1 : 0) ||
  b.score - a.score ||
  b.chain.length - a.chain.length ||
  chainSignature(a.chain).localeCompare(chainSignature(b.chain));

/** Greedy chain (the shipped sequencer): score every remaining candidate
 *  for each next slot, take the best. O(n²) — fine at archive scale.
 *  Deterministic: ties break by (score, videoId) so the same input always
 *  proposes the same set — the old `s > bestScore` scan kept the FIRST
 *  candidate on ties, which made the chain silently depend on the pool's
 *  `updated_at DESC` row order (re-ingesting reshuffled proposals). */
export const greedyChain = (
  opener: SetCandidate,
  rest: readonly SetCandidate[],
  preset: SetPreset,
  budget: number,
  /** B2: the set's global tempo anchor (the opener's BPM) — every
   *  candidate is drift-budgeted against it, not just against `prev`. */
  anchorBpm: number,
): { chain: PickedStep[]; stopCause: StopCause } => {
  const remaining = [...rest];
  const chain: PickedStep[] = [{ candidate: opener, transition: null }];
  let elapsedS = candidateDuration(opener);
  while (remaining.length > 0 && elapsedS < budget) {
    const last = chain.at(-1)!.candidate;
    const t = Math.min(1, elapsedS / budget);
    let bestIdx = -1;
    let bestScore = -1;
    let bestId = "";
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;
      const s = transitionScore(last, c, preset, t, anchorBpm, last.arousal);
      // strict > keeps scanning on ties; the (score, videoId) pair decides —
      // lexicographically-smaller id wins a tie, independent of row order
      if (s > bestScore || (s === bestScore && c.videoId < bestId)) {
        bestScore = s;
        bestIdx = i;
        bestId = c.videoId;
      }
    }
    if (bestIdx < 0 || bestScore <= 0) return { chain, stopCause: "deadend" };
    const next = remaining.splice(bestIdx, 1)[0]!;
    chain.push({ candidate: next, transition: bestScore });
    elapsedS += candidateDuration(next);
  }
  return {
    chain,
    stopCause: elapsedS >= budget ? "budget" : "exhausted",
  };
};

/** Beam state → committable picked chain (the wire shape minus census). */
function toPicked(
  st: BeamState,
  stopCause: StopCause,
): { chain: PickedStep[]; stopCause: StopCause } {
  return {
    chain: st.chain.map((candidate, i) => ({
      candidate,
      transition: st.transitions[i] ?? null,
    })),
    stopCause,
  };
}

/** Beam continuation (the E7 fix, docs/set/04-sequencing-benchmarks.md):
 *  keep the best MEGASET_BEAM_WIDTH partial chains per slot instead of one.
 *  Sparse pools (one genre family, pinned opener, heavy exclusions)
 *  dead-end greedy ~59% short of the best chain because a locally-best
 *  step can be globally fatal — a doomed branch dies while alternatives
 *  survive. Deterministic: states rank by rankBeamState, never row order.
 *  Cost ≈ width × pool per slot — ~0 ms at the ≤250-track pools that
 *  trigger it. Returns the BEST chain built, budget-filled or not: a
 *  partial chain that dies at slot k still beats a lone opener (the old
 *  inline greedy kept its partial too — parity of honesty, not regression). */
export const beamChain = (
  opener: SetCandidate,
  rest: readonly SetCandidate[],
  preset: SetPreset,
  budget: number,
  /** B2: the set's global tempo anchor — the budget gate runs on EVERY
   *  branch extension, so beam branches cannot out-drift greedy. */
  anchorBpm: number,
): { chain: PickedStep[]; stopCause: StopCause } => {
  const openerElapsed = candidateDuration(opener);
  const start: BeamState = {
    chain: [opener],
    transitions: [null],
    elapsedS: openerElapsed,
    score: 0,
    done: openerElapsed >= budget,
  };
  let best = start;
  let frontier: BeamState[] = [start];
  while (frontier.length > 0) {
    const frontierNext: BeamState[] = [];
    for (const st of frontier) {
      if (st.done) continue; // filled: terminal, kept in `best`
      const last = st.chain.at(-1)!;
      const t = Math.min(1, st.elapsedS / budget);
      for (const c of rest) {
        if (st.chain.includes(c)) continue;
        const s = transitionScore(last, c, preset, t, anchorBpm, last.arousal);
        if (s <= 0) continue; // gated out — not a branch, a wall
        const elapsedS = st.elapsedS + candidateDuration(c);
        const next: BeamState = {
          chain: [...st.chain, c],
          transitions: [...st.transitions, s],
          elapsedS,
          score: st.score + s,
          done: elapsedS >= budget,
        };
        if (!next.done) frontierNext.push(next);
        if (rankBeamState(next, best) < 0) best = next;
      }
    }
    if (frontierNext.length === 0) break; // every live branch hit a wall
    frontierNext.sort(rankBeamState);
    frontier = frontierNext.slice(0, MEGASET_BEAM_WIDTH);
  }
  // `best` is the highest-ranked chain reached (completed = filled budget
  // mid-search; otherwise the deepest/partial leader at the final wall).
  // Completed chains mean the budget filled; an un-completed best means
  // the pool could not fill it — a real shortfall, reported honestly.
  const stopCause: StopCause = best.done ? "budget" : "deadend";
  return toPicked(best, stopCause);
};
