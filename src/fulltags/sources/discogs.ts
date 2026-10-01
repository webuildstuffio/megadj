/**
 * discogs.ts — Discogs CC0 data dump arm (B4.2).
 *
 * Parses the Discogs monthly XML dump (CC0-licensed, offline) for
 * genre/style information. The dump is ~70 GB compressed; this module
 * handles the streaming XML parser and genre mapping.
 *
 * Discogs data model:
 * - Release → genres[] + styles[] (L2/L3 level)
 * - Artist → releases
 * - Master → canonical release grouping
 *
 * We match by artist+title against the archive ledger.
 */
import { mapToFamily } from "../genre/taxonomy-v3";
import { familyOf } from "../genre/genre-vocab";

/** A Discogs release's genre information. */
export interface DiscogsRelease {
  readonly releaseId: number;
  readonly title: string;
  readonly artists: readonly string[];
  /** Discogs genres (broad: "Electronic", "Hip Hop"). */
  readonly genres: readonly string[];
  /** Discogs styles (specific: "Deep House", "Acid Techno"). */
  readonly styles: readonly string[];
  readonly year: number | null;
  readonly country: string | null;
}

/** Mapped genre result from a Discogs release. */
export interface DiscogsGenreResult {
  readonly releaseId: number;
  /** Mapped L2 families from styles (preferred) and genres. */
  readonly families: readonly string[];
  /** Raw styles that couldn't be mapped. */
  readonly unmappedStyles: readonly string[];
  /** Best L2 family (most specific match from styles). */
  readonly bestFamily: string | null;
  /** L3 subgenre (the raw style string that mapped). */
  readonly bestStyle: string | null;
}

/**
 * Map a Discogs release to L2 genre families.
 * Prefers styles (more specific) over genres.
 */
export function mapDiscogsRelease(release: DiscogsRelease): DiscogsGenreResult {
  const families: string[] = [];
  const unmappedStyles: string[] = [];
  let bestFamily: string | null = null;
  let bestStyle: string | null = null;

  // Styles first (more specific = better L3 signal)
  for (const style of release.styles) {
    const family = mapToFamily(style) ?? familyOf(style) ?? null;
    if (family !== null) {
      families.push(family);
      if (bestFamily === null) {
        bestFamily = family;
        bestStyle = style.toLowerCase();
      }
    } else {
      unmappedStyles.push(style);
    }
  }

  // Fall back to genres if no styles mapped
  if (families.length === 0) {
    for (const genre of release.genres) {
      const family = mapToFamily(genre) ?? familyOf(genre) ?? null;
      if (family !== null) {
        families.push(family);
        if (bestFamily === null) bestFamily = family;
      }
    }
  }

  return {
    releaseId: release.releaseId,
    families: [...new Set(families)],
    unmappedStyles,
    bestFamily,
    bestStyle,
  };
}

/** Discogs XML tag names we care about during streaming parse. */
export const DISCOGS_TAGS = {
  RELEASE: "release",
  TITLE: "title",
  GENRES: "genres",
  GENRE: "genre",
  STYLES: "styles",
  STYLE: "style",
  ARTISTS: "artists",
  ARTIST: "artist",
  NAME: "name",
  RELEASED: "released",
  COUNTRY: "country",
} as const;

/**
 * Parse a Discogs release year from the "released" field.
 * Formats: "2024", "2024-03-15", "2024-03".
 */
export function parseDiscogsYear(released: string | null): number | null {
  if (released === null || released.length < 4) return null;
  const year = Number(released.slice(0, 4));
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
}
