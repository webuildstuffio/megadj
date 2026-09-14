/** The artist/title pair every external catalog search starts from. */
export interface SearchQueryParts {
  artist: string | null;
  title: string;
}

/** Remove placeholder metadata before scoring or building a catalog query. */
export function cleanSearchParts(
  artist: string | null,
  title: string,
): SearchQueryParts {
  const junk =
    /UnknownArtist\s*(?:·\s*UnknownAlbum\s*)?·\s*|Unknown\s*Artist\s*[-–—]\s*/giu;
  return {
    artist: artist?.replace(junk, "").trim() || null,
    title: title.replace(junk, "").trim(),
  };
}

/** Build the compact query shared by SoundCloud and Beatport. */
export function cleanSearchQuery(row: SearchQueryParts): string {
  const { artist, title } = cleanSearchParts(row.artist, row.title);
  const artist0 = (artist ?? "").split(/[,&]/)[0]?.trim() ?? "";
  const cleanedTitle = title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(final|mstr|master|vip|full|cdq|extended|radio edit|feat\.?|ft\.?)\b/gi,
      " ",
    )
    .replace(/\b\d+(\.\d+)+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${cleanedTitle}`
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}
