/**
 * FullTags metadata builder — turns a yt-dlp info object into a complete
 * EnrichedMetadata record. Migrated from src/metadata.ts (the yt-dlp +
 * description-credits + genre-inference pass).
 */
import { guessFromFreeText } from "../genre/genre-vocab";
import type { EnrichedMetadata } from "./schema";

export interface YtdlpInfo {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  categories?: string[];
  channel?: string;
  uploader?: string;
  release_year?: number;
  release_date?: string;
  upload_date?: string;
  description?: string;
  webpage_url?: string;
  duration?: number;
  ext?: string;
  /** SC payloads (measured Sep 19): uploader = artist name, timestamp =
   *  epoch upload date, genre/release_date are ABSENT. The SC arm maps
   *  these onto the YT-shaped fields instead of teaching every consumer
   *  a second shape (#258). */
  timestamp?: number;
  /** yt-dlp's chosen format id (SC: hls_* ids; YT: numeric). The
   *  Downloader reads it to pick source-aware extraction flags. */
  format_id?: string;
}

/** Split an SC-style "Artist - Track" title into its two halves (pure).
 *  Splits on the FIRST " - " (feats/mixes use " - " inside the track
 *  half, and multi-artist lead-ins use "," / "&" / "+", so the first
 *  boundary is the artist↔title one). Null when no separator or when
 *  either half would be trivially short — "AC/DC - TNT" has no ASCII
 *  " - " and stays whole. #275: the download-time identity seam. */
export function splitArtistFromTitle(
  title: string | undefined | null,
): { artist: string; track: string } | null {
  if (typeof title !== "string") return null;
  const idx = title.indexOf(" - ");
  if (idx <= 0 || idx + 3 >= title.length) return null;
  const artist = title.slice(0, idx).trim();
  const track = title.slice(idx + 3).trim();
  if (artist.length < 2 || track.length < 2) return null;
  return { artist, track };
}

/** Map the SC payload shape onto the YT-shaped YtdlpInfo (pure).
 *  uploader→artist (when artist is absent), timestamp→upload_date
 *  (YYYYMMDD string, buildMetadata's native form). Idempotent.
 *
 *  #275 (Sep 19): SC "uploader" is the CHANNEL, not the track artist —
 *  label/imprint pages ("Experts Only", "Big Joy Records") upload other
 *  artists' tracks, and the rip then tagged the channel as artist. The
 *  fetch ladder's BP identity stage artist-gates against that wrong
 *  artist and refuses correct hits, so label/genre enrichment died
 *  downstream too. SC titles are conventionally "Artist - Track" (measured
 *  on all 17 paro rips), so when the title carries that split AND the
 *  uploader looks like an imprint rather than the track artist, the
 *  title-derived artist wins and the original title is preserved. A
 *  title with no split keeps uploader→artist (single-artist channels
 *  naming tracks plainly still resolve). */
