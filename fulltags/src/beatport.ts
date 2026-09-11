/**
 * FullTags Beatport source — the DJ-canonical metadata vote, ranked second
 * in every ladder behind SoundCloud (roadmap rev 6.4 decision):
 *
 *   Beatport's catalog is the DJ reference for label / mix name / remixers
 *   / BPM / Camelot key / genre / official release art — the exact fields
 *   no other source in the ladders carries with store-grade authority
 *   (SC has none of them except genre/year; MB rarely covers store
 *   metadata; Deezer/iTunes carry no DJ fields).
 *
 * Access: the v4 catalog API with the client-credentials flow the official
 * web embed player ships in its public JS bundle (client_id + secret +
 * grant_type=client_credentials → POST account.beatport.com/o/token/) —
 * no user account, no scraping, no Cloudflare-protected HTML. The public
 * api.beatport.com/v4 surface is OAuth-gated for third-party apps; this
 * anonymous client-credentials grant is the same one every visitor's
 * browser runs, so it is treated as a public read API. The catalog
 * responses ARE the paid product's metadata — every field written from
 * Beatport is stamped with its provenance (TXXX:BP-*), never silently
 * blended into a human tag.
 *
 * Hygiene: in-process token cache with early-expiry refresh (60 s skew),
 * per-process search memoization (misses included), never throws (a
 * Beatport outage degrades the ladders to the next rung, logged at the
 * boundary). Test seam: `beatportSearchImpl` / `beatportTokenImpl` are
 * swappable so offline tests pin the scoring/gating logic; the seam
 * resets to the real impls.
 */
import { canonGenre, SC_GENRE_CANON } from "./schema";

// ---------- token (client-credentials, embed-player parity) ----------

/** The embed player's public OAuth client (fetched from its own public JS
 * bundle — account.beatport.com/o/token/ accepts it with client_credentials
 * and no user interaction). */
const BP_CLIENT_ID = "2tiTbKxmQFwnbFjMONU4k7njMRZmV3ZMwRBndiZs";
const BP_CLIENT_SECRET =
  "RDUJyAk4zFEGtQ8rsTmylDSfxmALRNBn3D1BsRr7MKi3oa1TL9Mq9QxqUPK7loiumXolEWbJcWa4IGAhtwnTz1cSXClGJ1tkkNCNWwRwjxIKTZJKOJxbwaNt0Rm3WG0v";
