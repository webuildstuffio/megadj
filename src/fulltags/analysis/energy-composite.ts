/**
 * energy-composite.ts — Bloc-based rank normalization + composite scoring.
 *
 * Energy v3.1: signals are grouped into 5 blocs (Rhythm, Brightness, Body,
 * Activity, Perceptual). Within each bloc, signals are averaged. Bloc
 * percentiles are combined with preset weights. The composite is banded
 * into E1–E9 against a frozen reference.
 *
 * No training, no labels. Weight selection from presets scored on gates.
 */
import { round3, round4 } from "../../shared/leaf/fmt";
import type { EnergyFeatureRow } from "./energy-features";
import { bandFromReference, buildEnergyReference } from "./energy-bands";

// --------------- signal names & bloc structure ---------------

/** All signal names extracted per track. */
export const SIGNAL_NAMES = [
  "onsetsPerBeat",
  "bpm",
  "hfEnergyReLufs",
  "lowEnergyReLufs",
  "crestFactor",
  "spectralFlux",
  "lufsDrop",
  "spectralCentroid",
  "aggressive",
  "engagement",
  "approachability",
  "arousalDrop",
] as const;

export type SignalName = (typeof SIGNAL_NAMES)[number];

/** Bloc assignment: each signal belongs to exactly one bloc. */
export const SIGNAL_BLOCS: Readonly<Record<SignalName, BlocName>> = {
  onsetsPerBeat: "rhythm",
  bpm: "rhythm",
  hfEnergyReLufs: "brightness",
  spectralCentroid: "brightness",
  lowEnergyReLufs: "body",
  crestFactor: "body",
  lufsDrop: "body",
  spectralFlux: "activity",
  aggressive: "perceptual",
  engagement: "perceptual",
  approachability: "perceptual",
  arousalDrop: "perceptual",
};

export const BLOC_NAMES = [
  "rhythm",
  "brightness",
  "body",
  "activity",
  "perceptual",
] as const;
export type BlocName = (typeof BLOC_NAMES)[number];

/** Signals that are INVERTED (lower raw = higher energy). */
const INVERTED_SIGNALS = new Set<SignalName>([
  "crestFactor",
  "approachability",
]);

// --------------- weight presets ---------------

export interface WeightPreset {
  readonly name: string;
  readonly weights: Readonly<Record<BlocName, number>>;
}

export const WEIGHT_PRESETS: readonly WeightPreset[] = [
  {
    name: "equal",
    weights: {
      rhythm: 0.2,
      brightness: 0.2,
      body: 0.2,
      activity: 0.2,
      perceptual: 0.2,
    },
  },
  {
    name: "default",
    weights: {
      rhythm: 0.2,
      brightness: 0.2,
      body: 0.2,
      activity: 0.1,
      perceptual: 0.3,
    },
  },
  {
    name: "dsp-heavy",
    weights: {
      rhythm: 0.25,
      brightness: 0.25,
      body: 0.25,
      activity: 0.15,
      perceptual: 0.1,
    },
  },
  {
    name: "perceptual-heavy",
    weights: {
      rhythm: 0.15,
      brightness: 0.15,
      body: 0.15,
      activity: 0.05,
      perceptual: 0.5,
    },
  },
];

// --------------- frozen reference ---------------

/** Frozen sorted values per signal for percentile lookup. */
export interface FrozenSignals {
  readonly values: Readonly<Record<string, readonly number[]>>;
  readonly deadSignals: readonly string[];
}

/** IQR threshold for dead-signal detection. */
const IQR_DEAD_THRESHOLD = 0.02;

/** Build a frozen reference from all library rows. Dead signals (IQR < threshold) are excluded. */
export function freezeSignals(
  rows: readonly EnergyFeatureRow[],
): FrozenSignals {
  const values: Record<string, number[]> = {};
  const deadSignals: string[] = [];

  for (const name of SIGNAL_NAMES) {
    const raw = rows
      .map((r) => r[name])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (raw.length === 0) {
      deadSignals.push(name);
      continue;
    }
    const sorted = raw.toSorted((a, b) => a - b);
    const q25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
    const q75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const iqr = q75 - q25;
    if (iqr < IQR_DEAD_THRESHOLD) {
      deadSignals.push(name);
      continue;
    }
    values[name] = sorted;
  }

  return { values, deadSignals };
}

// --------------- percentile conversion ---------------

/** Convert a raw value to its percentile [0, 1] in the frozen sorted array.
 *  Inverted signals: high raw → low percentile (flipped). */