export function scInfoToYtdlpInfo(info: YtdlpInfo): YtdlpInfo {
  if (
    info.artist === undefined &&
    typeof info.uploader === "string" &&
    info.uploader.length > 0
  ) {
    const split = splitArtistFromTitle(info.title);
    const uploader = info.uploader.toLowerCase();
    const titleArtist = split?.artist.toLowerCase() ?? null;
    // Trust the title's artist unless the uploader IS that artist (the
    // common self-upload case) — then uploader→artist is already right.
    const artist =
      split && titleArtist !== uploader ? split.artist : info.uploader;
    info = { ...info, artist };
  }
  if (
    info.upload_date === undefined &&
    Number.isFinite(info.timestamp) &&
    (info.timestamp ?? 0) > 0
  ) {
    const d = new Date((info.timestamp ?? 0) * 1000);
    info = {
      ...info,
      upload_date: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`,
    };
  }
  return info;
}

/** Extract "Producer: X" style credits from a YouTube description. */
export function extractComposer(
  description: string | null | undefined,
): string | null {
  if (!description) return null;
  const lines = description.split(/\r?\n/).map((l) => l.trim());
  const producers: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(?:Producer|Produced by|Prod\.? by)[:\s]+(.+)$/i);
    if (m?.[1]) producers.push(m[1].trim());
  }
  if (producers.length === 0) return null;
  // Dedupe and cap; rekordbox composer column has room but not infinite.
  return [...new Set(producers)].slice(0, 3).join(", ");
}

/** Clean a YouTube video title into a plausible track title. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .replace(/\(Official (?:Audio|Video|Music Video|Lyric Video)\)/gi, "")
    .replace(/\[Official (?:Audio|Video|Music Video|Lyric Video)\]/gi, "")
    .replace(/\(Official\)/gi, "")
    .replace(/\((?:Lyric[s]?|Audio|Video)\)/gi, "")
    .replace(/\[(?:Lyric[s]?|Audio|Video)\]/gi, "")
    .replace(/\(feat\. /gi, "(ft. ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A genre is a short label — not a URL ("https://djsoundtop.com"), not
 *  a scraped JSON blob (a thumbnails array once rode into `genre`), not
 *  tag-soup with control bytes. Those minted garbage genre FOLDERS on
 *  organize; null is the honest value and lands them in the one
 *  recoverable bucket. Module scope: pure, no closures (lint). */
function plausibleGenre(candidate: string): boolean {
  if (/https?:\/\//i.test(candidate)) return false;
  if (candidate.startsWith("[") || candidate.startsWith("{")) return false;
  if (candidate.length > 60) return false;
  // eslint-disable-next-line no-control-regex -- control bytes are exactly the junk being guarded
  if (/[\u0000-\u001f]/.test(candidate)) return false;
  return true;
}

export function buildMetadata(info: YtdlpInfo): EnrichedMetadata {
  const title = cleanTitle(info.title) ?? info.title ?? null;
  const artist = info.artist?.trim() || null;
  // #275: "<uploader> - Unknown Album" placeholders are a LIE the writer
  // minted when album was unknown — an honest unknown beats a lying
  // placeholder (repo rule). Strip the pattern wherever it rode in.
  const rawAlbum = info.album?.trim() || null;
  const album =
    rawAlbum !== null && /- Unknown Album$/i.test(rawAlbum) ? null : rawAlbum;
  const date =
    info.release_date ||
    (info.release_year ? String(info.release_year) : null) ||
    info.upload_date ||
    null;
  const composer = extractComposer(description_credits(info.description));
  // Honest gap, never a guess (repo rule): when nothing infers, genre stays
  // null for `fetch` to fill later. The old `?? "Music"` minted placeholder
  // rows invisible to genreSeeds AND inference (#61). A non-"Music" raw
  // genre from yt-dlp passes through untouched — the regex table can miss
  // real genres ("Kuduro"), and replacing them with "Music" was strictly
  // worse than keeping them. The junk guard (Sep 19 organize audit) sits
  // in front: URLs / JSON blobs / control-byte soup are NOT genres —
  // they minted garbage genre FOLDERS on organize; null is honest.
  const rawGenre =
    info.genre &&
    info.genre.toLowerCase() !== "music" &&
    plausibleGenre(info.genre)
      ? info.genre
      : null;
  // A junk `genre` is also poisoned as an INFERENCE INPUT (the \u0000 blob
  // still regex-matched "house" and minted a folder via the guess path) —
  // only plausible genre text may feed the guesser.
  const genre =
    guessFromFreeText([rawGenre, info.artist, info.album, info.title]) ??
    rawGenre;
  // #275: SC descriptions name the real album surprisingly often
  // ("from the upcoming album "Buds" by …" — measured on Surf Curse).
  // A quoted album mention recovers what yt-dlp leaves absent; the
  // mention must be plausible-length to avoid CSS/JSON soup.
  const descAlbum = album ?? descriptionAlbum(info.description);
  const albumArtist = artist && descAlbum ? artist : null;

  return {
    title,
    artist,
    albumArtist,
    album: descAlbum,
    genre,
    date: date?.slice(0, 4) ?? null,
    composer,
    comment: info.webpage_url ?? null,
    bpm: null, // analysis happens in rekordbox itself
  };
}

/** #275: pull an album name out of an SC description — the first
 *  quoted-or-… album-style mention of form: [album|ep|lp|single]
 *  ["Name"] (case-insensitive). Null when nothing matches; the caller
 *  keeps null as the honest unknown. */
export function descriptionAlbum(
  description: string | null | undefined,
): string | null {
  if (typeof description !== "string" || description.length === 0) return null;
  const m = description.match(/(?:album|ep|lp)\s*[“"']([^“”"']{2,60})[”"']/i);
  return m?.[1]?.trim() ?? null;
}

/** Pass-through (kept for API symmetry with the original code). */
function description_credits(d?: string): string | undefined {
  return d;
}
