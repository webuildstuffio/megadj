/**
 * grid-audit.ts — the constant-tempo fit + grid-audit verdicts (plan.md
 * GA-01/GA-04/GA-03). Split from analysis.ts (#42 stage split); pure math
 * — no env, no fixtures, no I/O. Consumed by cratedeck's archive reader
 * (deep import, pinned by this module being import-leaf-safe).
 */
import type { AnlzBeat } from "./anlz";
import { round1, round3 } from "../../shared/leaf/fmt";

/**
 * Least-squares constant-tempo fit over a beat array (plan GA-01): beat
 * index regressed on beat time. House is grid-locked by construction —
 * machine-sequenced 4/4 — so the fitted slope is a better tempo than any
 * per-beat interval, and `bpm_residual_std` says whether the
 * constant-tempo assumption held (small residual = grid-locked; large =
 * genuinely variable tempo, multi-point grid territory).
 *
 * Returns null when the array is too short to fit meaningfully (<4 beats,
 * non-finite, or zero time span — a degenerate grid must not produce a
 * confident verdict).
 */
export function fitConstantTempo(
  beats: number[],
): { bpmFitted: number; residualStd: number } | null {
  const n = beats.length;
  if (n < 4) return null;
  const times = beats.map(Number);
  if (times.some((t) => !Number.isFinite(t))) return null;
  const t0 = times[0]!;
  const span = times[n - 1]! - t0;
  if (!(span > 0)) return null;
  // Least squares over x = t - t0 (centering keeps the fit stable).
  const xs = times.map((t) => t - t0);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = (n - 1) / 2; // beat index mean
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxx += dx * dx;
    sxy += dx * (i - meanY);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx; // BEATS per SECOND (y = beat index, x = seconds)
  if (!(slope > 0)) return null;
  const bpmFitted = slope * 60;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (i - meanY - slope * (xs[i]! - meanX)) ** 2;
  const residualStd = Math.sqrt(ss / n); // beats of drift (1σ)
  return { bpmFitted, residualStd };
}

/** The grid-audit math (plan GA-04) for one track, given the ledger's beat
 * array and rekordbox's stored BPM (folded, same window as ours). All
 * thresholds are the plan's starting points; calibration is GA-05b's job.
 * Null verdict when there's no usable grid.
 *
 * Scope note: the plan's full anchor delta compares against the grid
 * decoded from rekordbox's ANLZ sidecar (GA-03/GA-07) — that decode
 * doesn't exist yet, so `anchorDeltaMs` is null and the SHIFT/PHASE
 * buckets (which need a real anchor) stay unassigned; every other metric
 * is computable from the ledger alone. `driftMs` is measured against RB's
 * BPM clock — the slide a CDJ locked to the stored BPM would accumulate,
 * which is exactly what Beat Sync does on hardware. */
export interface GridAuditVerdict {
  /** Rekordbox BPM − fitted BPM, 1dp BPM units. */
  bpmDelta: number;
  /** fitted / rb — 2.0/0.5 expose octave locks instantly. */
  bpmRatio: number;
  /** rb-ANLZ first downbeat − fitted-grid first downbeat, ms. Null until
   * the ANLZ decode exists (plan GA-03); the ledger-only pass can't see
   * rekordbox's own anchor. */
  anchorDeltaMs: number | null;
  /** Positional slide of the grid against RB's stored BPM over the whole
   * track, ms: how far the real beats and a CDJ locked to RB's tempo
   * drift apart by the outro. Signed (negative = grid finishes early =
   * true tempo is higher). */
  driftMs: number;
  /** True when the slide is deterministic (grid internally clean) rather
   * than jitter — with the ledger-only view this is `|drift| > 15 ms`
   * AND small internal wobble; a wobbly grid is CHAOS instead. */
  driftMonotonic: boolean;
  /** Internal wobble of the grid around its own fitted line, ms (1σ) —
   * the grid's self-consistency, independent of RB. */
  residualMs: number;
  /** The GA-05 bucket (ledger-only subset: SHIFT/PHASE need the ANLZ
   * anchor and are assigned by the GA-03 pass, never here). */
  bucket: "A-OK" | "SHIFT" | "PHASE" | "TEMPO" | "DRIFT" | "CHAOS";
  /** Human reason string for the surface. */
  reason: string;
}

export function gridAudit(
  beats: number[],
  rbBpm: number,
): GridAuditVerdict | null {
  if (beats.length < 8 || !(rbBpm > 0)) return null;
  const fit = fitConstantTempo(beats);
  if (!fit) return null;
  // Internal wobble: grid vs its OWN best-fit line (self-consistency).
  const residualMs = fit.residualStd * (60 / fit.bpmFitted) * 1000;
  // Positional slide vs RB's BPM clock: last-beat offset minus first-beat
  // offset under the RB hypothesis (the span gap the CDJ would accumulate).
  const n = beats.length;
  const spanActual = beats[n - 1]! - beats[0]!;
  const driftMs = (spanActual - ((n - 1) * 60) / rbBpm) * 1000;
  const bpmRatio = fit.bpmFitted / rbBpm;
  let bucket: GridAuditVerdict["bucket"];
  let reason: string;
  if (Math.abs(bpmRatio - 2) < 0.06 || Math.abs(bpmRatio - 0.5) < 0.03) {
    bucket = "TEMPO";
    reason = "fitted BPM is an octave off rekordbox";
  } else if (residualMs > 40) {
    bucket = "CHAOS";
    reason = `grid wobbles ±${Math.round(residualMs)} ms around its own tempo — manual territory`;
  } else if (Math.abs(driftMs) > 15) {
    bucket = "DRIFT";
    reason = `grid slides ${Math.round(Math.abs(driftMs))} ms against RB's ${rbBpm} BPM (clean grid at ${fit.bpmFitted.toFixed(2)})`;
  } else {
    // Any ≥8-beat grid with >2 BPM delta already exceeds 15 ms of slide,
    // so everything reaching here is genuinely within tolerance. The
    // plan's SHIFT (anchor offset, tempo right) needs the ANLZ anchor —
    // GA-03's pass fills that bucket; PHASE likewise.
    bucket = "A-OK";
    reason = "grid within tolerance";
  }
  return {
    bpmDelta: round1(rbBpm - fit.bpmFitted),
    bpmRatio: round3(bpmRatio),
    anchorDeltaMs: null,
    driftMs: round1(driftMs),
    driftMonotonic: Math.abs(driftMs) > 15 && residualMs <= 40,
    residualMs: round1(residualMs),
    bucket,
    reason,
  };
}

