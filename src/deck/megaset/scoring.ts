// megaset/scoring.ts — the set-builder's scoring family (#89/#90 item 2
// extraction): key/tempo compatibility, arc envelopes, the B2 anchor
// drift budget, and the B3 segment-direction gate that transitionScore
// composes. Pure functions over SetCandidate/preset data — same shape as
// the engine itself: rows in, scores out, no I/O. buildMegaset (the
// chain/search family) lives in megaset.ts and imports from here.
import { camelotOf, keyCompatScore } from "../shared/camelot";
import {
  MEGASET_ANCHOR_WEIGHT,
  MEGASET_AROUSAL_EPSILON,
  MEGASET_BRANCH_TOLERANCE,
  MEGASET_DRIFT_BUDGET,
  MEGASET_HALFTIME_PENALTY,
  MEGASET_SIMILARITY_WEIGHT,
  MEGASET_TEMPO_PERFECT,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRANSITION_WEIGHTS,
  isMegasetHalfTimePair,
  megasetArtistRepeatPenalty,
  type MegasetEvidence,
  type MegasetPresetDef,
} from "../shared/types";
import { cosineSimilarity } from "../../shared/leaf/vector-space";

/** The pool row the whole set-builder scores and chains (#171 madge
 *  pass: canonically lives HERE — the scoring family owns the shape it
 *  scores; megaset.ts re-exports it so consumers never moved). */
export interface SetCandidate {
  videoId: string;
  title: string | null;
  artist: string | null;
  durationS: number | null;
  /** Folded BPM from the beats ledger — null = not analyzed (excluded). */
  bpm: number | null;
  /** Camelot or open key from the file's TKEY ("8A", "8a", "Am", …). */
  key: string | null;
  /** Mood-ledger axes (1–9 valence/arousal, 0–1 dance). */
  valence: number | null;
  arousal: number | null;
  dance: number | null;
  /** #106 Phase D: phrase cues from the `cues` ledger (8-bar boundaries,
   *  bar 1-based / position seconds). Empty when the track has no ledger
   *  row — the handoff derivation degrades to null, never invented bars. */
  cues: { bar: number; position: number }[];
  /** #171 embeddings-similarity prior: the track's stored vector
   *  (whitened+CSLS space when enabled, raw otherwise — whatever the
   *  producer loaded). Null = no embedding: the candidate builds with
   *  NO similarity bonus, never a penalty (honest gap rule). */
  embedding: number[] | null;
}

/** The preset type the scorer scores against (alias of the shared def —
 *  megaset.ts re-exports it for callers). */
export type SetPreset = MegasetPresetDef;

/** Camelot key compatibility 0..1: 1 for identical key, descending for the
 *  classic relative/adjacent moves. 0 = clash. Either side unparsable →
 *  neutral 0.5 (never blocks, never helps). Thin wrapper over keyCompatScore. */
export function keyScore(a: SetCandidate, b: SetCandidate): number {
  return keyCompatScore(camelotOf(a.key), camelotOf(b.key));
}

/** Tempo compatibility 0..1: 1 within ±MEGASET_TEMPO_PERFECT, linearly down to
 *  0 at ±MEGASET_TEMPO_WINDOW — the classic DJ mixability window. The bounds
 *  live in the shared registry so every surface quotes the same numbers. */
export function bpmScore(a: number, b: number): number {
  const d = Math.abs(a - b) / Math.max(a, b);
  if (d <= MEGASET_TEMPO_PERFECT) return 1;
  if (d >= MEGASET_TEMPO_WINDOW) return 0;
  return (
    1 -
    (d - MEGASET_TEMPO_PERFECT) / (MEGASET_TEMPO_WINDOW - MEGASET_TEMPO_PERFECT)
  );
}

/** B8 (#107): the tempo lane for one hop — the direct window first
 *  (bpmScore's slope, untouched: a direct match pays NO discount);
 *  outside it, a candidate near 2×, ½×, 1.5× or ⅔× of `a` pairs at the
 *  flat half-time value 0.75 × MEGASET_HALFTIME_PENALTY. A 174 DnB cut
 *  over an 87 anchor — or an 87 trap cut under a 130 house set (the
 *  1.5× feel lane) — now competes instead of scoring 0 by geometry,
 *  while never beating an equal-everything direct match. Exported for
 *  the contract pins; transitionScore is the other production consumer. */
export function megasetTempoLane(a: number, b: number): number {
  const direct = bpmScore(a, b);
  if (direct > 0) return direct;
  return isMegasetHalfTimePair(a, b) ? 0.75 * MEGASET_HALFTIME_PENALTY : 0;
}

/** A BPM the engine can actually mix with: present, finite and positive.
 * The beats ledger can carry placeholder rows (0 or NaN) from aborted
 * analysis runs — those are NOT tempos, and gating only on `!== null` let
 * a 0-BPM row be picked as opener and instantly dead-end the chain. */
