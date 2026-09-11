// camelot.ts — the Camelot wheel, ONE SSOT for every surface.
//
// Two parsers existed and drifted: cratedeck/src/setbuild.ts's accepted
// open-key names ("Am", "C", "F#m", …) while web/products/cratedeck/
// PlaylistsTab.tsx's inline `camelot()` parsed only the notation form
// ("8A") — a library whose TKEYs are open-key strings glowed ZERO
// compatible keys in the crate view. This module is the single parse +
// compat table both surfaces (and any future one) import.

/** Camelot wheel position: number 1–12 + letter A (minor) / B (major). */
export interface CamelotPos {
  n: number;
  letter: "A" | "B";
}

/** Standard open-key ("Am", "C", "F#m") → Camelot table. If a key parses
 *  here but not in some other tool, fix it HERE — never fork the table. */
const OPEN_KEY_TO_CAMELOT: Record<string, CamelotPos> = {
  "A#m": { n: 1, letter: "B" },
  Ab: { n: 1, letter: "A" },
  B: { n: 1, letter: "B" },
  Bb: { n: 6, letter: "B" },
  Bbm: { n: 3, letter: "A" },
  C: { n: 8, letter: "B" },
  "C#": { n: 12, letter: "B" },
  "C#m": { n: 12, letter: "A" },
  Cm: { n: 5, letter: "A" },
  Db: { n: 3, letter: "B" },
  D: { n: 10, letter: "B" },
  Dm: { n: 7, letter: "A" },
  Eb: { n: 9, letter: "B" },
  Ebm: { n: 2, letter: "A" },
  E: { n: 12, letter: "B" },
  Em: { n: 9, letter: "A" },
  F: { n: 11, letter: "B" },
  "F#": { n: 7, letter: "B" },
  "F#m": { n: 11, letter: "A" },
  Fm: { n: 4, letter: "A" },
  G: { n: 9, letter: "B" },
  "G#m": { n: 6, letter: "A" },
  Gb: { n: 2, letter: "B" },
  Gbm: { n: 2, letter: "A" },
  Gm: { n: 6, letter: "A" },
  A: { n: 11, letter: "B" },
  Am: { n: 8, letter: "A" },
};

/** Parse a key string to its Camelot wheel position. Accepts Camelot
 *  notation ("8A", "8a", "8 A") and common open-key names ("Am", "C").
 *  Returns null when unparsable — callers degrade, never throw. */
export function camelotOf(key: string | null | undefined): CamelotPos | null {
  if (!key) return null;
  const trimmed = key.trim();
  const m = /^([1-9]|1[0-2])\s*([ABab])$/.exec(trimmed);
  if (m)
    return { n: parseInt(m[1]!, 10), letter: m[2]!.toUpperCase() as "A" | "B" };
  return OPEN_KEY_TO_CAMELOT[trimmed] ?? null;
}

/** Camelot compatibility score 0..1: 1 = same wheel position or the four
 *  classic moves (±1 number same letter, ±1 letter same number), 0.9 =
 *  the diagonal, 0 = clash. Either side unparsable → neutral 0.5 (never
 *  blocks, never helps). */
export function keyCompatScore(
  a: CamelotPos | null,
  b: CamelotPos | null,
): number {
  if (!a || !b) return 0.5;
  if (a.n === b.n && a.letter === b.letter) return 1; // same key
  if (a.letter === b.letter && Math.abs(a.n - b.n) === 1) return 1; // energy flow
  if (a.n === b.n && a.letter !== b.letter) return 1; // mood lift
  if (Math.abs(a.n - b.n) === 1 && a.letter !== b.letter) return 0.9; // diagonal
  return 0; // clash
}

/** Relationship label for UI glyphs: how key `k` sits relative to `hover`.
 *  "" = no relation / unparsable. The crate browser glows rows with this. */
export type KeyRelation = "" | "same" | "compat";

export function keyRelation(
  k: string | null | undefined,
  hover: CamelotPos,
): KeyRelation {
  const c = camelotOf(k);
  if (!c) return "";
  if (c.n === hover.n && c.letter === hover.letter) return "same";
  if (
    c.n === hover.n ||
    (Math.abs(c.n - hover.n) === 1 && c.letter === hover.letter)
  )
    return "compat";
  return "";
}

/** Zero-padded sort token so "10B" sorts after "8B" lexicographically. */
export function keySortToken(key: string | null | undefined): string | null {
  const c = camelotOf(key);
  return c ? `${String(c.n).padStart(2, "0")}${c.letter}` : null;
}
