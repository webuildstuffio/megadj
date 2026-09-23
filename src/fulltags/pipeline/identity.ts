/**
 * FullTags identity — loose title/artist normalization for ingest dedupe
 * and `megadj adopt`. The file's truth beats the DB row's, and both must
 * collapse to the same key for "Nari & Milani - Atom (Immersed remix)
 * _FINAL" vs "Nari & Milani Atom Immersed remix" class duplicates.
 */

/** Normalize a string for loose title/artist comparison. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[｜|]/g, "|")
    .replace(/\(1\)|\(2\)|\(3\)/g, " ") // Safari "name (1).ext" dupes
    .replace(/[()[\]]/g, " ")
    .replace(/_/g, " ")
    .replace(/\b(final|master|mstr|v\d+)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dedupe/compare key: `artist|title` with normalize() applied to both. */
export function identityKey(
  artist: string | null | undefined,
  title: string,
): string {
  return `${normalize(artist ?? "")}|${normalize(title)}`;
}
