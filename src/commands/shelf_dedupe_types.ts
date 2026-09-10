// shelf_dedupe_types.ts — the wire types for the shelf twin-dedupe pass.
// Leaf seam (AGENTS.md split rule): shelf-dedupe.ts (the command) and
// shelf_dedupe_verdict.ts (the split-out judge/apply) both use these; the
// split-out module must never import its parent's types back — madge
// counts a type-only back-edge as a cycle.

/** One twin pair verdict (one row per "<stem> [<volume>]" twin). */
export interface DedupePair {
  original: string;
  twin: string;
  bytesOriginal: number;
  bytesTwin: number;
  /** md5 | fingerprint | different-audio */
  method: string;
  verdict: "keep-original" | "keep-twin" | "keep-both";
  /** human-readable reason for the verdict */
  reason: string;
  /** quarantine path if apply would move this file */
  loser?: string | null;
}

/** The command's full result. */
export interface DedupeResult {
  shelfVolume: string;
  quarantine: string;
  pairs: DedupePair[];
  scanned: number;
  byteDupes: number;
  fingerprintDupes: number;
  keepBoth: number;
  applied: boolean;
  moved: number;
  /** keep-twin pairs applied: twin content now lives at the original path */
  upgraded: number;
  errors: string[];
  ok: boolean;
}
