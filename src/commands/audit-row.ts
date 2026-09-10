/**
 * audit-row — the AuditRow shape shared by `megadj audit` (fetch.ts) and
 * its reporters. Kept separate so thin reporters (CLI printers, future
 * surfaces) can type against the row without importing the auditor.
 */

/** One track's ground-truth audit verdict (file is the truth). */
export interface AuditRow {
  file: string;
  art: boolean;
  title: boolean;
  artist: boolean;
  album: boolean;
  genre: boolean;
  year: boolean;
  /** TXXX:MOOD stamp present (roadmap #4 — mood/valence completeness). */
  mood: boolean;
  /** TXXX:ENERGY stamp present (the energy stage's output). */
  energy: boolean;
  /** Plays on the whole booth fleet (XDJ-XZ/3000/2000NXS2/2000) —
   *  player-compat gate; a tag-complete file the booth can't load is
   *  still a gap. */
  playable: boolean;
  /** Displays correctly on the whole fleet + exports cleanly (booth-text
   *  gate: emoji/CJK/Cyrillic outside the players' glyph tables,
   *  mojibake double-encodes, export-killing filename characters,
   *  over-long/over-deep paths). */
  readable: boolean;
  /** Why the booth can't read it (empty when readable). */
  unreadableReasons: string[];
  complete: boolean;
}

/** Format one row's gap flags for the human audit report: missing tag
 * fields, player-compat, and the named booth-text reasons. */
export function auditRowFlags(r: AuditRow): string {
  const missing = (Object.entries(r) as [string, unknown][])
    .filter(
      ([k, v]) =>
        k !== "file" &&
        k !== "complete" &&
        k !== "playable" &&
        k !== "readable" &&
        k !== "unreadableReasons" &&
        !v,
    )
    .map(([k]) => k);
  const flags = [
    ...missing,
    r.playable ? "" : "player-compat",
    r.readable ? "" : `booth-text: ${r.unreadableReasons.join(",")}`,
  ].filter(Boolean);
  return flags.join(" | ");
}
