/**
 * Reusable analysis re-gates.
 *
 * Detectors produce observations; this module owns the pass bar, per-track
 * measurement, saturation guard, and the only hand-off into file writes.
 * Keeping those concerns here lets BPM, genre, and effnet use one harness
 * without weakening the synchronous writer contract.
 */
import { writePatchSync } from "./writer";
import type { TagPatch } from "./schema";

export type GateDimension = "bpm" | "genre" | "effnet";

export interface GateObservation<T> {
  id: string;
  expected: T;
  actual: T | null;
}

export interface GateTrackResult {
  id: string;
  expected: unknown;
  actual: unknown;
  offsetPercent: number | null;
  pass: boolean;
}

export interface GateResult {
  dimension: GateDimension;
  tolerancePercent: number;
  passPercent: number;
  requiredPercent: number;
  passed: boolean;
  tracks: GateTrackResult[];
}

export interface RegateOptions<T> {
  dimension: GateDimension;
  observations: readonly GateObservation<T>[];
  /** Relative numeric error accepted by the gate. Defaults to 2%. */
  tolerancePercent?: number;
  /** Minimum passing-track percentage. Defaults to the 80% bar. */
  passPercent?: number;
  /** Equality for labels such as genre and effnet. Defaults to Object.is. */
  equals?: (expected: T, actual: T) => boolean;
}

export class GateSaturationError extends Error {
  readonly dimension: GateDimension;

  constructor(dimension: GateDimension) {
    super(
      `${dimension} detector saturated: every analyzed track returned the same value; refusing to treat a wiring bug as a passing gate`,
    );
    this.name = "GateSaturationError";
    this.dimension = dimension;
  }
}

const finitePercent = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    throw new RangeError(
      `${name} must be a finite percentage between 0 and 100`,
    );
  return value;
};

const offsetPercent = (expected: unknown, actual: unknown): number | null => {
  if (
    typeof expected !== "number" ||
    typeof actual !== "number" ||
    !Number.isFinite(expected) ||
    !Number.isFinite(actual) ||
    expected === 0
  )
    return null;
  return (
    Math.round((Math.abs(actual - expected) / Math.abs(expected)) * 10000) / 100
  );
};

function assertNotSaturated<T>(
  dimension: GateDimension,
  observations: readonly GateObservation<T>[],
): void {
  const actual = observations
    .map((observation) => observation.actual)
    .filter((value): value is T => value !== null);
  if (actual.length >= 2 && new Set(actual).size === 1)
    throw new GateSaturationError(dimension);
}

/** Score one detector output set. Missing outputs are misses, never skips. */
export function runRegate<T>(options: RegateOptions<T>): GateResult {
  const tolerancePercent = finitePercent(
    options.tolerancePercent ?? 2,
    "tolerancePercent",
  );
  const requiredPercent = finitePercent(
    options.passPercent ?? 80,
    "passPercent",
  );
  assertNotSaturated(options.dimension, options.observations);
  const equals = options.equals ?? Object.is;
  const tracks = options.observations.map((observation) => {
    const offset = offsetPercent(observation.expected, observation.actual);
    const pass =
      observation.actual !== null &&
      (offset !== null
        ? offset <= tolerancePercent
        : equals(observation.expected, observation.actual));
    return {
      id: observation.id,
      expected: observation.expected,
      actual: observation.actual,
      offsetPercent: offset,
      pass,
    } satisfies GateTrackResult;
  });
  const passedCount = tracks.filter((track) => track.pass).length;
  const passPercent =
    tracks.length === 0
      ? 0
      : Math.round((passedCount / tracks.length) * 1000) / 10;
  return {
    dimension: options.dimension,
    tolerancePercent,
    passPercent,
    requiredPercent,
    passed: tracks.length > 0 && passPercent >= requiredPercent,
    tracks,
  };
}

export interface GateWrite {
  filePath: string;
  patch: TagPatch;
}

export interface GateWriteResult {
  attempted: number;
  written: number;
  failed: number;
}

/** Apply writes only after a passing gate, through the synchronous writer. */
export function applyGateWritesSync(
  result: GateResult,
  writes: readonly GateWrite[],
  writer: (filePath: string, patch: TagPatch) => boolean = writePatchSync,
): GateWriteResult {
  if (!result.passed) return { attempted: 0, written: 0, failed: 0 };
  let written = 0;
  let failed = 0;
  for (const write of writes) {
    if (writer(write.filePath, write.patch)) written++;
    else failed++;
  }
  return { attempted: writes.length, written, failed };
}
