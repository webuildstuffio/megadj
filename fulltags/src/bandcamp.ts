/**
 * bandcamp.ts — the Bandcamp catalog source (the genre-audit §7 "Bandcamp
 * arm"). Third catalog search in the fetch ladder, behind SC + Beatport.
 *
 * Why page-fetch and not yt-dlp: the bandcamp extractor is broken
 * upstream (unsupported URL scheme since Aug 2026) and the search API is
 * NOT broken — two official JSON endpoints do the job:
 *
 *  - POST /api/bcsearch_public_api/1/autocomplete_elastic  (catalog
 *    search: `search_filter` "t" tracks / "b" bands / "a" albums)
 *  - GET  the item page → TWO parseable payloads:
 *      · <script type="application/ld+json"> — MusicRecording/MusicAlbum
 *        with byArtist, publisher (the LABEL), datePublished, duration,
 *        genre (discover-URL form), keywords (the tag array)
 *      · <a class="tag" href=".../discover/<tag>"> — the human tag list
 *
 * Trust profile (genre-audit §5c): Bandcamp tags are artist-entered like
 * SC's but the ecosystem is cleaner (labels tag releases properly, junk
 * like "edits/bootlegs" is rare) — measured ingest-pool consistency is
 * 53.1%, and these are the SAME rips. Rank: third vote, never overwrites
 * SC or Beatport fills; strongest at label identity (publisher field)
 * which only Beatport also carries.
 *
 * THE ARTIST GATE: search hits are gated through name-match.artistGate —
 * query artist must appear in the band name (or a credited track artist)
 * or the hit is dropped. A fuzzy title match on someone else's upload
 * must never write a genre (the Taylor Swift class, fixed for SC in
 * Sep 15's gate work).
 */
import { cleanSearchParts, type SearchQueryParts } from "./search-query";
import {
  artistGate,
  hasTitleTokenOverlap,
  primaryArtist,
  titleOverlap,
} from "./name-match";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_TIMEOUT = 12_000;

/** Minimum title-overlap for a Bandcamp hit to be considered at all
 *  (same guard class as SC's overlap ≥ 1 and BP's BP_MIN_SCORE floor). */
export const BC_MIN_OVERLAP = 0.25;

export interface BcTrack {
  /** Bandcamp numeric item id (track). */
  id: number;
  /** Track title as published ("Depths of Consciousness (Mix)"). */
  name: string;
  /** The band/label page the item lives on ("MXGN", "Drumcode"). */
  bandName: string;
  /** Credited track artist when it differs from the band ("HI-LO" on the
   *  Drumcode page) — null when band == artist. */
  artist: string | null;
  /** Album title when the hit carries one. */
  albumName: string | null;
  /** Canonical track page URL (the provenance stamp value). */
  url: string;
  /** Album art (largest served; upgrade to _10 via artUrl). */
  artUrl: string | null;
  /** Combined score (title overlap ×4 + artist gate points + tag boosts). */
  score: number;
}

interface BcApiResult {
  type?: string;
  id?: number;
  name?: string;
  band_name?: string;
  album_name?: string | null;
  item_url_path?: string;
  img?: string | null;
}

interface BcApiResponse {
  auto?: { results?: BcApiResult[] };
}

/** JSON-LD field readers (module scope — lint: no per-call closures). */
const ldStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const ldObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;

/** Search the Bandcamp catalog (tracks). Never throws — transport
 *  failures log at this boundary and return [] so the ladder degrades to
 *  the next source (same discipline as beatportLookup's catch). */
