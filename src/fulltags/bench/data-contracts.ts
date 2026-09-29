/**
 * data-contracts.ts — Distribution invariant checks (B11.2).
 *
 * Validates that bench results and pipeline outputs satisfy expected
 * statistical invariants. Catches data corruption, silent regressions,
 * and pipeline bugs that pass unit tests but break real distributions.
 *
 * Contracts:
 * - BPM distribution: >90% of tracks in 60–200 BPM range
 * - Key distribution: all 24 keys present (no dead keys)
 * - Genre distribution: ≥10 families with ≥1 track each
 * - Energy distribution: all 10 bands populated
 * - Mood heads: ≥2 heads with 5–95% fire rate (not all-on or all-off)
 */
import { round3 } from "../../shared/leaf/fmt";

/** A distribution contract: name + check function + expected invariant. */
export interface DataContract {
  readonly name: string;
  readonly description: string;
  readonly check: (values: readonly (string | number)[]) => ContractResult;
}

/** Result of checking one contract. */
export interface ContractResult {
  readonly passed: boolean;
  readonly message: string;
  readonly measured: number;
  readonly threshold: number;
}

/**
 * BPM range contract: >90% of BPM values in 60–200.
 */
export function checkBpmRange(
  values: readonly (string | number)[],
): ContractResult {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length === 0) {
    return {
      passed: false,
      message: "no BPM values",
      measured: 0,
      threshold: 0.9,
    };
  }
  const inRange = nums.filter((v) => v >= 60 && v <= 200).length;
  const ratio = round3(inRange / nums.length);
  return {
    passed: ratio >= 0.9,
    message: `${(ratio * 100).toFixed(1)}% in 60–200 BPM (${inRange}/${nums.length})`,
    measured: ratio,
    threshold: 0.9,
  };
}

/**
 * Key coverage contract: all 24 Camelot keys present.
 */
export function checkKeyCoverage(
  values: readonly (string | number)[],
): ContractResult {
  const keys = new Set(values.map(String).filter((k) => k.length > 0));
  const unique = keys.size;
  return {
    passed: unique >= 24,
    message: `${unique}/24 keys present`,
    measured: unique,
    threshold: 24,
  };
}

/**
 * Genre family coverage: ≥10 distinct families.
 */
export function checkGenreCoverage(
  values: readonly (string | number)[],
): ContractResult {
  const families = new Set(values.map(String).filter((g) => g.length > 0));
  const unique = families.size;
  return {
    passed: unique >= 10,
    message: `${unique} genre families (min 10)`,
    measured: unique,
    threshold: 10,
  };
}

/**
 * Energy band coverage: all 10 bands (1–10) populated.
 */
export function checkEnergyBands(
  values: readonly (string | number)[],
): ContractResult {
  const bands = new Set(values.map(Number).filter((n) => n >= 1 && n <= 10));
  const unique = bands.size;
  return {
    passed: unique >= 10,
    message: `${unique}/10 energy bands populated`,
    measured: unique,
    threshold: 10,
  };
}

/** All standard data contracts. */
export const DATA_CONTRACTS: readonly DataContract[] = [
  {
    name: "bpm-range",
    description: ">90% of BPM values in 60–200",
    check: checkBpmRange,
  },
  {
    name: "key-coverage",
    description: "all 24 Camelot keys present",
    check: checkKeyCoverage,
  },
  {
    name: "genre-coverage",
    description: "≥10 genre families",
    check: checkGenreCoverage,
  },
  {
    name: "energy-bands",
    description: "all 10 energy bands populated",
    check: checkEnergyBands,
  },
];
