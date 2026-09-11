// db_canon.ts — canon(), the stable stringify used by the setSnapshot
// change-detector. Own module for two reasons: (1) it's a pure leaf — no
// imports, trivially testable; (2) lizard's TS parser mis-parses a
// module-level function followed by an `export class` as ONE giant function
// spanning the rest of the file (it read the old db.ts as a 75-CCN "canon"
// swallowing half of class DB). Ending the file at the function keeps the
// report honest — the function itself is 4 decisions, not 75.

/** Stable stringify: key-sorted at EVERY depth, arrays kept in order, every
 *  key included. Used by the setSnapshot change-detector, which must SEE
 *  nested edits. The old `JSON.stringify(o, Object.keys(o).sort())` passed
 *  the top-level key list as the replacer — replacer arrays filter keys at
 *  ALL levels, so nested objects stringified as {} and any same-length
 *  nested change (track title/BPM edit, playlist membership swap) read as
 *  "unchanged" and was silently dropped (stale fleet tables + parity). */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).toSorted(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries
      .map(([k, val]) => `${JSON.stringify(k)}:${canon(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
