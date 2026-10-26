/**
 * energy-validate.ts — Non-circular validation gates for energy v3.1.
 *
 * Every gate is automatic (no human labels). Gates that a random number
 * generator cannot pass: section ordering, degradation, tier agreement.
 * Genre direction is a sanity check only (never a tuning signal).
 */
import { round3 } from "../../shared/leaf/fmt";
import { BLOC_NAMES, type ScoredTrack } from "./energy-composite";

// --------------- gate results ---------------

export interface GateResult {
  readonly name: string;
  readonly pass: boolean;
  readonly value: number | string;
  readonly threshold: string;
  readonly detail?: string;
}

// --------------- correlation helpers ---------------

/** Spearman rank correlation between two number arrays. */
export function spearmanRho(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const rankA = fractionalRanks(a.slice(0, n));
  const rankB = fractionalRanks(b.slice(0, n));
  return pearsonR(rankA, rankB);
}

/** Pearson correlation coefficient. */
function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sx2 = 0,
    sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
    sxy += x[i]! * y[i]!;
    sx2 += x[i]! * x[i]!;
    sy2 += y[i]! * y[i]!;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  return den < 1e-10 ? 0 : num / den;
}

/** Fractional ranks for Spearman. */
function fractionalRanks(arr: readonly number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = Array.from({ length: arr.length }, () => 0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j]!.v === indexed[i]!.v) j++;
    const meanRank = (i + j - 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k]!.i] = meanRank;
    i = j;
  }
  return ranks;
}

/** Cohen's d effect size between two groups. */
export function cohenD(group1: readonly number[], group2: readonly number[]): number {
  if (group1.length < 2 || group2.length < 2) return 0;
  const m1 = mean(group1);
  const m2 = mean(group2);
  const s1 = stddev(group1);
  const s2 = stddev(group2);
  const pooled = Math.sqrt(
    ((group1.length - 1) * s1 * s1 + (group2.length - 1) * s2 * s2) /
      (group1.length + group2.length - 2),
  );
  return pooled < 1e-10 ? 0 : (m1 - m2) / pooled;
}

function mean(arr: readonly number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stddev(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// --------------- gate: no bloc dominates ---------------

/** Check that no single bloc's variance share exceeds the threshold. */
export function gateBlocDominance(tracks: readonly ScoredTrack[], maxShare = 0.4): GateResult {
  if (tracks.length < 10) {
    return {
      name: "bloc-dominance",
      pass: false,
      value: "n/a",
      threshold: `≤${maxShare}`,
      detail: "too few tracks",
    };
  }
  const blocVars: Record<string, number> = {};
  for (const bloc of BLOC_NAMES) {
    const vals = tracks.map((t) => t.blocs[bloc]);
    blocVars[bloc] = variance(vals);
  }
  const totalVar = Object.values(blocVars).reduce((a, b) => a + b, 0);
  if (totalVar < 1e-10) {
    return { name: "bloc-dominance", pass: true, value: 0, threshold: `≤${maxShare}` };
  }
  let maxBlocShare = 0;
  let maxBloc = "";
  for (const [bloc, v] of Object.entries(blocVars)) {
    const share = v / totalVar;
    if (share > maxBlocShare) {
      maxBlocShare = share;
      maxBloc = bloc;
    }
  }
  return {
    name: "bloc-dominance",
    pass: maxBlocShare <= maxShare,
    value: round3(maxBlocShare),
    threshold: `≤${maxShare}`,
    detail: `max bloc: ${maxBloc}`,
  };
}

function variance(arr: readonly number[]): number {
  const s = stddev(arr);
  return s * s;
}

// --------------- gate: not just BPM ---------------

export function gateNotBpm(
  tracks: readonly ScoredTrack[],
  bpms: readonly number[],
  maxRho = 0.5,
): GateResult {
  const composites = tracks.map((t) => t.composite);
  const rho = round3(Math.abs(spearmanRho(composites, bpms)));
  return { name: "not-bpm", pass: rho < maxRho, value: rho, threshold: `|ρ|<${maxRho}` };
}

// --------------- gate: tier agreement ---------------

export function gateTierAgreement(tracks: readonly ScoredTrack[], minRho = 0.4): GateResult {
  const tierA = tracks.map((t) => {
    const a = [t.blocs.rhythm, t.blocs.brightness, t.blocs.body, t.blocs.activity];
    return a.reduce((s, v) => s + v, 0) / a.length;
  });
  const tierB = tracks.map((t) => t.blocs.perceptual);
  const rho = round3(spearmanRho(tierA, tierB));
  return { name: "tier-agreement", pass: rho >= minRho, value: rho, threshold: `ρ≥${minRho}` };
}

// --------------- gate: genre direction (sanity check ONLY) ---------------

/** Genre direction: high-energy families should score higher than low-energy ones.
 *  SANITY CHECK ONLY — never used for weight tuning. */
export function gateGenreDirection(
  highEnergy: readonly number[],
  lowEnergy: readonly number[],
  minD = 0.5,
): GateResult {
  const d = round3(cohenD(highEnergy, lowEnergy));
  return {
    name: "genre-direction",
    pass: d > minD,
    value: d,
    threshold: `d>${minD}`,
    detail: `high n=${highEnergy.length}, low n=${lowEnergy.length}`,
  };
}

// --------------- gate: gain invariance ---------------

/** Gain invariance: +3dB should shift ≤1 band for ≥95% of tracks.
 *  Accepts pre-computed original and gained bands. */
export function gateGainInvariance(
  originalBands: readonly number[],
  gainedBands: readonly number[],
  maxShift = 1,
  minPct = 0.95,
): GateResult {
  const n = Math.min(originalBands.length, gainedBands.length);
  if (n === 0) {
    return {
      name: "gain-invariance",
      pass: false,
      value: "n/a",
      threshold: `≤${maxShift} band in ${minPct * 100}%`,
    };
  }
  let ok = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs((originalBands[i] ?? 0) - (gainedBands[i] ?? 0)) <= maxShift) ok++;
  }
  const pct = round3(ok / n);
  return { name: "gain-invariance", pass: pct >= minPct, value: pct, threshold: `≥${minPct}` };
}

// --------------- gate: duplicate consistency ---------------

/** Duplicate consistency: different rips of the same track should be ±1 band. */
export function gateDuplicateConsistency(
  pairs: readonly [number, number][],
  maxDiff = 1,
): GateResult {
  if (pairs.length === 0) {
    return {
      name: "duplicate-consistency",
      pass: true,
      value: "n/a",
      threshold: `±${maxDiff}`,
      detail: "no pairs",
    };
  }
  let ok = 0;
  for (const [a, b] of pairs) {
    if (Math.abs(a - b) <= maxDiff) ok++;
  }
  const pct = round3(ok / pairs.length);
  return { name: "duplicate-consistency", pass: pct >= 0.95, value: pct, threshold: `≥0.95` };
}

// --------------- collect all gates ---------------

export function collectGates(results: readonly GateResult[]): {
  passed: number;
  total: number;
  allPass: boolean;
  results: readonly GateResult[];
} {
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, allPass: passed === results.length, results };
}
