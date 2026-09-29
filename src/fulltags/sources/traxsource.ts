/**
 * traxsource.ts — Traxsource / Juno / Beatsource genre clients (B4.3).
 *
 * These stores carry DJ-specific genre taxonomies that are closer to our
 * L2/L3 families than consumer stores (iTunes, Last.fm).
 *
 * - Traxsource: primary DJ download store (house/techno focus)
 * - Juno Download: UK-centric DJ store (strong on D&B, garage, dubstep)
 * - Beatsource: Beatport's open-format sibling (hip hop, R&B, pop)
 *
 * All three use HTML scraping (no public API). Rate-limited to 1 req/3s.
 */
import { mapToFamily, type GenreFamily } from "../genre/taxonomy-v3";

const STORE_DELAY_MS = 3000; // 1 request per 3 seconds

/** A genre result from a DJ store search. */
export interface StoreGenreResult {
  readonly store: "traxsource" | "juno" | "beatsource";
  readonly trackTitle: string;
  readonly artistName: string;
  /** Raw genre string from the store. */
  readonly rawGenre: string;
  /** Mapped L2 family. */
  readonly family: GenreFamily | null;
  /** Store-specific subgenre/tag. */
  readonly subgenre: string | null;
  /** BPM from the store (if available). */
  readonly bpm: number | null;
  /** Key from the store (if available). */
  readonly key: string | null;
  /** Track URL on the store. */
  readonly url: string;
}

/** Traxsource genre vocabulary → L2 family. */
const TRAXSOURCE_GENRE_MAP = new Map<string, GenreFamily>([
  ["deep house", "house"],
  ["house", "house"],
  ["afro house", "house"],
  ["soulful house", "house"],
  ["jackin house", "house"],
  ["funky house", "house"],
  ["tech house", "tech house"],
  ["techno", "techno"],
  ["melodic house & techno", "techno"],
  ["minimal / deep tech", "minimal"],
  ["nu disco / indie dance", "disco"],
  ["disco / nu-disco", "disco"],
  ["broken beat / nu-jazz", "funk"],
  ["electronica", "ambient"],
  ["downtempo", "downtempo"],
  ["garage / bassline / grime", "garage"],
  ["drum & bass", "drum and bass"],
  ["dubstep", "dubstep"],
  ["trance", "trance"],
  ["hard dance / hardcore", "hardstyle"],
]);

/** Juno genre vocabulary → L2 family. */
const JUNO_GENRE_MAP = new Map<string, GenreFamily>([
  ["deep house", "house"],
  ["house", "house"],
  ["tech house", "tech house"],
  ["techno", "techno"],
  ["minimal", "minimal"],
  ["drum & bass", "drum and bass"],
  ["jungle", "drum and bass"],
  ["dubstep", "dubstep"],
  ["garage", "garage"],
  ["broken beat", "breakbeat"],
  ["electro", "electro"],
  ["ambient", "ambient"],
  ["downtempo", "downtempo"],
  ["trance", "trance"],
  ["disco", "disco"],
  ["funk", "funk"],
  ["soul", "soul"],
  ["hip hop", "hip hop"],
]);

/** Beatsource genre vocabulary → L2 family. */
const BEATSOURCE_GENRE_MAP = new Map<string, GenreFamily>([
  ["house", "house"],
  ["tech house", "tech house"],
  ["hip-hop", "hip hop"],
  ["r&b", "r&b"],
  ["pop", "pop"],
  ["dance", "house"],
  ["electro pop", "pop"],
  ["afrobeats", "afrobeats"],
  ["dancehall", "dancehall"],
  ["reggaeton", "latin"],
  ["latin", "latin"],
  ["funk", "funk"],
  ["soul", "soul"],
  ["disco", "disco"],
]);

/**
 * Map a store's genre string to our L2 family.
 */
export function mapStoreGenre(
  store: "traxsource" | "juno" | "beatsource",
  rawGenre: string,
): GenreFamily | null {
  const lower = rawGenre.toLowerCase().trim();
  const map =
    store === "traxsource"
      ? TRAXSOURCE_GENRE_MAP
      : store === "juno"
        ? JUNO_GENRE_MAP
        : BEATSOURCE_GENRE_MAP;

  const direct = map.get(lower);
  if (direct) return direct;

  // Fall back to taxonomy
  return mapToFamily(rawGenre);
}

/** Delay between store API calls. */
export function storeDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, STORE_DELAY_MS);
  });
}
