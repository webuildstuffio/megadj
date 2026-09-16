/**
 * rb-dedup-parse.ts — the rb-dedup subprocess JSON boundary (issue #144).
 *
 * Split from rb-dedup.ts (the repo-largest file) so parsing lives apart
 * from orchestration. Every Python result crosses into TypeScript through
 * parseJsonBoundary (rb-command-kit) — the private twin that used to live
 * here is gone; the kit is the one guarded JSON.parse seam, and its
 * context string ("rb-dedup scan" / "…delete" / "…verification")
 * reproduces the twin's error text byte-for-byte.
 */

import { parseJsonBoundary } from "./rb-command-kit.js";

export interface ScanRow {
  id: string;
  path: string;
  title: string;
  len: number;
  size: number;
  bitrate: number;
}

export interface ScanPair extends ScanRow {
  other: ScanRow;
  basis: "same-path" | "path-twin" | "candidate";
}

export interface ScanResult {
  scanned: number;
  pairs: ScanPair[];
}

export interface AssociationExpectation {
  keepId: string;
  playlists: [string, number][];
  cueSignatures: string[];
}

interface AssociationExpectationWire {
  keep_id: string;
  playlists: [string, number][];
  cue_signatures: string[];
}

export interface DeleteResult {
  removedIds: string[];
  errors: [string, string][];
  associations: AssociationExpectation[];
}

export const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

/** Non-empty string. The every wire id must be one. */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Every element passes the guard. Point-free helper for the validators
 *  below — the old inline `.every()` lambdas were the CCN 37 wall. */
const everyIs = (value: unknown, guard: (item: unknown) => boolean): boolean =>
  isUnknownArray(value) && value.every(guard);

/** A `[playlist_name, position]` membership tuple (integer position ≥ 0). */
const isMembership = (value: unknown): value is [string, number] =>
  isUnknownArray(value) &&
  value.length === 2 &&
  isNonEmptyString(value[0]) &&
  finiteNonNegative(value[1]) &&
  Number.isInteger(value[1]);

/** A non-empty cue signature string. */
const isCueSignature = (value: unknown): value is string =>
  isNonEmptyString(value);

/** A wire association proof: keeper id + playlists + cue signatures. */
const isAssociationWire = (
  value: unknown,
): value is AssociationExpectationWire =>
  typeof value === "object" &&
  value !== null &&
  "keep_id" in value &&
  isNonEmptyString(value.keep_id) &&
  "playlists" in value &&
  everyIs(value.playlists, isMembership) &&
  "cue_signatures" in value &&
  everyIs(value.cue_signatures, isCueSignature);

function isScanRow(value: unknown): value is ScanRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "path" in value &&
    typeof value.path === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "len" in value &&
    finiteNonNegative(value.len) &&
    "size" in value &&
    finiteNonNegative(value.size) &&
    "bitrate" in value &&
    finiteNonNegative(value.bitrate)
  );
}

function isScanPair(value: unknown): value is ScanPair {
  return (
    isScanRow(value) &&
    "other" in value &&
    isScanRow(value.other) &&
    "basis" in value &&
    (value.basis === "same-path" ||
      value.basis === "path-twin" ||
      value.basis === "candidate")
  );
}

export function parseScanResult(raw: string): ScanResult {
  const value = parseJsonBoundary(raw, "rb-dedup scan");
  if (
    typeof value !== "object" ||
    value === null ||
    !("scanned" in value) ||
    !finiteNonNegative(value.scanned) ||
    !Number.isInteger(value.scanned) ||
    !("pairs" in value) ||
    !isUnknownArray(value.pairs) ||
    !value.pairs.every(isScanPair)
  ) {
    throw new Error(
      "rb-dedup scan returned invalid JSON: expected a finite census and complete candidate rows",
    );
  }
  return { scanned: value.scanned, pairs: value.pairs };
}

