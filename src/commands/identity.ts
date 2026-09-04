/** Loose identity normalization shared by ingest dedupe + adopt. */

/** Normalize a string for loose title/artist comparison (same idea as adopt). */
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