export async function bcSearchRaw(q: SearchQueryParts): Promise<BcTrack[]> {
  const cleaned = cleanSearchParts(q.artist, q.title);
  const term = bcQueryTerm(cleaned);
  if (!term) return [];
  let res: Response;
  try {
    res = await fetch(
      "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({
          search_text: term,
          search_filter: "t",
          full_page: false,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      },
    );
    if (!res.ok) {
      console.error(`bandcamp search → HTTP ${res.status}`);
      return [];
    }
  } catch (e) {
    console.error(`bandcamp search failed`, e);
    return [];
  }
  let data: BcApiResponse;
  try {
    data = (await res.json()) as BcApiResponse;
  } catch (e) {
    console.error(`bandcamp search → unparseable JSON`, e);
    return [];
  }
  const out: BcTrack[] = [];
  for (const r of data.auto?.results ?? []) {
    if (r.type !== "t" || !r.id || !r.item_url_path) continue;
    const name = r.name ?? "";
    if (!name) continue;
    const bandName = r.band_name ?? "";
    const artist = bandName && r.band_name === r.name ? null : bandName;
    out.push({
      id: r.id,
      name,
      bandName,
      artist,
      albumName: r.album_name ?? null,
      url: r.item_url_path,
      artUrl: r.img ?? null,
      score: titleOverlap(q.title, name) * 4,
    });
  }
  return out;
}

/** Scored + gated Bandcamp search: THE entry point other code calls.
 *  Relevance gate (title token overlap) first, then the hard artist
 *  gate (query artist must appear in band/artist fields), then sort. */
export function scoreBcHits(hits: BcTrack[], q: SearchQueryParts): BcTrack[] {
  const kept = hits.filter((h) => {
    if (titleOverlap(q.title, h.name) < BC_MIN_OVERLAP) return false;
    const artistStrings = [h.bandName, h.artist, h.albumName].filter(
      (s): s is string => Boolean(s),
    );
    return artistGate(q.artist, artistStrings) > 0;
  });
  // gate points ride the score: exact artist 6, contained 4 (same shape
  // as the Beatport scorer so ladder sources stay comparable).
  for (const h of kept) {
    const g = artistGate(
      q.artist,
      [h.bandName, h.artist, h.albumName].filter((s): s is string =>
        Boolean(s),
      ),
    );
    h.score += g === 6 ? 6 : g === 4 ? 4 : 0;
  }
  kept.sort((a, b) => b.score - a.score);
  return kept;
}

/** Search + gate in one call (the shape pipeline.ts/fetch-all want). */
export async function bcSearch(q: SearchQueryParts): Promise<BcTrack | null> {
  const raw = await bcSearchRaw(q);
  const gated = scoreBcHits(raw, q);
  return gated[0] ?? null;
}

/** Fetch + parse one Bandcamp item page (track or album URL). Extracts
 *  everything the ladder reads: tags (the genre vocabulary), label
 *  (ld+json publisher), credited artist, publish date, art, duration.
 *  Returns null on any transport/parse failure — callers degrade. */
export interface BcPage {
  url: string;
  title: string | null;
  artist: string | null;
  /** The LABEL — ld+json publisher ("Drumcode"). Bandcamp's strongest
   *  identity field; only Beatport also carries it. */
  label: string | null;
  /** Artist-entered tags, display form ("chill out", "ambient"). */
  tags: string[];
  /** The ld+json genre URL's leaf when present ("ambient"). */
  genre: string | null;
  /** Item page art (og:image, _5 = 700px class). */
  artUrl: string | null;
  /** Item publish date (ISO yyyy-mm-dd) — the release/upload year. */
  datePublished: string | null;
  /** Track duration in seconds (album pages: first track). */
  durationS: number | null;
}