export function parseDeleteResult(
  raw: string,
  expectedIds?: readonly string[],
): DeleteResult {
  const value = parseJsonBoundary(raw, "rb-dedup delete") as Record<
    string,
    unknown
  > | null;
  /** unique non-empty strings — the removed/acknowledged id rule. */
  const isUniqueStringList = (v: unknown): v is string[] => {
    if (!isUnknownArray(v)) return false;
    if (!v.every(isNonEmptyString)) return false;
    return new Set(v as string[]).size === v.length;
  };
  /** `[error_id, message]` tuple on every entry. */
  const isErrorsWire = (v: unknown): v is [string, string][] => {
    if (!isUnknownArray(v)) return false;
    return v.every(
      (entry) =>
        isUnknownArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    );
  };

  if (
    typeof value !== "object" ||
    value === null ||
    !isUniqueStringList(value.removed_ids) ||
    !isErrorsWire(value.errors) ||
    !everyIs(value.associations, isAssociationWire)
  ) {
    throw new Error(
      "rb-dedup delete returned invalid JSON: expected removed ids, errors, and association proofs",
    );
  }
  const result: DeleteResult = {
    removedIds: value.removed_ids,
    errors: value.errors,
    associations: (value.associations as AssociationExpectationWire[]).map(
      (association) => ({
        keepId: association.keep_id,
        playlists: association.playlists,
        cueSignatures: association.cue_signatures,
      }),
    ),
  };
  // One keeper can absorb multiple losers from the same duplicate cluster,
  // so keeper ids may repeat. The subprocess emits one proof per removed row
  // in mapping order; only that one-to-one cardinality is required here.
  if (result.associations.length !== result.removedIds.length) {
    throw new Error(
      "rb-dedup delete returned invalid JSON: association proofs do not match removed rows",
    );
  }
  if (expectedIds) {
    const expected = new Set(expectedIds);
    const acknowledged = [
      ...result.removedIds,
      ...result.errors.map(([id]) => id),
    ];
    if (
      acknowledged.length !== expected.size ||
      new Set(acknowledged).size !== acknowledged.length ||
      acknowledged.some((id) => !expected.has(id))
    ) {
      throw new Error(
        "rb-dedup delete returned invalid JSON: acknowledgements do not match requested loser ids",
      );
    }
  }
  return result;
}

export interface VerifyRow {
  id: string;
  path: string;
  playlists: [string, number][];
  cueSignatures: string[];
  cueOwnersValid: boolean;
}

interface VerifyRowWire {
  id: string;
  path: string;
  playlists: [string, number][];
  cue_signatures: string[];
  cue_owners_valid: boolean;
}

export function parseVerifyRows(raw: string): VerifyRow[] {
  const value = parseJsonBoundary(raw, "rb-dedup verification") as Record<
    string,
    unknown
  > | null;
  /** One wire verify row (snake_case), fully validated. */
  const isVerifyRowWire = (row: unknown): row is VerifyRowWire =>
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    isNonEmptyString(row.id) &&
    "path" in row &&
    typeof row.path === "string" &&
    "playlists" in row &&
    everyIs(row.playlists, isMembership) &&
    "cue_signatures" in row &&
    everyIs(row.cue_signatures, isCueSignature) &&
    "cue_owners_valid" in row &&
    typeof row.cue_owners_valid === "boolean";
  /** All rows valid AND ids unique — the verification contract. */
  const isVerifyRowsWire = (v: unknown): v is VerifyRowWire[] => {
    if (!isUnknownArray(v)) return false;
    if (!v.every(isVerifyRowWire)) return false;
    return new Set(v.map((row) => row.id)).size === v.length;
  };
  const value2 = value;
  if (
    typeof value2 !== "object" ||
    value2 === null ||
    !isVerifyRowsWire(value2.rows)
  ) {
    throw new Error(
      "rb-dedup verification returned invalid JSON: expected unique id/path rows",
    );
  }
  return value2.rows.map((row) => ({
    id: row.id,
    path: row.path,
    playlists: row.playlists,
    cueSignatures: row.cue_signatures,
    cueOwnersValid: row.cue_owners_valid,
  }));
}
