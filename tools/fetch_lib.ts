/**
 * fetch_lib — megadj archive-side plumbing, now backed by FullTags.
 *
 * FullTags (fulltags/) owns the format logic: ground-truth reads, tag
 * writes, artwork sources, SC search, genre canon. What stays here is the
 * archive-specific state: the SQLite DB, archive paths, the queue file, and
 * the Row/TagValues shapes the DB pipeline speaks.
 */
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import {
  embedArt as ftEmbedArt,
  fetchImage as ftFetchImage,
  groundTruth as ftGroundTruth,
  validatePatch,
  writePatchSync,
  canonGenre as ftCanonGenre,
  type TagPatch,
} from "../fulltags/src/exports";

export const home = process.env.HOME!;
export const ARCH = process.env.MEGADJ_MUSIC_DIR ?? `${home}/Music/DJ-Imports`;
export const QUEUE = `${home}/.local/state/megadj/artwork-queue.jsonl`;
export const db = new Database(`${home}/.local/state/megadj/archive.db`);

export interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  file_path: string;
  format_id: string | null;
}

export function archiveFiles(): Set<string> {
  return new Set(
    readdirSync(ARCH).filter(
      (f) => !f.startsWith(".") && /\.(wav|mp3|m4a|flac|aiff)$/i.test(f),
    ),
  );
}

export interface Truth {
  art: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
}

/** Ground-truth file read — FullTags readers (WAV/MP3 via mutagen). */
export function groundTruth(p: string): Truth {
  return ftGroundTruth(p);
}

export async function fetchImage(url: string): Promise<Uint8Array | null> {
  return ftFetchImage(url);
}

export { ftCanonGenre as canonGenre };

/** Embed art bytes as the front cover — FullTags writer. */
export function embedArt(p: string, bytes: Uint8Array): boolean {
  return ftEmbedArt(p, bytes);
}

/** Tag fields the archive DB pipeline manages. `year` = release year of
 * THIS file's version (remixes: the remix year, NOT the original's).
 * `aiGenre`/`aiYear` are provenance stamps "value|confidence" (0–1) written
 * as TXXX:AI-GENRE / TXXX:AI-YEAR so AI-filled fields are always visible. */
export interface TagValues {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  comment?: string;
  aiGenre?: string;
  aiYear?: string;
}

/** Same rules as FullTags TagPatch (this shape is a subset). */
export function validateTagValues(vals: TagValues): void {
  validatePatch(vals as TagPatch);
}

/** Write DB-driven tag values into the file (atomic, stream-copied).
 * FullTags `writePatchSync` — direct in-process write, no promise bridge
 * (the nested-`bun -e` bridge measured 6.4× slower; see writer.ts). */
export function setFileTags(p: string, vals: TagValues): boolean {
  validateTagValues(vals);
  return writePatchSync(p, vals as TagPatch);
}

// ---------- SoundCloud search + art sources (FullTags re-exports) ----------
export {
  deezerArt,
  fetchBestScArt,
  gatewayArt,
  itunesArtwork,
  pageOgImage,
  scSearch,
  twinArt,
} from "../fulltags/src/exports";
