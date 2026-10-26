/**
 * remix-route.ts — artist routing for remix/edit detection (B8).
 *
 * When a track is a remix/edit/bootleg, artist-level genre sources
 * (SC search, MB folksonomy, Last.fm) should query the REMIXER, not
 * the original artist, because the remixer's genre is what landed in
 * the file (a tech-house remix of a pop track is tech-house).
 *
 * For "exact recording" sources (Beatport, Discogs) this doesn't
 * matter — they match by release/recording, not artist search.
 */
import { parseVersion, type VersionIdentity } from "./version";

export interface RoutedArtist {
  /** The artist to use for genre source queries. */
  readonly artist: string;
  /** Whether we routed to the remixer (not the original). */
  readonly isRemix: boolean;
  /** The version identity for diagnostics. */
  readonly version: VersionIdentity;
}

/** Version types where the remixer IS the genre-defining artist. */
const REMIX_TYPES = new Set(["remix", "edit", "bootleg", "flip", "vip", "rework", "dub"]);

/**
 * Determine the correct artist for genre lookups. If the track is a
 * remix/edit/etc., returns the remixer (when available and confident).
 * Falls back to the original artist otherwise.
 */
export function routeArtistForGenre(artist: string, title: string): RoutedArtist {
  const version = parseVersion(title, artist);

  if (
    REMIX_TYPES.has(version.versionType) &&
    version.versionArtists.length > 0 &&
    version.confidence >= 0.7
  ) {
    return { artist: version.versionArtists[0]!, isRemix: true, version };
  }

  return { artist, isRemix: false, version };
}
