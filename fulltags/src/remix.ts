/**
 * FullTags remix — remix/bootleg detection from filenames + titles.
 * Migrated verbatim from src/commands/remix.ts. Bootlegs rarely have
 * MusicBrainz entries, so filename structure
 * (`Artist - Track (Remixer Remix)`) is the best source for credits.
 */

export interface RemixInfo {
  /** Original track title, e.g. "Savin Me". */
  track: string;
  /** Original artist, e.g. "Nickelback". */
  originalArtist: string;
  /** Remix credit, e.g. "Flozone" or "Flozone Flip". */
  remixName: string;
  remixer: string;
  original: string;
}

/**
 * Detect `X - Y (Z Remix/Flip/Edit)` patterns. Returns null when no remix
 * pattern is present.
 */
export function detectRemix(title: string): RemixInfo | null {
  // "Artist - Track (Remixer Remix)" / "(Remixer Flip)" / "(Remixer Edit)"
  const m =
    /^(.{2,80}?)\s+-\s+(.{1,120}?)\s*\(([^()]{2,60}?)\s+(remix|flip|edit|rework|re-work|vip|bootleg)\s*\)$/i.exec(
      title.trim(),
    );
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const originalArtist = m[1].trim();
  const track = m[2].trim();
  const tail = m[3].trim();
  const kind = m[4].toLowerCase();
  // "Flozone Remix" → remixer "Flozone"; "a x b Remix" → last name wins.
  const remixers = tail
    .replace(new RegExp(`\\s+${kind}$`, "i"), "")
    .split(/\s+[x&]\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const remixer = remixers[remixers.length - 1] ?? tail;
  // m[3] is lazy so it stops before the keyword — rebuild the full credit.
  const remixName = `${tail} ${m[4]}`;
  return {
    track,
    originalArtist,
    remixName,
    remixer,
    original: `${originalArtist} - ${track}`,
  };
}