export const mixableBpm = (
  c: SetCandidate,
): c is SetCandidate & {
  bpm: number;
} => c.bpm !== null && Number.isFinite(c.bpm) && c.bpm > 0;

/** Arc position 0..1 → target arousal/dance for the preset (lerp). */
function envelope(p: readonly [number, number], t: number): number {
  return p[0]! + (p[1]! - p[0]!) * t;
}

/** B2: arc position 0..1 → the preset's tempo target as a RATIO of the
 *  set's anchor BPM. Same slot clock as the arousal/dance envelopes —
 *  the tempo arc rides beside them instead of chasing only `prev`. */
function tempoTarget(preset: SetPreset, t: number): number {
  const [from, to] = preset.tempoTarget;
  return from + (to - from) * t;
}

/**
 * B2 hard drift budget: is `bpm` mixable with THIS set's anchor? A
 * ±6%-per-step chain compounds (measured 100 → 187.9 BPM in one
 * 12-step climb) because each hop only sees the previous track; this
 * gate sees the anchor, so drift cannot outrun ±MEGASET_DRIFT_BUDGET of
 * the anchor no matter how many steps each one individually allows.
 * Half/double-time mix-outs stay open: a candidate near 2×/½× the
 * anchor passes on the branch lane (within MEGASET_BRANCH_TOLERANCE) —
 * a 174 DnB closer on a 87 anchor is a feature, not drift. (Exported
 * for the contract pins; the engine applies it inside transitionScore.)
 */
export function withinAnchorBudget(bpm: number, anchorBpm: number): boolean {
  const drift = Math.abs(bpm / anchorBpm - 1);
  if (drift <= MEGASET_DRIFT_BUDGET) return true;
  for (const branch of [2, 0.5]) {
    if (Math.abs(bpm / (anchorBpm * branch) - 1) <= MEGASET_BRANCH_TOLERANCE)
      return true;
  }
  return false;
}

/**
 * B3: which way does arc position `t` want arousal to move? Splits the
 * envelope into thirds (approach / hold / land): warmup climbs
 * (+1,+1,+1 with the slight final hold) — actually derived from the
 * preset's own [start,end] slope per third, not hard-coded, so a future
 * preset with a plateau or double-hump gets the right directions for
 * free. Returns 0 where the third is directionless (held).
 */
function segmentDirection(preset: SetPreset, t: number): number {
  const [start, end] = preset.arousal;
  const third = (Math.min(Math.max(t, 0), 1) * 3) | 0; // 0,1,2
  const at = (slot: number): number =>
    start + (end - start) * (Math.min(slot, 3) / 3);
  const d = at(third + 1) - at(third);
  // a flat third is directionless; tiny slopes keep their sign
  return Math.abs(d) < 1e-9 ? 0 : d > 0 ? 1 : -1;
}

/** #171 embeddings similarity prior 0..1: cosine between the two stored
 *  vectors, rescaled from [-1,1] to [0,1]. Pure function of the stored
 *  vectors — no model calls at build time (the acceptance rule). Either
 *  side missing (or dimension mismatch — different towers/spaces) → 0:
 *  no bonus, never a penalty (the honest gap rule). */
export function similarityScore(prev: SetCandidate, c: SetCandidate): number {
  if (!prev.embedding || !c.embedding) return 0;
  if (prev.embedding.length !== c.embedding.length) return 0;
  const cos = cosineSimilarity(prev.embedding, c.embedding);
  return (cos + 1) / 2;
}

/** Transition score: how well does candidate `c` continue FROM `prev`
 * given the arc position `t` (0..1)? Key + tempo are hard-ish filters,
 * energy fit is a soft bonus. B2: also pulls toward the arc's ANCHORED
 * tempo target (soft) so a chain cannot out-walk the set's tempo
 * neighborhood one ±6% hop at a time. #171: + a timbre bonus when BOTH
 * candidates carry stored embeddings (capped at MEGASET_SIMILARITY_WEIGHT,
 * 0.1 — trims among compatible candidates; never rescues an incompatible
 * one because the tempo/key/anchor gates above run first). */
/** Core transition components: the shared gate+score logic that both
 *  transitionScore (hot loop) and transitionEvidence (wire) need. Returns
 *  null when a hard gate fires (−1 equivalent). The caller decides
 *  whether to collapse into a number or fan out into the evidence struct. */
