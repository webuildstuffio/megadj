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
  const value = parseJsonBoundary(raw, "rb-dedup delete");
  if (
    typeof value !== "object" ||
    value === null ||
    !("removed_ids" in value) ||
    !isUnknownArray(value.removed_ids) ||
    !value.removed_ids.every(
      (id): id is string => typeof id === "string" && id.length > 0,
    ) ||
    new Set(value.removed_ids).size !== value.removed_ids.length ||
    !("errors" in value) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(
      (entry): entry is [string, string] =>
        isUnknownArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    ) ||
    !("associations" in value) ||
    !isUnknownArray(value.associations) ||
    !value.associations.every(
      (association) =>
        typeof association === "object" &&
        association !== null &&
        "keep_id" in association &&
        typeof association.keep_id === "string" &&
        association.keep_id.length > 0 &&
        "playlists" in association &&
        isUnknownArray(association.playlists) &&
        association.playlists.every(
          (membership: unknown) =>
            isUnknownArray(membership) &&
            membership.length === 2 &&
            typeof membership[0] === "string" &&
            membership[0].length > 0 &&
            finiteNonNegative(membership[1]) &&
            Number.isInteger(membership[1]),
        ) &&
        "cue_signatures" in association &&
        isUnknownArray(association.cue_signatures) &&
        association.cue_signatures.every(
          (signature: unknown) =>
            typeof signature === "string" && signature.length > 0,
        ),
    )
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
  const value = parseJsonBoundary(raw, "rb-dedup verification");
  if (
    typeof value !== "object" ||
    value === null ||
    !("rows" in value) ||
    !isUnknownArray(value.rows) ||
    !value.rows.every(
      (row): row is VerifyRowWire =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        typeof row.id === "string" &&
        row.id.length > 0 &&
        "path" in row &&
        typeof row.path === "string" &&
        "playlists" in row &&
        isUnknownArray(row.playlists) &&
        row.playlists.every(
          (membership: unknown) =>
            isUnknownArray(membership) &&
            membership.length === 2 &&
            typeof membership[0] === "string" &&
            finiteNonNegative(membership[1]) &&
            Number.isInteger(membership[1]),
        ) &&
        "cue_signatures" in row &&
        isUnknownArray(row.cue_signatures) &&
        row.cue_signatures.every(
          (signature: unknown) =>
            typeof signature === "string" && signature.length > 0,
        ) &&
        "cue_owners_valid" in row &&
        typeof row.cue_owners_valid === "boolean",
    ) ||
    new Set(value.rows.map((row) => row.id)).size !== value.rows.length
  ) {
    throw new Error(
      "rb-dedup verification returned invalid JSON: expected unique id/path rows",
    );
  }
  return value.rows.map((row) => ({
    id: row.id,
    path: row.path,
    playlists: row.playlists,
    cueSignatures: row.cue_signatures,
    cueOwnersValid: row.cue_owners_valid,
  }));
}