export async function bcFetchPage(url: string): Promise<BcPage | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) {
      console.error(`bandcamp page ${url} → HTTP ${res.status}`);
      return null;
    }
  } catch (e) {
    console.error(`bandcamp page ${url} failed`, e);
    return null;
  }
  const raw = await res.text();

  const tags = [
    ...raw.matchAll(/<a class="tag" href="[^"]*\/discover\/([^"?/]+)/g),
  ]
    .map((m) => m[1]?.trim())
    .filter((t): t is string => Boolean(t));

  let page: BcPage = {
    url,
    title: null,
    artist: null,
    label: null,
    tags,
    genre: tags[0] ?? null,
    artUrl: raw.match(/property="og:image" content="([^"]+)"/)?.[1] ?? null,
    datePublished: null,
    durationS: null,
  };

  const ld = raw.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (ld?.[1]) {
    try {
      const j = JSON.parse(
        ld[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      ) as Record<string, unknown>;
      const byArtist = ldObj(j.byArtist);
      const publisher = ldObj(j.publisher);
      const inAlbum = ldObj(j.inAlbum);
      const albumPublisher = ldObj(inAlbum?.publisher);
      const dateRaw =
        ldStr(j.datePublished) ?? ldStr(inAlbum?.datePublished) ?? null;
      const dur = parseIsoDuration(ldStr(j.duration));
      page = {
        ...page,
        title: ldStr(j.name) ?? page.title,
        artist: ldStr(byArtist?.name) ?? page.artist,
        label:
          ldStr(publisher?.name) ?? ldStr(albumPublisher?.name) ?? page.label,
        genre:
          page.genre ??
          (typeof j.genre === "string"
            ? (j.genre.split("/").pop() ?? null)
            : null),
        artUrl: page.artUrl ?? (ldStr(j.image) ? String(j.image) : null),
        datePublished: dateRaw ? isoFromBcDate(dateRaw) : null,
        durationS: page.durationS ?? dur,
      };
    } catch (e) {
      // ld+json parse failure is non-fatal: tags from the HTML stand.
      console.error(`bandcamp page ${url} → ld+json parse failed`, e);
    }
  }
  return page;
}

/** "19 Dec 2021 14:25:14 GMT" | "10 Oct 2025 00:00:00 GMT" → "2021-12-19". */
export function isoFromBcDate(bc: string): string | null {
  const t = Date.parse(bc);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO-8601 duration ("P01H14M09S") → seconds; null when unparseable. */
export function parseIsoDuration(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    iso,
  );
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total =
    (d ? Number(d) * 86_400 : 0) +
    (h ? Number(h) * 3_600 : 0) +
    (min ? Number(min) * 60 : 0) +
    (s ? Number(s) : 0);
  return total > 0 ? total : null;
}

/** Compact query term: primary artist + cleaned title (≤8 tokens). Same
 *  discipline as cleanSearchQuery but keeps bracket content (Bandcamp
 *  titles carry meaningful bracket info, e.g. "[free download]"). */
export function bcQueryTerm(q: SearchQueryParts): string {
  const artist0 = primaryArtist(q.artist);
  const tokens = `${artist0} ${q.title}`
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return tokens.join(" ").trim();
}

/** Genre vote from a Bandcamp page: canonicalize the best tag through the
 *  shared SC/canon map (tags are close cousins of SC's free-text genres).
 *  Returns null when nothing maps — never invents a label. The junk gate
 *  lives in the CALLER (applyScGenre-equivalent) so every source funnels
 *  through one numeric/`Music` refuse point. */
export function bcGenre(
  page: BcPage,
  canon: (raw: string) => string,
): string | null {
  for (const tag of page.tags) {
    if (/^\d+$/.test(tag) || tag.toLowerCase() === "music") continue;
    const c = canon(tag);
    if (/^\d+$/.test(c) || c.toLowerCase() === "music") continue;
    return c;
  }
  return null;
}

/** True when this candidate hit could still be fetched (used by callers
 *  that pre-filter before page fetches — keeps network legs bounded). */
export function bcHitPlausible(hit: BcTrack, q: SearchQueryParts): boolean {
  return (
    hasTitleTokenOverlap(q.title, hit.name) &&
    artistGate(
      q.artist,
      [hit.bandName, hit.artist].filter((s): s is string => s !== null),
    ) > 0
  );
}

/** Largest served art URL: search thumbnails are `_3` (350² class);
 *  `_10` is the original upload. Bandcamp serves any size id for any
 *  stored image, so the upgrade is a pure URL rewrite. */
export function artUrlLarge(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/_(\d+)\.jpg$/, "_10.jpg");
}
