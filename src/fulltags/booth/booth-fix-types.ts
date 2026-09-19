// booth-fix-types.ts — the row/result wire types for the booth-fix gate.
// Leaf seam (AGENTS.md split rule): booth-fix.ts and booth-fix-text.ts both
// declare/use these; the split-out fixer must never import its parent's
// types back — madge counts a type-only back-edge as a cycle.
import type { BoothFixAction, BoothFixGate } from "../../shared/leaf/fixes";

/** One proposed/applied fix (one row per file per gate). */
export interface BoothFixRow {
  file: string;
  gate: BoothFixGate;
  reasons: string[];
  /** What the fixer WILL do on --apply. */
  action: BoothFixAction;
  /** Human proposal — every non-applied row must name its command. */
  plan: string;
  /** Renames: old → new. */
  rename?: { from: string; to: string };
}

/** The command's full result (rows + tallies). */
export interface BoothFixResult {
  fleet: string[];
  checked: number;
  fixable: number;
  applied: number;
  rows: BoothFixRow[];
}