const TOKEN_URL = "https://account.beatport.com/o/token/";
const SEARCH_URL = "https://api.beatport.com/v4/catalog/search/";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Invalidate the cached token (tests + 401 recovery). */
export function beatportTokenReset(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/** A fresh bearer token; null when the flow fails (logged, never throws). */
export async function beatportToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: BP_CLIENT_ID,
        client_secret: BP_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`beatport token → HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as TokenResponse;
    if (!data.access_token) {
      console.error("beatport token → no access_token in response");
      return null;
    }
    cachedToken = data.access_token;
    // Refresh 60 s before expiry (the embed player's own skew).
    tokenExpiresAt =
      Date.now() + Math.max(30, (data.expires_in ?? 3600) - 60) * 1000;
    return cachedToken;
  } catch (e) {
    console.error("beatport token failed", e);
    return null;
  }
}

// ---------- catalog search ----------

/** One Beatport catalog track row — only the fields we read. */
export interface BpTrack {
  id: number;
  name: string;
  mixName: string | null;
  artists: string[];
  remixers: string[];
  /** Store genre ("Techno", "Progressive House") — canonicalized on write. */
  genre: string | null;
  /** Store subgenre ("Peak Time / Driving") — folded into the genre blob. */
  subGenre: string | null;
  label: string | null;
  release: string | null;
  bpm: number | null;
  /** Camelot position + traditional name ("F Minor") when the row carries it. */
  camelot: string | null;
  keyName: string | null;
  year: number | null;
  /** Official release art, largest resolution ({w}x{h} template filled). */
  artUrl: string | null;
  lengthMs: number | null;
  isrc: string | null;
  catalogNumber: string | null;
  /** Canonical track page URL — the provenance stamp value. */
  url: string | null;
}

interface BpArtist {
  name?: string;
}

interface BpImage {
  dynamic_uri?: string;
  uri?: string;
}

interface BpRaw {
  id?: number;
  name?: string;
  mix_name?: string;
  artists?: BpArtist[];
  remixers?: BpArtist[];
  genre?: { name?: string } | null;
  sub_genre?: { name?: string } | null;
  label?: { name?: string } | null;
  release?: { name?: string; label?: { name?: string } } | null;
  bpm?: number;
  publish_date?: string;
  length_ms?: number;
  isrc?: string;
  catalog_number?: string;
  slug?: string;
  key?: {
    camelot_number?: number;
    camelot_letter?: string;
    letter?: string;
    name?: string;
    chord_type?: { name?: string };
  } | null;
  image?: BpImage | null;
  release_image?: BpImage | null;
}

/** Fill the {w}x{h} template (or upgrade a fixed size) to the square 1500
 * master — verified against geo-media.beatport.com: template + fixed URIs
 * both serve it. */
function artUrlFrom(
  img: BpImage | null | undefined,
  releaseImg: BpImage | null | undefined,
): string | null {
  const raw =
    img?.dynamic_uri ??
    img?.uri ??
    releaseImg?.dynamic_uri ??
    releaseImg?.uri ??
    null;
  if (!raw) return null;
  if (raw.includes("{w}x{h}")) return raw.replace("{w}x{h}", "1500x1500");
  return raw.replace(/\/image_size\/\d+x\d+\//, "/image_size/1500x1500/");
}

/** Artist-name extractor — module-level (oxlint consistent-function-scoping). */
const artistNames = (list?: BpArtist[]): string[] =>
  (list ?? []).map((a) => a.name ?? "").filter((n) => n.trim().length > 0);

/** Parse one raw catalog row into BpTrack. Undefined numeric/string holes
 * degrade to nulls — the scoring layer decides whether the row is usable. */
function parseTrack(raw: BpRaw): BpTrack | null {
  const id = raw.id;
  if (typeof id !== "number") return null;
  const yearNum = raw.publish_date
    ? Number(raw.publish_date.match(/\d{4}/)?.[0])
    : NaN;
  const kn = raw.key ?? undefined;
  const camelotNum = kn?.camelot_number;
  const camelotLetter = kn?.camelot_letter;
  const camelot =
    typeof camelotNum === "number" &&
    (camelotLetter === "A" || camelotLetter === "B")
      ? `${camelotNum}${camelotLetter}`
      : null;
  const keyName =
    kn?.name ??
    (kn?.letter && kn?.chord_type?.name
      ? `${kn.letter} ${kn.chord_type.name}`
      : undefined);
  return {
    id,
    name: raw.name ?? "",
    mixName: raw.mix_name ?? null,
    artists: artistNames(raw.artists),
    remixers: artistNames(raw.remixers),
    genre: raw.genre?.name ?? null,
    subGenre: raw.sub_genre?.name ?? null,
    label: raw.label?.name ?? raw.release?.label?.name ?? null,
    release: raw.release?.name ?? null,
    bpm: typeof raw.bpm === "number" && raw.bpm > 0 ? raw.bpm : null,
    camelot,
    keyName: keyName ?? null,
    year:
      Number.isInteger(yearNum) && yearNum > 1900 && yearNum < 2100
        ? yearNum
        : null,
    artUrl: artUrlFrom(raw.image, raw.release_image),
    lengthMs: typeof raw.length_ms === "number" ? raw.length_ms : null,
    isrc: raw.isrc ?? null,
    catalogNumber: raw.catalog_number ?? null,
    url: raw.slug
      ? `https://www.beatport.com/track/${raw.slug}/${id}`
      : `https://www.beatport.com/track/${id}`,
  };
}

/** Resolve the anonymous bearer token then run one catalog search. Swapped
 * wholesale in tests (beatportSearchImpl). */