// ---------- GA-03/GA-04 full audit: ANLZ anchor + phase ----------

/** Anchor tolerance (ms): |offset| under this is "the same grid" (the
 * plan A3 A-OK signature). */
export const ANCHOR_TOLERANCE_MS = 10;

/** Extend the ledger-only verdict with the ANLZ-decoded truth: anchor
 * delta (fixed offset), phase (wrong beat of the bar), and the SHIFT and
 * PHASE buckets the ledger pass cannot assign. Pure. */
export interface FullGridAudit extends GridAuditVerdict {
  /** rb-ANLZ first downbeat − fitted-grid first downbeat, ms. */
  anchorDeltaMs: number;
  /** Anchor delta reduced mod 1 beat (ms, in [-halfBeat, halfBeat]) —
   * sub-beat jitter after whole-beat removal. */
  phaseMs: number;
  /** Whole-beat count the phase shift represents (anchor mod beat). */
  phaseBeats: number;
}

/**
 * The GA-04 full audit: our fitted grid vs the ANLZ grid rekordbox
 * actually wrote. Buckets per the plan A3 table — SHIFT (fixed offset),
 * PHASE (whole-beat offset), TEMPO, DRIFT, CHAOS, A-OK — now ALL
 * reachable. `ledgerAudit` supplies the ledger-only half (pass the
 * `gridAudit` result when you have one; computed here when not).
 */
export function gridAuditFull(
  ledgerBeats: number[],
  anlzBeats: AnlzBeat[],
  rbBpm: number,
  ledger: GridAuditVerdict | null = gridAudit(ledgerBeats, rbBpm),
): FullGridAudit | null {
  if (!ledger || ledgerBeats.length < 8 || anlzBeats.length < 2) return null;
  const fit = fitConstantTempo(ledgerBeats);
  if (!fit) return null;
  const beatMs = 60000 / fit.bpmFitted;

  // Anchor: ANLZ's first downbeat (num===1) vs our first beat.
  const anlzDown = anlzBeats.find((b) => b.num === 1) ?? anlzBeats[0]!;
  const anchorDeltaMs = anlzDown.timeMs - ledgerBeats[0]! * 1000;

  // Phase: remove whole beats from the anchor offset; what's left is
  // sub-beat jitter. Round to the NEAREST beat count — a 0.9-beat offset
  // is a 1-beat phase shift with -0.1 beat of jitter.
  const rawBeats = anchorDeltaMs / beatMs;
  const phaseBeats = Math.round(rawBeats);
  const phaseMs = anchorDeltaMs - phaseBeats * beatMs;

  let bucket: FullGridAudit["bucket"];
  let reason: string;
  if (ledger.bucket === "TEMPO" || ledger.bucket === "CHAOS") {
    // Tempo-class problems dominate — a shifted grid at the wrong tempo
    // is still a tempo repair first.
    bucket = ledger.bucket;
    reason = ledger.reason;
  } else if (phaseBeats !== 0) {
    // Whole-beat offset (plan A3 PHASE: "anchor ≈ ±1 or ±2 beats").
    // phaseMs carries the residual jitter for GA-05 calibration.
    bucket = "PHASE";
    reason =
      phaseBeats > 0
        ? `RB grid starts ${phaseBeats} beat(s) late (+${Math.round(anchorDeltaMs)} ms, ${Math.round(Math.abs(phaseMs))} ms off the bar line)`
        : `RB grid starts ${-phaseBeats} beat(s) early (${Math.round(anchorDeltaMs)} ms, ${Math.round(Math.abs(phaseMs))} ms off the bar line)`;
  } else if (Math.abs(anchorDeltaMs) > ANCHOR_TOLERANCE_MS) {
    // Sub-beat fixed offset with matched tempo (plan A3 SHIFT: "anchor
    // > 10 ms, drift small, ratio ≈ 1" → anchor rewrite).
    bucket = "SHIFT";
    reason = `grids match in tempo but RB's anchor sits ${Math.round(anchorDeltaMs)} ms off ours — anchor rewrite`;
  } else {
    bucket = ledger.bucket;
    reason = ledger.reason;
  }

  return {
    ...ledger,
    anchorDeltaMs: round1(anchorDeltaMs),
    phaseMs: round1(phaseMs),
    phaseBeats,
    bucket,
    reason,
  };
}
