// sc-search.ts — the SoundCloud search family (#89/#90 diet extraction
// from art-sources.ts): the yt-dlp `COL|` spawner, the line scorer with
// its hard artist gate, and the ScHit model. Feeds genre + art + year in
// one call. Junk gates live here; the write gates stay at the consumers.
import {
  cleanSearchParts,
  cleanSearchQuery,
  type SearchQueryParts,
} from "./search-query";
import { nameTokens, primaryArtist } from "./name-match";

// ---------- SoundCloud search (feeds genre + art + year in one call) ----------
export interface ScHit {
  url: string;
  title: string;
  uploader: string | null;
  thumb: string | null;
  genre?: string | null;
  /** SC upload year — for edits/remixes this is the remix year */
  year?: number | null;
  score: number;
}

export interface SearchRow {
  artist: string | null;
  title: string;
  file_path: string;
}

/** Junk prefix stripper for search inputs: "UnknownArtist · UnknownAlbum ·
 *  Tvardovsky - Depths" must search as "Tvardovsky - Depths" (Sep 11: the
 *  composed junk prefix poisoned every SC query and the uploader scorer —
 *  13 tracks matched loose junk and embedded one shared pool banner). */
export function scSearch(r: SearchRow): ScHit[] {
  return scSearchImpl(r);
}

/** Artist gate floor — the shared name-match SSOT (name-match.ts);
 *  Beatport's BP_ARTIST_MIN_LEN aliases the same value. Kept exported
 *  here for the SC tests/importers. */
export const SC_ARTIST_MIN_LEN = 3;

/** Parsed raw yt-dlp `COL|` line — the REAL verified layout:
 *  title|url|uploader|thumbs|genre|timestamp = 6 fields. (The old
 *  destructure expected 7: a phantom slot after uploader shifted every
 *  field one left, so thumbs got the genre, genre got the numeric
 *  timestamp — always refused — and tsRaw was always undefined. One
 *  misaligned tuple silently disabled three fields.) */
interface ColLine {
  title: string;
  url: string;
  uploader: string | null;
  thumbsRaw: string | undefined;
  genre: string | undefined;
  timestamp: string | undefined;
}

/** Parse one `COL|` line, or null for junk lines, other hosts, short tuples. */
function parseColLine(line: string): ColLine | null {
  if (!line.startsWith("COL|")) return null;
  const parts = line.slice(4).split("|");
  if (parts.length < 6) return null;
  const [t, url, uploader, thumbsRaw, genre, tsRaw] = parts as [
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
  ];
  if (!url?.includes("soundcloud.com")) return null;
  return {
    title: t ?? "",
    url,
    uploader: uploader || null,
    thumbsRaw,
    genre,
    timestamp: tsRaw,
  };
}

/** SC upload year from the unix timestamp = the remix/edit's year (not
 *  the original's). Outside 2000..2100 → undefined. */
function scYear(tsRaw: string | undefined): number | undefined {
  const ts = Number(tsRaw?.trim());
  return Number.isFinite(ts) &&
    ts > 946_684_800 && // 2000-01-01 UTC
    ts < 4_102_444_800 // 2100-01-01 UTC
    ? new Date(ts * 1000).getUTCFullYear()
    : undefined;
}

/** Score one parsed line against the query terms. Returns null when a
 *  gate drops the hit (relevance, hard artist gate). */
function scoreColLine(
  line: ColLine,
  tWords: string[],
  artist0: string,
  gateActive: boolean,
): ScHit | null {
  const hWords = nameTokens(line.title);
  const overlap = tWords.filter((w) => hWords.includes(w)).length;
  if (overlap < 1) return null; // relevance gate
  const up = (line.uploader ?? "").toLowerCase();
  const uploaderOK = artist0 !== "" && up.includes(artist0.slice(0, 8));
  // HARD GATE: known artist, non-matching uploader → not this track.
  if (gateActive && !uploaderOK) return null;
  const year = scYear(line.timestamp);
  return {
    url: line.url,
    title: line.title,
    uploader: line.uploader,
    thumb:
      line.thumbsRaw?.match(
        /https:\/\/i1\.sndcdn\.com\/artworks[^\s',]+t500x500\.jpg/,
      )?.[0] ?? null,
    // SC flat-search `genre` is a numeric SoundCloud genre ID, not a name
    // (when present at all). Numeric junk must never leave this function —
    // Sep 11: numeric "genres" got written to files + DBs and took hours
    // to purge. Non-numeric names pass through untouched.
    ...(line.genre && line.genre !== "NA" && !/^\d+$/.test(line.genre)
      ? { genre: line.genre }
      : {}),
    ...(year === undefined ? {} : { year }),
    score: overlap * 2 + (uploaderOK ? 1 : 0),
  };
}

/** Parse + score raw yt-dlp `COL|` lines against a query. Pure (no I/O),
 *  exported for offline tests. HARD ARTIST GATE (Sep 15, mirrors
 *  scoreBpHit's `if (!hitArtist) return 0`): when the query names a real
 *  artist (>= SC_ARTIST_MIN_LEN) and a hit's uploader doesn't match, the
 *  hit is DROPPED entirely — uploader agreement used to be only a +1
 *  score bonus, so a high title-overlap hit from an unrelated uploader
 *  (a "Taylor Swift" query won by a compilation channel's dubstep remix)
 *  could take the [0] slot and write its genre/year. Remixes still pass:
 *  the gate checks the UPLOADER channel — legit remix uploads live on the
 *  remixer's or label's own channel with the original artist in the TRACK
 *  title, which the title-overlap term already credits. */
export function scoreScHits(lines: string[], q: SearchQueryParts): ScHit[] {
  const tWords = nameTokens(q.title);
  const artist0 = primaryArtist(q.artist);
  const gateActive = artist0.length >= SC_ARTIST_MIN_LEN;
  const hits: ScHit[] = [];
  for (const line of lines) {
    const parsed = parseColLine(line);
    if (!parsed) continue;
    const hit = scoreColLine(parsed, tWords, artist0, gateActive);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/** Test seam: swappable SC search implementation so pipeline tests stay
 * offline (the real one shells to yt-dlp). Reset via the restore fn. */
export let scSearchImpl: (r: SearchRow) => ScHit[] = scSearchReal;

/** Install a test SC-search impl; returns the restore function. */
export function setScSearchImpl(impl: (r: SearchRow) => ScHit[]): () => void {
  const prev = scSearchImpl;
  scSearchImpl = impl;
  return () => {
    scSearchImpl = prev;
  };
}

/** The real yt-dlp SC search (sync, spawn + parse). */
function scSearchReal(r: SearchRow): ScHit[] {
  const q = cleanSearchQuery(r);
  if (!q) return [];
  let out = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const pr = Bun.spawnSync({
      cmd: [
        "yt-dlp",
        "--flat-playlist",
        "--print",
        "COL|%(title).60s|%(webpage_url)s|%(uploader)s|%(thumbnails).600s|%(genre)s|%(timestamp)s",
        `scsearch4:${q}`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 45_000,
    });
    out = new TextDecoder().decode(pr.stdout);
    if (out.split("\n").some((l) => l.startsWith("COL|"))) break;
    Bun.sleepSync(1200 * (attempt + 1));
  }
  return scoreScHits(out.split("\n"), cleanSearchParts(r.artist, r.title));
}