export function toPercentile(
  value: number,
  sortedRef: readonly number[],
  inverted: boolean,
): number {
  if (sortedRef.length === 0) return 0.5;
  let lo = 0;
  let hi = sortedRef.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedRef[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  const pct = lo / sortedRef.length;
  return inverted ? 1 - pct : pct;
}

// --------------- composite scoring ---------------

/** Compute per-signal percentiles for one track. */
export function signalPercentiles(
  row: EnergyFeatureRow,
  frozen: FrozenSignals,
): Record<string, number> {
  const pcts: Record<string, number> = {};
  for (const name of SIGNAL_NAMES) {
    const ref = frozen.values[name];
    if (ref === undefined) continue;
    const val = row[name];
    if (val === null || !Number.isFinite(val)) {
      pcts[name] = 0.5;
      continue;
    }
    pcts[name] = toPercentile(val, ref, INVERTED_SIGNALS.has(name));
  }
  return pcts;
}

/** Compute bloc percentiles (average of signal percentiles within each bloc). */
export function blocPercentiles(
  sigPcts: Readonly<Record<string, number>>,
): Record<BlocName, number> {
  const blocAccum = Object.fromEntries(
    BLOC_NAMES.map((b) => [b, [] as number[]]),
  ) as Record<BlocName, number[]>;
  for (const [sig, pct] of Object.entries(sigPcts)) {
    const bloc = SIGNAL_BLOCS[sig as SignalName];
    if (bloc !== undefined) blocAccum[bloc].push(pct);
  }
  const result = Object.fromEntries(
    BLOC_NAMES.map((name) => {
      const arr = blocAccum[name];
      return [
        name,
        arr.length > 0
          ? round4(arr.reduce((a, b) => a + b, 0) / arr.length)
          : 0.5,
      ];
    }),
  ) as Record<BlocName, number>;
  return result;
}

/** Compute composite score from bloc percentiles and a weight preset. */
export function compositeScore(
  blocs: Readonly<Record<BlocName, number>>,
  preset: WeightPreset,
): number {
  let sum = 0;
  for (const name of BLOC_NAMES) {
    sum += (blocs[name] ?? 0.5) * preset.weights[name];
  }
  return round4(sum);
}

/** Energy confidence: low if Tier A (rhythm+brightness+body+activity) and
 *  Tier B (perceptual) disagree by > 0.30 percentile points. */
export function energyConfidence(
  blocs: Readonly<Record<BlocName, number>>,
): "high" | "low" {
  const tierA = [blocs.rhythm, blocs.brightness, blocs.body, blocs.activity];
  const meanA = tierA.reduce((a, b) => a + b, 0) / tierA.length;
  const meanB = blocs.perceptual;
  return Math.abs(meanA - meanB) > 0.3 ? "low" : "high";
}

// --------------- full pipeline ---------------

export interface ScoredTrack {
  readonly videoId: string;
  readonly composite: number;
  readonly band: number;
  readonly confidence: "high" | "low";
  readonly blocs: Readonly<Record<BlocName, number>>;
}

/** Score all tracks against a frozen reference with a weight preset. */
export function scoreAll(
  rows: readonly EnergyFeatureRow[],
  frozen: FrozenSignals,
  preset: WeightPreset,
): ScoredTrack[] {
  const composites: number[] = [];
  const entries: {
    videoId: string;
    composite: number;
    confidence: "high" | "low";
    blocs: Record<BlocName, number>;
  }[] = [];

  for (const row of rows) {
    const sigPcts = signalPercentiles(row, frozen);
    const blocs = blocPercentiles(sigPcts);
    const score = compositeScore(blocs, preset);
    composites.push(score);
    entries.push({
      videoId: row.videoId,
      composite: score,
      confidence: energyConfidence(blocs),
      blocs,
    });
  }

  const ref = buildEnergyReference(composites);

  return entries.map((e) => ({
    videoId: e.videoId,
    composite: e.composite,
    band: bandFromReference(e.composite, ref),
    confidence: e.confidence,
    blocs: e.blocs,
  }));
}

/** Compute band distribution as share per band (E1–E9). */
export function bandDistribution(
  tracks: readonly ScoredTrack[],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let i = 1; i <= 9; i++) counts[i] = 0;
  for (const t of tracks) {
    counts[t.band] = (counts[t.band] ?? 0) + 1;
  }
  const n = tracks.length || 1;
  const shares: Record<number, number> = {};
  for (let i = 1; i <= 9; i++) {
    shares[i] = round3((counts[i] ?? 0) / n);
  }
  return shares;
}
