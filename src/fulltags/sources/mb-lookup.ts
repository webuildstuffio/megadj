/**
 * MusicBrainz source module (folded from mb.ts + mb-lookup.ts, #322 m2) —
 * one module per external source, one politeness seam.
 *
 * Two arms:
 *  - recording lookup (mbRecording / mbLookupCached / MbTruth): fills
 *    missing artist/album/date through ONE wire seam (mbFetchRecordings,
 *    issue #99) — query encode + UA + timeout + not-ok degrade + guarded
 *    JSON parse written once; the two lookups used to carry byte-twin
 *    fetch blocks that had already drifted (only the cached path bounded
 *    its request; an unbounded ad-hoc lookup could stall an ingest batch
 *    on a dead connection).
 *  - folksonomy genre harvest (mbGenreForArtist, roadmap #5): the third
 *    genre vote alongside SoundCloud tags + AI. Artist-level tags
 *    ("house", "uk garage") mapped through the same canonical vocabulary
 *    as every other source. `megadj enrich` delegates here — the old
 *    duplicate writer in src/commands/enrich.ts is deleted.
 *
 * 1 rps politeness (RATE_MS); per-arm in-process caches; never throws.
 */
import { canonGenre } from "../write/schema";

/** The one-row truth shape an MB hit fills. */
export interface MbTruth {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  mbid: string | null;
}

/** The ingest row shape — ingest already knows title/year, so the
 *  projection drops them and adds the artist's top genre tags. */
interface MbIngestRow {
  artist: string | null;
  album: string | null;
  date: string | null;
  artistTags: string;
  mbid: string | null;
}

/** The degraded "no MB truth" ingest row — same shape as a hit, empty. */
const mbIngestMiss = (): MbIngestRow => ({
  artist: null,
  album: null,
  date: null,
  artistTags: "",
  mbid: null,
});

const mbCache = new Map<string, MbTruth | null>();

/** MusicBrainz recording lookup — fills missing artist/album/date (1 rps). */
export async function mbRecording(
  artist: string | null,
  title: string,
): Promise<MbIngestRow> {
  try {
    const rec = (await mbFetchRecordings(artist, title))?.[0];
    if (!rec) return mbIngestMiss();
    const t = recordingToTruth(rec);
    return {
      artist: t.artist,
      album: t.album,
      date: t.date,
      artistTags: t.artistTags,
      mbid: t.mbid,
    };
  } catch {
    // MB fill is one optional hint among many — degrade silently per row
    // (console noise per track would drown the batch summary).
    return mbIngestMiss();
  }
}

/** Cached MusicBrainz recording lookup (artist + title → one truth row or
 *  null). Results (including verified misses) are memoized for the process
 *  lifetime; requests are rate-limited to ~1 rps so the public MB API stays
 *  happy. Failures degrade to null but are logged, never swallowed — MB
 *  fill is one optional hint among many (filename + SC tags come first). */
export async function mbLookupCached(
  artist: string | null,
  title: string,
): Promise<MbTruth | null> {
  const key = `${artist ?? ""}::${title.toLowerCase()}`;
  if (mbCache.has(key)) return mbCache.get(key) ?? null;
  let out: MbTruth | null = null;
  try {
    const rec = (await mbFetchRecordings(artist, title))?.[0];
    if (rec) out = recordingToTruth(rec);
  } catch (e) {
    console.error(`MusicBrainz lookup failed for ${key}`, e);
  }
  mbCache.set(key, out);
  await rateLimit();
  return out;
}

/** One MB search-response recording row (only the fields we read). */
interface MbRecording {
  title?: string;
  id?: string;
  "artist-credit"?: {
    name?: string;
    artist?: { name?: string; tags?: { name: string; count: number }[] };
  }[];
  releases?: { title?: string; date?: string }[];
}

/** MB hard limit 1 rps — stay over it. */
const RATE_MS = 1050;
let lastCall = 0;

/** THE shared politeness seam: trailing-edge sleep to RATE_MS after the
 *  last MB request. Both arms call it (the recording cached path used to
 *  sleep inline — same math, now one seam). */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = lastCall + RATE_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Bound every MB request — a dead connection must never stall a batch
 *  pass (the drift this seam closes: only one twin used to bound it). */
const MB_TIMEOUT_MS = 8_000;

/** Guarded MB search-response boundary: malformed JSON on a 200 is a
 *  protocol violation and THROWS with context (each caller's catch keeps
 *  its own logging policy) — it can never become a silent false answer. */
function parseMbResponse(raw: string): { recordings?: MbRecording[] } {
  try {
    return JSON.parse(raw) as { recordings?: MbRecording[] };
  } catch (error) {
    throw new Error("MusicBrainz search returned malformed JSON", {
      cause: error,
    });
  }
}

/** THE MB wire seam (issue #99): query encoding, UA, fetch, 8 s timeout,
 *  not-ok degrade, guarded parse. Null = "MB answered: nothing usable"
 *  (HTTP error page); network failures and malformed bodies THROW so each
 *  caller's catch keeps its own logging policy (per-row silence vs
 *  pipeline log). */
async function mbFetchRecordings(
  artist: string | null,
  title: string,
): Promise<MbRecording[] | null> {
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  const res = await fetch(
    `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`,
    {
      headers: {
        "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
      },
      signal: AbortSignal.timeout(MB_TIMEOUT_MS),
    },
  );
  if (!res.ok) return null;
  return parseMbResponse(await res.text()).recordings ?? null;
}

/** The one wire parse: recording row → truth row (+ the ingest-only
 *  date/artistTags projections). Previously assembled twice with drift. */
function recordingToTruth(
  rec: MbRecording,
): MbTruth & { date: string | null; artistTags: string } {
  const first = rec.releases?.[0];
  const credit = rec["artist-credit"]?.[0];
  const date = first?.date ?? null;
  const yearNum = date ? Number(date.match(/\d\d\d\d/)?.[0]) : NaN;
  const tags = (credit?.artist?.tags ?? [])
    .toSorted((a, b) => b.count - a.count)
    .map((t) => t.name)
    .slice(0, 3);
  return {
    title: rec.title ?? null,
    artist: credit?.artist?.name ?? credit?.name ?? null,
    album: first?.title ?? null,
    year: Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : null,
    mbid: rec.id ?? null,
    date,
    artistTags: tags.join(","),
  };
}

// ---- folksonomy genre harvest (folded from mb.ts) ----

interface MbArtistSearch {
  artists?: {
    name?: string;
    tags?: { name: string; count: number }[];
  }[];
}

const artistCache = new Map<string, string | null>();

/** Artist → canonical genre via MB folksonomy tags. Null on miss/error. */
export async function mbGenreForArtist(
  artist: string,
): Promise<string | null> {
  const key = artist.toLowerCase().trim();
  if (artistCache.has(key)) return artistCache.get(key) ?? null;
  await rateLimit();
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(`"${artist}"`)}&fmt=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
      },
      signal: AbortSignal.timeout(MB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MbArtistSearch;
    const a = data.artists?.[0];
    if (!a) {
      artistCache.set(key, null);
      return null;
    }
    // Folksonomy: highest-count tag wins through the canonical map.
    const tags = [...(a.tags ?? [])].toSorted((x, y) => y.count - x.count);
    const raw = tags.map((t) => t.name).join(" ");
    const genre = canonGenre(raw) ?? null;
    artistCache.set(key, genre);
    return genre;
  } catch {
    return null;
  }
}

/** Reset the in-process cache (tests). */
export function mbGenreCacheReset(): void {
  artistCache.clear();
}
