/**
 * Subcategory classifier for acoustic-twin findings (docs/
 * shelf-hygiene-2026-09-09.md §4.2 + the Sep 9 session's "why are they
 * slightly different" analysis). Two files with the SAME chromaprint can
 * still differ in bytes for very different reasons — the size-delta ratio
 * separates the actionable buckets:
 *
 *   metadata-diff   <0.5%   same rip; tag/art/metadata chunk differences.
 *                           Safe to keep the larger file — one batch
 *                           button, ear never needed.
 *   re-encode      0.5–3%   transcoded once at ~similar bitrate.
 *                           Audibly identical to most ears; same action,
 *                           louder confirm copy.
 *   quality-diff      >3%   genuinely different encodes/quality. Real
 *                           ear-check: side-by-side compare, user picks.
 *   oddball      same size  same size but different bytes — could be a
 *                           different master; ear-check required.
 *
 * This is CLASSIFICATION ONLY — it never changes severity or autoSafe.
 * The human gate stays mandatory for every acoustic-twin (§4.2); buckets
 * exist so the UI/CLI can batch the boring confirmations and highlight
 * the real decisions.
 */

export type AcousticSubcategory =
  "metadata-diff" | "re-encode" | "quality-diff" | "oddball";

export interface AcousticSub {
  subcategory: AcousticSubcategory;
  /** |a−b| / max(a,b) — 0 when sizes are equal */
  sizeDeltaRatio: number;
  /** user-facing one-liner for the queue row */
  why: string;
}

export const ACOUSTIC_SUB_LABELS: Record<AcousticSubcategory, string> = {
  "metadata-diff": "same rip, metadata-only diff",
  "re-encode": "re-encoded at similar bitrate",
  "quality-diff": "different quality/source — compare first",
  oddball: "same size, different bytes — ear-check",
};

export function classifyAcousticSub(
  bytesA: number,
  bytesB: number,
): AcousticSub {
  if (bytesA === bytesB) {
    return {
      subcategory: "oddball",
      sizeDeltaRatio: 0,
      why: ACOUSTIC_SUB_LABELS.oddball,
    };
  }
  const ratio = Math.abs(bytesA - bytesB) / Math.max(bytesA, bytesB);
  if (ratio < 0.005) {
    return {
      subcategory: "metadata-diff",
      sizeDeltaRatio: ratio,
      why: ACOUSTIC_SUB_LABELS["metadata-diff"],
    };
  }
  if (ratio < 0.03) {
    return {
      subcategory: "re-encode",
      sizeDeltaRatio: ratio,
      why: ACOUSTIC_SUB_LABELS["re-encode"],
    };
  }
  return {
    subcategory: "quality-diff",
    sizeDeltaRatio: ratio,
    why: ACOUSTIC_SUB_LABELS["quality-diff"],
  };
}

/** The action-shaped buckets the CLI --bucket flag and the web UI's batch
 *  buttons accept. `ear-check` groups the two buckets that genuinely need
 *  listening (quality-diff + oddball); `safe-batch` groups the two that
 *  share one boring action (metadata-diff + re-encode). */
export type AcousticBucket =
  | "metadata-diff"
  | "re-encode"
  | "quality-diff"
  | "oddball"
  | "ear-check"
  | "safe-batch";

export const BUCKET_MEMBERSHIP: Record<AcousticBucket, AcousticSubcategory[]> =
  {
    "metadata-diff": ["metadata-diff"],
    "re-encode": ["re-encode"],
    "quality-diff": ["quality-diff"],
    oddball: ["oddball"],
    "ear-check": ["quality-diff", "oddball"],
    "safe-batch": ["metadata-diff", "re-encode"],
  };

export function inBucket(sub: string, bucket: string): boolean {
  const members = BUCKET_MEMBERSHIP[bucket as AcousticBucket];
  return members ? members.includes(sub as AcousticSubcategory) : false;
}

/**
 * Buckets whose members genuinely need ears before a keep decision —
 * batch-confirming them would stamp "confirmed" over 90+ rows the user
 * never reviewed (exactly what the listen-first contract forbids; §4.2's
 * human gate stays mandatory for every acoustic-twin). These buckets are
 * FILTER-ONLY on every surface: the web strip filters by them, the CLI
 * refuses to --confirm them. Sep 11 super-sure pass: a live probe proved
 * `--bucket quality-diff` silently confirmed 94 unreviewed findings —
 * this set is the guard that was missing.
 */
export const LISTEN_FIRST_BUCKETS: readonly AcousticBucket[] = [
  "quality-diff",
  "oddball",
  "ear-check",
];

/** True when a bucket is listen-first — batch-confirm must refuse it. */
export function isListenFirst(bucket: string): boolean {
  return LISTEN_FIRST_BUCKETS.includes(bucket as AcousticBucket);
}
