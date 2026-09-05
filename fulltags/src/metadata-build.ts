/**
 * FullTags metadata builder — turns a yt-dlp info object into a complete
 * EnrichedMetadata record. Migrated from src/metadata.ts (the yt-dlp +
 * description-credits + genre-inference pass).
 */
import type { EnrichedMetadata } from "./schema";
import { inferGenre } from "./schema";

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

export function buildMetadata(info: YtdlpInfo): EnrichedMetadata {
  const title = cleanTitle(info.title) ?? info.title ?? null;
  const artist = info.artist?.trim() || null;
  const album = info.album?.trim() || null;
  const date =
    info.release_date ||
    (info.release_year ? String(info.release_year) : null) ||
    info.upload_date ||
    null;
  const composer = extractComposer(description_credits(info.description));
  const genre =
    inferGenre([info.genre, info.artist, info.album, info.title]) ?? "Music";
  const albumArtist = artist && album ? artist : null;

  return {
    title,
    artist,
    albumArtist,
    album,
    genre,
    date: date?.slice(0, 4) ?? null,
    composer,
    comment: info.webpage_url ?? null,
    bpm: null, // analysis happens in rekordbox itself
  };
}

/** Pass-through (kept for API symmetry with the original code). */
function description_credits(d?: string): string | undefined {
  return d;
}
