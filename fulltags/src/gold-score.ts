// gold-score.ts — the gold-set scoring half (#89/#90 diet extraction
// from gold.ts): per-track scoring against predicted phrase/BPM/cues and
// the aggregate metrics. The annotation schema + loader stay in gold.ts.
import type { GoldAnnotation, GoldBranch } from "./gold";

// ---------- GA-00b metric math (pure — the scorer consumes these) ----------

/** One track's scored metrics (plan §0.2 table). Null = not scoreable on
 * that axis (e.g. no ledger grid) — tracked as a miss, not skipped. */
export interface GoldTrackScore {
  hash: string;
  branch: GoldBranch;
  /** Anchor accuracy input: |predicted − truth| first downbeat, ms. Null
   * when either side has no grid. */
  anchorDeltaMs: number | null;
  /** BPM accuracy inputs: abs delta and the ratio (ratio errors counted
   * separately from the 0.05 window — an octave lock is not "0.05 off"). */
  bpmDelta: number | null;
  bpmRatio: number | null;
  /** Phrase alignment: fraction of truth boundaries with a predicted
   * boundary within 1 bar. Null when either side has none. */
  phraseAligned: number | null;
  /** Cue acceptance: fraction of the user's hot cues matched by a
   * predicted cue within 50 ms. Null when the user marked none. */
  cueAccepted: number | null;
}

/** Which fraction of phrase boundaries count as "within 1 bar" — the
 * plan's phrase-alignment window. */
export const PHRASE_WINDOW_BARS = 1;

/** Hot-cue acceptance window (ms) — "you'd accept it unchanged" at 15 ms
 * grid tolerance plus quantize slop; the plan B8 gate uses the same 15. */
export const CUE_ACCEPT_MS = 50;

export function scoreGoldTrack(
  gold: GoldAnnotation,
  pred: {
    firstDownbeatS: number | null;
    bpm: number | null;
    phraseBars: number[];
    cueTimesMs: number[];
  },
): GoldTrackScore {
  const anchorDeltaMs =
    pred.firstDownbeatS === null
      ? null
      : Math.round((pred.firstDownbeatS * 1000 - gold.firstDownbeatMs) * 10) /
        10;
  const bpmDelta =
    pred.bpm === null ? null : Math.round((pred.bpm - gold.bpm) * 100) / 100;
  const bpmRatio =
    pred.bpm === null || !(gold.bpm > 0)
      ? null
      : Math.round((pred.bpm / gold.bpm) * 1000) / 1000;

  // Phrase alignment: nearest-predicted-within-window per truth bar.
  let phraseAligned: number | null = null;
  if (gold.phraseBars.length > 0 && pred.phraseBars.length > 0) {
    let hit = 0;
    for (const bar of gold.phraseBars) {
      const win = PHRASE_WINDOW_BARS;
      if (pred.phraseBars.some((p) => Math.abs(p - bar) <= win)) hit++;
    }
    phraseAligned = Math.round((hit / gold.phraseBars.length) * 1000) / 1000;
  }

  // Cue acceptance: nearest-predicted-within-window per user cue.
  let cueAccepted: number | null = null;
  if (gold.hotCuesMs.length > 0) {
    let hit = 0;
    for (const t of gold.hotCuesMs) {
      if (pred.cueTimesMs.some((p) => Math.abs(p - t) <= CUE_ACCEPT_MS)) hit++;
    }
    cueAccepted = Math.round((hit / gold.hotCuesMs.length) * 1000) / 1000;
  }

  return {
    hash: gold.hash,
    branch: gold.branch,
    anchorDeltaMs,
    bpmDelta,
    bpmRatio,
    phraseAligned,
    cueAccepted,
  };
}

/** The report table (plan §0.2): each metric over one split, plus the
 * counts needed to interpret them (n, scored, octave-locked). */
export interface GoldMetrics {
  tracks: number;
  /** % with |anchor| ≤ 10 ms (scored tracks only; misses shown by n). */
  anchorPct: number | null;
  anchorScored: number;
  /** % with |ΔBPM| ≤ 0.05. */
  bpmPct: number | null;
  bpmScored: number;
  /** % with ratio 1.98–2.02 or 0.495–0.505 — the octave-lock census. */
  octaveOff: number;
  /** % phrase boundaries within 1 bar (mean of per-track fractions). */
  phrasePct: number | null;
  phraseScored: number;
  /** % user hot cues matched within 50 ms. */
  cuePct: number | null;
  cueScored: number;
}

const ANCHOR_TOLERANCE_MS = 10;
const BPM_TOLERANCE = 0.05;

/** Percentage with 1 decimal (null when the denominator is 0). Pure —
 *  module-level, not re-created per `aggregateScores` call. */
const pct = (hit: number, n: number): number | null =>
  n === 0 ? null : Math.round((hit / n) * 1000) / 10;

/** Aggregate per-track scores into the §0.2 metrics row. Pure. */
export function aggregateScores(scores: GoldTrackScore[]): GoldMetrics {
  const anchor = scores.filter((s) => s.anchorDeltaMs !== null);
  const bpm = scores.filter((s) => s.bpmDelta !== null);
  const phrase = scores.filter((s) => s.phraseAligned !== null);
  const cue = scores.filter((s) => s.cueAccepted !== null);
  return {
    tracks: scores.length,
    anchorPct: pct(
      anchor.filter(
        (s) => Math.abs(s.anchorDeltaMs ?? 1e9) <= ANCHOR_TOLERANCE_MS,
      ).length,
      anchor.length,
    ),
    anchorScored: anchor.length,
    bpmPct: pct(
      bpm.filter((s) => Math.abs(s.bpmDelta ?? 1e9) <= BPM_TOLERANCE).length,
      bpm.length,
    ),
    bpmScored: bpm.length,
    octaveOff: bpm.filter(
      (s) =>
        s.bpmRatio !== null &&
        (Math.abs(s.bpmRatio - 2) < 0.06 || Math.abs(s.bpmRatio - 0.5) < 0.03),
    ).length,
    phrasePct: pct(
      phrase.filter((s) => (s.phraseAligned ?? 0) >= 0.85).length,
      phrase.length,
    ),
    phraseScored: phrase.length,
    cuePct: pct(
      cue.filter((s) => (s.cueAccepted ?? 0) >= 0.8).length,
      cue.length,
    ),
    cueScored: cue.length,
  };
}
