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
 *  here but not in some other tool, fix it HERE — never fork the table.
 *
 *  Values are the canonical Mixed In Key wheel (verified against multiple
 *  published wheel tables 2026-09-11): minors 1A Abm → 12A C#m and majors
 *  1B B → 12B E in circle-of-fifths order. The first committed copy had 8
 *  entries silently wrong (e.g. F as 11B instead of 7B) — camelot.test.ts
 *  now pins all 24 canonical keys so drift or a bad hand-copy fails loud.
 *  Sharps AND flats are accepted where both spellings are common. */
const OPEN_KEY_TO_CAMELOT: Record<string, CamelotPos> = {
  "A#m": { n: 3, letter: "A" },
  Ab: { n: 4, letter: "B" },
  Abm: { n: 1, letter: "A" },
  B: { n: 1, letter: "B" },
  Bb: { n: 6, letter: "B" },
  Bbm: { n: 3, letter: "A" },
  Bm: { n: 10, letter: "A" },
  C: { n: 8, letter: "B" },
  "C#": { n: 3, letter: "B" },
  "C#m": { n: 12, letter: "A" },
  Cm: { n: 5, letter: "A" },
  Db: { n: 3, letter: "B" },
  Dbm: { n: 12, letter: "A" },
  D: { n: 10, letter: "B" },
  Dm: { n: 7, letter: "A" },
  Eb: { n: 5, letter: "B" },
  Ebm: { n: 2, letter: "A" },
  E: { n: 12, letter: "B" },
  Em: { n: 9, letter: "A" },
  F: { n: 7, letter: "B" },
  "F#": { n: 2, letter: "B" },
  "F#m": { n: 11, letter: "A" },
  Fm: { n: 4, letter: "A" },
  G: { n: 9, letter: "B" },
  "G#m": { n: 1, letter: "A" },
  Gb: { n: 2, letter: "B" },
  Gbm: { n: 11, letter: "A" },
  Gm: { n: 6, letter: "A" },
  A: { n: 11, letter: "B" },
  Am: { n: 8, letter: "A" },
};

/** Parse a key string to its Camelot wheel position. Accepts every
 *  spelling observed in real libraries: Camelot notation ("8A", "8a",
 *  "8 A"), open-key names ("Am", "C", "F#m", "Db"), Open Key notation
 *  ("7m", "6d" — Mixed In Key's alternate wheel where the number runs
 *  five ahead: 7m = 2A, 8d = 1B), and Western keys with an explicit mode
 *  suffix ("Gmaj", "Amin", "Eb minor"). Returns null when unparsable —
 *  callers degrade, never throw. */
export function camelotOf(key: string | null | undefined): CamelotPos | null {
  if (!key) return null;
  const trimmed = key.trim();
  const m = /^([1-9]|1[0-2])\s*([ABab])$/.exec(trimmed);
  if (m)
    return { n: parseInt(m[1]!, 10), letter: m[2]!.toUpperCase() as "A" | "B" };
  const direct = OPEN_KEY_TO_CAMELOT[trimmed];
  if (direct) return direct;
  // Open Key notation ("7m", "6d"): mode letter m = minor / d = major
  // (dur), number = Camelot number + 5 (mod 12) — 6m is 1A, 1d is 8B,
  // 7m is 2A. NOT the naive "7 minor = 7A": that reading silently
  // mis-keys every track.
  const ok = /^([1-9]|1[0-2])\s*([mdMD])$/.exec(trimmed);
  if (ok) {
    const okN = parseInt(ok[1]!, 10);
    const n = okN - 5 < 1 ? okN + 7 : okN - 5;
    return {
      n,
      letter: ok[2]!.toUpperCase() === "M" ? "A" : "B",
    };
  }
  // Western + mode suffix ("Gmaj", "Amin", "F# major", "eb minor",
  // "C m" — the space-separated bare-letter spelling also ships in
  // real TKEYs). Bare "m" = minor, bare "d" = major.
  const wm = /^([A-Ga-g])([#b]?)\s*(maj(?:or)?|min(?:or)?|dur|moll|[md])$/.exec(
    trimmed,
  );
  if (wm) {
    const root = wm[1]!.toUpperCase() + (wm[2] ?? "");
    const mode = wm[3]!.toLowerCase();
    const minor =
      mode.startsWith("min") || mode.startsWith("moll") || mode === "m";
    return OPEN_KEY_TO_CAMELOT[minor ? `${root}m` : root] ?? null;
  }
  return null;
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
  // signed shortest distance on the 12-hour wheel, so 12 → 1 is ±1 (the
  // classic end-of-set energy wrap), never the naive |12-1| = 11 clash.
  const dist = Math.min(Math.abs(a.n - b.n), 12 - Math.abs(a.n - b.n));
  if (dist === 0 && a.letter === b.letter) return 1; // same key
  if (dist === 0) return 1; // mood lift (relative major/minor)
  if (dist === 1 && a.letter === b.letter) return 1; // energy flow
  if (dist === 1) return 0.9; // diagonal
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
  // wheel-wrap: 12A glows compat with 1A too (same signed ±1 move)
  if (
    c.n === hover.n ||
    (c.letter === hover.letter &&
      Math.min(Math.abs(c.n - hover.n), 12 - Math.abs(c.n - hover.n)) === 1)
  )
    return "compat";
  return "";
}

/** Zero-padded sort token so "10B" sorts after "8B" lexicographically. */
export function keySortToken(key: string | null | undefined): string | null {
  const c = camelotOf(key);
  return c ? `${String(c.n).padStart(2, "0")}${c.letter}` : null;
}
