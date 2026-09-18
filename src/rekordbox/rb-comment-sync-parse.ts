// rb-comment-sync-parse.ts — the payload-parsing arm of rb-comment-sync
// (#232 split, the rb-dedup pattern): the wire guards, the shape +
// consistency gates for the sync/verify subprocess payloads, the
// verification contract, and the ledger-freshness read. rb-comment-sync.ts
// keeps the option/result shapes, the runtime, the gates, and the
// rbCommentSync sequencer + apply leg.
import { existsSync } from "node:fs";
import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import {
  DECIMAL_ID_RE,
  isStringPair,
  isStringTriple,
  makePayloadParser,
  parseJsonBoundary,
} from "./rb-command-kit.js";
import { openLedger } from "../shared/sqlite-ledger";

/** The `T | null` narrows a stamp column value: string-and-non-empty
 *  passes, everything else (absent table, wrong type) degrades to null.
 *  Module-level so `ledgerFreshnessOf` doesn't rebuild it per call. */
const stampOf = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;

/** Ledger freshness for the sync result (#174): MAX(analyzed_at) per
 *  analysis ledger, straight from the archive DB — never file mtimes.
 *  Null stamps mean an empty/missing ledger and render as "no analysis
 *  yet" upstream, the honest gap. Read through the ONE SQLite seam
 *  (openLedger); any failure degrades to null stamps — freshness is
 *  display metadata and must never fail the sync. */
export function ledgerFreshnessOf(ledgerPath: string): {
  beatsAt: string | null;
  moodAt: string | null;
} {
  if (!existsSync(ledgerPath)) return { beatsAt: null, moodAt: null };
  try {
    const db = openLedger(ledgerPath);
    try {
      const row = db
        .query<Record<string, unknown>, []>(
          `SELECT
             (SELECT MAX(analyzed_at) FROM beats) AS beats_at,
             (SELECT MAX(analyzed_at) FROM mood) AS mood_at`,
        )
        .get();
      return {
        beatsAt: stampOf(row?.beats_at),
        moodAt: stampOf(row?.mood_at),
      };
    } finally {
      db.close();
    }
  } catch {
    // absent tables (schema drift / fresh ledger) → honest null stamps
    return { beatsAt: null, moodAt: null };
  }
}

export interface SyncOutput {
  scanned: number;
  eligible: number;
  written: number;
  alreadyHad: number;
  skipped: [string, string][];
  samples: [string, string][];
  writes: [string, string][];
  errors: [string, string][];
}

export interface CommentVerifyOutput {
  total: number;
  matched: number;
  missing: string[];
  mismatched: [string, string, string][];
}

/** `Array<[string, string]>` wire guard (skip/sample/write/error rows). */
function isStringPairArray(v: unknown): v is [string, string][] {
  return isUnknownArray(v) && v.every(isStringPair);
}

const nonNegativeInteger = isNonNegativeInteger;

/** Shape gate for the sync subprocess payload: counters are non-negative
 *  integers, pair rows are [string, string]. Throws on the first drift. */
function requireSyncShape(value: Record<string, unknown>): SyncOutput {
  if (
    !nonNegativeInteger(value.scanned) ||
    !nonNegativeInteger(value.eligible) ||
    !nonNegativeInteger(value.written) ||
    !nonNegativeInteger(value.alreadyHad) ||
    !isStringPairArray(value.skipped) ||
    !isStringPairArray(value.samples) ||
    !isStringPairArray(value.writes) ||
    !isStringPairArray(value.errors)
  ) {
    throw new Error("rb-comment-sync returned an invalid result payload");
  }
  return {
    scanned: value.scanned,
    eligible: value.eligible,
    written: value.written,
    alreadyHad: value.alreadyHad,
    skipped: value.skipped,
    samples: value.samples,
    writes: value.writes,
    errors: value.errors,
  };
}

/** Decimal ids, unique — the write-acknowledgement rule. */
function isUniqueDecimalIdList(ids: string[]): boolean {
  return (
    ids.every((id) => DECIMAL_ID_RE.test(id)) &&
    new Set(ids).size === ids.length
  );
}

/** Cross-field consistency checks over a shape-valid payload — the first
 *  failure wins, in the original throw order. Returns the full error
 *  message to throw, or null when every check holds. */
function syncConsistencyError(out: SyncOutput, apply: boolean): string | null {
  if (out.scanned !== out.eligible + out.alreadyHad + out.skipped.length)
    return "rb-comment-sync returned inconsistent scan counters";
  if (out.errors.length > 0) {
    const joined = out.errors
      .map(([id, detail]) => `${id}: ${detail}`)
      .join("; ");
    return `rb-comment-sync transaction failed: ${joined}`;
  }
  if (apply && out.written !== out.eligible)
    return `rb-comment-sync wrote ${out.written}/${out.eligible} eligible rows`;
  if (out.writes.length !== out.written)
    return "rb-comment-sync write acknowledgements are incomplete";
  if (!apply && out.written !== 0)
    return "rb-comment-sync report mode unexpectedly wrote rows";
  if (!isUniqueDecimalIdList(out.writes.map(([id]) => id)))
    return "rb-comment-sync returned invalid or duplicate content ids";
  return null;
}

export function parseSyncOutput(raw: string, apply: boolean): SyncOutput {
  const value = parseJsonBoundary(raw, "rb-comment-sync");
  if (!isRecord(value)) {
    throw new Error("rb-comment-sync returned an invalid result payload");
  }
  const out = requireSyncShape(value);
  const error = syncConsistencyError(out, apply);
  if (error) throw new Error(error);
  return out;
}

const isStringList = (v: unknown): v is string[] =>
  isUnknownArray(v) && v.every((id) => typeof id === "string");

const isStringTripleList = (v: unknown): v is [string, string, string][] =>
  isUnknownArray(v) && v.every(isStringTriple);

const parseVerifyShape = makePayloadParser<CommentVerifyOutput>(
  "rb-comment-sync verification",
  "rb-comment-sync verification returned an invalid payload",
  {
    total: nonNegativeInteger,
    matched: nonNegativeInteger,
    missing: isStringList,
    mismatched: isStringTripleList,
  },
);

export function parseVerifyOutput(raw: string): CommentVerifyOutput {
  return parseVerifyShape(raw);
}

export function validateVerification(
  expected: readonly (readonly [string, string])[],
  result: CommentVerifyOutput,
): void {
  if (result.total !== expected.length)
    throw new Error(
      `comment verification read ${result.total}/${expected.length} intended rows`,
    );
  if (result.missing.length > 0)
    throw new Error(
      `comment verification missing ids: ${result.missing.join(", ")}`,
    );
  if (result.mismatched.length > 0)
    throw new Error(
      `comment verification mismatched ids: ${result.mismatched.map(([id]) => id).join(", ")}`,
    );
  if (result.matched !== expected.length)
    throw new Error(
      `comment verification matched ${result.matched}/${expected.length} intended rows`,
    );
}