async function searchViaApi(
  query: string,
  perPage: number,
): Promise<BpTrack[]> {
  const token = await beatportToken();
  if (!token) return [];
  const res = await fetch(
    `${SEARCH_URL}?q=${encodeURIComponent(query)}&type=tracks&per_page=${perPage}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (res.status === 401) {
    // Token expired/revoked mid-life: drop the cache once and let the next
    // call re-auth (the ladder degrades gracefully meanwhile).
    beatportTokenReset();
    console.error("beatport search → HTTP 401 (token cache dropped)");
    return [];
  }
  if (!res.ok) {
    console.error(`beatport search → HTTP ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { tracks?: BpRaw[] };
  const out: BpTrack[] = [];
  for (const raw of data.tracks ?? []) {
    const t = parseTrack(raw);
    if (t) out.push(t);
  }
  return out;
}

async function realSearch(query: string, perPage: number): Promise<BpTrack[]> {
  return searchViaApi(query, perPage);
}

/** Test seam: the search implementation (offline tests swap this). */
export let beatportSearchImpl: (
  query: string,
  perPage: number,
) => Promise<BpTrack[]> = realSearch;

/** Install a test search impl; returns the restore function. */
export function setBeatportSearchImpl(
  impl: (query: string, perPage: number) => Promise<BpTrack[]>,
): () => void {
  const prev = beatportSearchImpl;
  beatportSearchImpl = impl;
  return () => {
    beatportSearchImpl = prev;
  };
}

/** Same cleanup discipline as cleanQuery in art-sources (which we mirror):
 * strip bracketed/parenthesized annotations and version noise so
 * "Artist - Track (Flozone Flip)" searches as "Artist Track". */
function cleanQuery(r: BpQuery): string {
  const artist0 = (r.artist ?? "").split(/[,&]/)[0]?.trim() ?? "";
  const t = r.title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(final|mstr|master|vip|full|cdq|extended|radio edit|feat\.?|ft\.?)\b/gi,
      " ",
    )
    .replace(/\b\d+(\.\d+)+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${t}`.split(" ").filter(Boolean).slice(0, 8).join(" ");
}

export interface BpQuery {
  artist: string | null;
  title: string;
  /** Optional duration hint (seconds) — within ±10 s is a strong signal. */
  durationS?: number | undefined;
}

// ---------- scoring (relevance gate: which row is THIS track) ----------

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Same shared-token similarity the dupe hunter trusts (independent
 * normalization here: the dedupe module's is over filenames). */
function titleOverlap(a: string, b: string): number {
  const aw = new Set(words(a));
  const bw = new Set(words(b));
  if (aw.size === 0 || bw.size === 0) return 0;
  let shared = 0;
  for (const w of aw) if (bw.has(w)) shared++;
  return shared / Math.max(aw.size, bw.size);
}

/** Score one row against the query (higher = better). Components:
 *  artist full-match 6 / prefix-match 4, title overlap ×4, mix name ×2,
 *  duration within ±10 s +2 (±2 s +3). HARD GATE: a known query artist
 *  with no artist match on the row scores 0 outright — the store's
 *  long-tail is full of same-name covers/pack-fillers by unrelated
 *  artists ("Nestle" by three dog-music channels), and title+duration
 *  alone cannot tell them apart. */
export function scoreBpHit(t: BpTrack, q: BpQuery): number {
  const artist0 = (q.artist ?? "").split(/[,&]/)[0]?.trim().toLowerCase() ?? "";
  let score = 0;
  if (artist0.length > 2) {
    const hitArtist = t.artists
      .map((a) => a.toLowerCase())
      .find((a) => a === artist0 || a.includes(artist0));
    if (!hitArtist) return 0; // unrelated artist → never this track
    score += hitArtist === artist0 ? 6 : 4;
  }
  score += titleOverlap(q.title, t.name) * 4;
  if (
    t.mixName &&
    words(q.title).some((w) => t.mixName!.toLowerCase().includes(w))
  )
    score += 2;
  if (
    q.durationS !== undefined &&
    t.lengthMs !== null &&
    Math.abs(t.lengthMs / 1000 - q.durationS) <= 10
  ) {
    score += Math.abs(t.lengthMs / 1000 - q.durationS) <= 2 ? 3 : 2;
  }
  return score;
}

/** Relevance floor — below this the row is a different track wearing the
 * same name (the "Music for Pets" class of hit). The SC search runs the
 * same guard at overlap ≥ 1. */
export const BP_MIN_SCORE = 4;

/** Cached search: artist+title → scored hits or null (no credible hit).
 * Memoized for the process lifetime (misses included) so batch runs and
 * re-runs don't re-hit the catalog for the same file. */
const searchCache = new Map<string, BpTrack | null>();

/** Beatport lookup for one track: cleaned query, scored, floor-gated.
 * Returns the best row or null. Never throws. */
export async function beatportLookup(q: BpQuery): Promise<BpTrack | null> {
  const key = `${(q.artist ?? "").toLowerCase()}::${q.title.toLowerCase()}::${q.durationS ?? ""}`;
  if (searchCache.has(key)) return searchCache.get(key) ?? null;
  const query = cleanQuery(q);
  let best: BpTrack | null = null;
  if (query) {
    try {
      const hits = await beatportSearchImpl(query, 5);
      let bestScore = 0;
      for (const t of hits) {
        const s = scoreBpHit(t, q);
        if (s > bestScore) {
          bestScore = s;
          best = t;
        }
      }
      if (best && bestScore < BP_MIN_SCORE) best = null;
    } catch (e) {
      // Search failure must never fail the pipeline — log at the boundary
      // and degrade to the next ladder rung.
      console.error(`beatport search failed for "${query}"`, e);
      best = null;
    }
  }
  searchCache.set(key, best);
  return best;
}

/** Reset the search memoization (tests). */
export function beatportLookupCacheReset(): void {
  searchCache.clear();
}

// ---------- art ----------

/** Fetch the row's official release art at the 1500×1500 master. Null on
 * any failure (the ladder continues below). */
export async function beatportArt(t: BpTrack): Promise<Uint8Array | null> {
  if (!t.artUrl) return null;
  const { fetchImage } = await import("./art-sources");
  return fetchImage(t.artUrl);
}

// ---------- provenance stamps ----------

/** "field=value; field=value" provenance payload for one filled field —
 * mirrors the AI "value|confidence" discipline: a Beatport-filled value is
 * always identifiable. Returns the TXXX value or null when nothing to
 * record (null fields never stamp). */
export function bpStamp(
  fields: Array<[string, string | number | null]>,
): string | null {
  const parts = fields
    .filter((pair): pair is [string, string | number] => {
      const v = pair[1];
      return v !== null && String(v).trim().length > 0;
    })
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? parts.join("; ") : null;
}

/** The canonical genre vote: Beatport store genre + subgenre through the
 * shared canon map; null when nothing maps. Membership is checked against
 * the canon VALUES (canonGenre titlecases unknown raw strings — accepting
 * its output verbatim would let "Electronica" through as "Electronica").
 * Store genre strings come compound ("Techno (Peak Time / Driving)",
 * "Melodic House & Techno"): candidates are tried subgenre → genre,
 * each also with the parenthetical stripped and split on "&"/"/" — every
 * candidate must land ON a canon value to be accepted. */
export function bpGenre(t: BpTrack): string | null {
  // Derived, never hand-maintained: the vocabulary lives in the canon map.
  const vocab = new Set(Object.values(SC_GENRE_CANON));
  const tryMap = (raw: string | null): string | null => {
    if (!raw) return null;
    const canon = canonGenre(raw);
    if (vocab.has(canon)) return canon;
    // Compound store forms: strip " (...)" annotations, then try each
    // "&"-/"/"-separated segment on its own.
    const stripped = raw.replace(/\s*\([^)]*\)/g, "").trim();
    if (stripped && stripped !== raw && vocab.has(canonGenre(stripped)))
      return canonGenre(stripped);
    for (const seg of stripped.split(/\s*[&/]\s*/)) {
      if (!seg.trim()) continue;
      const segCanon = canonGenre(seg);
      if (vocab.has(segCanon)) return segCanon;
    }
    return null;
  };
  return tryMap(t.subGenre) ?? tryMap(t.genre);
}

/** Reset every in-process cache (tests). */
export function beatportReset(): void {
  beatportTokenReset();
  beatportLookupCacheReset();
}