function transitionCore(
  prev: SetCandidate,
  c: SetCandidate,
  preset: SetPreset,
  t: number,
  anchorBpm: number,
  lastArousal: number | null,
): {
  tempoLane: number;
  keyVal: number;
  fit: number;
  anchor: number;
  sim: number;
  penalty: number;
  halftime: boolean;
} | null {
  if (!mixableBpm(prev) || !mixableBpm(c)) return null;
  // B2 hard gate: total drift from the anchor is budgeted per candidate
  // (half-time-lane exempt — the lane runs BELOW, so the ×2/×½/×1.5/×⅔
  // pairings it admits are exactly the ones the budget spares; F3
  // super-fix: the old ×2/×½-only branch exemption never admitted the
  // advertised 87-under-130 ×1.5 feel pairing, making the lane dead code)
  if (
    !withinAnchorBudget(c.bpm, anchorBpm) &&
    !isMegasetHalfTimePair(anchorBpm, c.bpm)
  )
    return null;
  // B8 (#107): the direct window first; outside it the half-time lane
  // (×2/×½/×1.5/×⅔) lets a DnB/trap pairing compete at a flat 0.75 ×
  // MEGASET_HALFTIME_PENALTY — the discount rides the PAIR lane only
  // (F1 super-fix: the old code scaled direct matches by 0.9 too, a
  // silent ~10% tax on every ordinary hop), so half-time never beats an
  // equal-everything direct match.
  const tempoLane = megasetTempoLane(prev.bpm, c.bpm);
  if (tempoLane === 0) return null;
  const keyVal = keyScore(prev, c);
  if (keyVal === 0) return null;
  // energy fit: distance from the preset's target at this arc position
  const targetArousal = envelope(preset.arousal, t);
  const targetDance = envelope(preset.dance, t);
  const a = (c.arousal ?? 5) / 9;
  const d = c.dance ?? 0.6;
  // B3 arc direction: a candidate that moves arousal AGAINST its
  // segment's direction is a hard wall (score −1, same lane as a key
  // clash) — the issue's contract is "may not move the chain opposite
  // its segment's direction", not a soft nudge; the envelope keeps its
  // shape mid-set instead of reversing wherever energy-fit ties.
  // Held thirds impose no direction; jitter ≤ ε still fits.
  const dir = segmentDirection(preset, t);
  if (dir !== 0 && lastArousal !== null && c.arousal !== null) {
    if ((c.arousal - lastArousal) * dir < -MEGASET_AROUSAL_EPSILON) return null;
  }
  const fit =
    1 -
    Math.min(
      1,
      (Math.abs(a - targetArousal / 9) + Math.abs(d - targetDance)) / 2,
    );
  // B2 soft anchor term: distance from the arc-local tempo target
  // (anchor lerped along preset.tempoTarget), scored on the same
  // relative scale as bpmScore's perfect-window slope.
  const anchor =
    1 -
    Math.min(
      1,
      Math.abs(c.bpm / (anchorBpm * tempoTarget(preset, t)) - 1) /
        ((MEGASET_TEMPO_WINDOW - MEGASET_TEMPO_PERFECT) / 2),
    );
  const halftime = tempoLane > 0 && bpmScore(prev.bpm!, c.bpm) === 0;
  return {
    tempoLane,
    keyVal,
    fit,
    anchor,
    sim: similarityScore(prev, c),
    penalty: megasetArtistRepeatPenalty(prev, c),
    halftime,
  };
}

/** Apply blend weights + artist penalty to get the final transition number. */
function blendScore(core: {
  tempoLane: number;
  keyVal: number;
  fit: number;
  anchor: number;
  sim: number;
  penalty: number;
}): number {
  const raw =
    MEGASET_TRANSITION_WEIGHTS.tempo * core.tempoLane +
    MEGASET_TRANSITION_WEIGHTS.key * core.keyVal +
    MEGASET_TRANSITION_WEIGHTS.arcFit * core.fit +
    MEGASET_ANCHOR_WEIGHT * core.anchor +
    MEGASET_SIMILARITY_WEIGHT * core.sim;
  return core.penalty > 0 ? Math.max(0.01, raw - core.penalty + 1) : raw;
}

export function transitionScore(
  prev: SetCandidate,
  c: SetCandidate,
  preset: SetPreset,
  t: number,
  anchorBpm: number,
  lastArousal: number | null,
): number {
  const core = transitionCore(prev, c, preset, t, anchorBpm, lastArousal);
  return core === null ? -1 : blendScore(core);
}

/** #284: transitionScore plus its per-component breakdown — the ONE
 *  evaluation seam. Returns null when the hop is gated (−1): no
 *  components to show, the honest answer is "this hop failed a hard
 *  gate", not a fake breakdown. */
export function transitionEvidence(
  prev: SetCandidate,
  c: SetCandidate,
  preset: SetPreset,
  t: number,
  anchorBpm: number,
  lastArousal: number | null,
): MegasetEvidence | null {
  const core = transitionCore(prev, c, preset, t, anchorBpm, lastArousal);
  if (core === null) return null;
  const tempo = MEGASET_TRANSITION_WEIGHTS.tempo * core.tempoLane;
  const key = MEGASET_TRANSITION_WEIGHTS.key * core.keyVal;
  const arcFit = MEGASET_TRANSITION_WEIGHTS.arcFit * core.fit;
  const anchorTerm = MEGASET_ANCHOR_WEIGHT * core.anchor;
  const similarity = MEGASET_SIMILARITY_WEIGHT * core.sim;
  return {
    tempo,
    key,
    arcFit,
    anchor: anchorTerm,
    similarity,
    artistPenalty: core.penalty,
    total: blendScore(core),
    halftime: core.halftime,
  };
}
