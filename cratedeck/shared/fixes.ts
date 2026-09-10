// fixes.ts — the booth-fix wire contract (split from shared/types.ts for
// the file-length cap; same rule shared/hygiene.ts obeys). Imports NOTHING
// (leaf of the leaf); types.ts re-exports so existing imports compile.

/** What class of booth problem a row reports. */
export type FixReason =
  | "path-trailing-dot-or-space"
  | "path-illegal-character"
  | "non-fleet-characters"
  | "mojibake"
  | "float-pcm-unsupported"
  | "sample-rate-unsupported"
  | "bit-depth-unsupported"
  | "codec-unsupported"
  | "path-too-deep";

/** What the fix step would do. `none` = proposal only (no safe autofix):
 *  intentional scripts, hi-res audio — a human re-sources or converts. */
export type FixAction = "rename" | "sanitize-tags" | "none";

/** One fixable (or merely flagged) file from `megadj booth-fix --json`.
 *  `plan` is the CLI's human plan line (e.g. "rename → x.wav"); `to` is
 *  the structured rename target when action === "rename". */
export interface FixRow {
  file: string;
  gate: "booth-text" | "player-compat";
  reasons: FixReason[];
  action: FixAction;
  plan: string | null;
  to?: string | null;
}

/** GET /api/fixes response: rows + the census the banner renders. */
export interface FixesPayload {
  fleet: string[];
  checked: number;
  fixable: number;
  applied: number;
  rows: FixRow[];
  /** volume the last scan covered (null = never scanned) */
  scannedPath: string | null;
}
