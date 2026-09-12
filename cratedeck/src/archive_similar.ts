// archive_similar.ts — the I49/M66 extensions to ArchiveReader, split out
// of archive.ts (file-length guard). Same readonly ArchiveReader handle,
// same rules: pure reads over megadj's archive DB — a bug here cannot
// corrupt archive state.
//
//   similarTracks — I49 "sounds like": cosine kNN over the embeddings
//                   ledger (written by `megadj mood --embeddings`)
//   setCandidates — M66 set-builder candidate pool (beats + mood + TKEY)
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { groundTruth } from "../../fulltags/src/exports";
import { cosineSimilarity } from "../shared/similarity";
import type { ArchiveQuery } from "./archive_types";

/** Round to 4 decimals for wire payloads. Pure — module-level. */
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/** ExFAT is case-insensitive. Normalize separators, Unicode, and case so two
 * archive rows cannot propose the same physical shelf file twice. */
const physicalPathKey = (path: string): string =>
  resolve(path).normalize("NFC").toLocaleLowerCase("en-US");

/** Resolve a historical ~/Music/DJ-Imports path against the configured shelf
 * Contents root. The archive DB remains untouched; callers receive the live
 * path only when the rebased file actually exists. */
function existingCandidatePath(
  sourcePath: string | null,
  shelfContents?: string,
): { path: string; relocated: boolean } | null {
  if (!sourcePath) return null;
  if (existsSync(sourcePath)) return { path: sourcePath, relocated: false };
  if (!shelfContents) return null;
  const parts = resolve(sourcePath).split(sep);
  const anchor = parts.findIndex(
    (part, index) =>
      part.toLocaleLowerCase("en-US") === "music" &&
      parts[index + 1]?.toLocaleLowerCase("en-US") === "dj-imports",
  );
  if (anchor < 0 || anchor + 2 >= parts.length) return null;
  const rebased = resolve(shelfContents, ...parts.slice(anchor + 2));
  return existsSync(rebased) ? { path: rebased, relocated: true } : null;
}

/**
 * I49 "sounds like": cosine kNN over megadj's `embeddings` ledger
 * (effnet 1280-d mean embeddings, written by `megadj mood
 * --embeddings`). Pure read + TS-side cosine — the doc blesses
 * "blob + cosine at 3–10k tracks". Degrades to available:false when
 * the ledger is empty or the query track has no embedding.
 */
export function similarTracks(
  reader: ArchiveQuery,
  videoId: string,
  k = 10,
): {
  available: boolean;
  video_id: string;
  title: string | null;
  corpus: number;
  hits: {
    video_id: string;
    title: string | null;
    artist: string | null;
    score: number;
  }[];
} {
  const empty = (corpus = 0) => ({
    available: reader.available(),
    video_id: videoId,
    title: null,
    corpus,
    hits: [] as {
      video_id: string;
      title: string | null;
      artist: string | null;
      score: number;
    }[],
  });
  const hasEmbeddings = reader.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'`,
  );
  if (!hasEmbeddings.length) return empty();
  const rows = reader.rows<{
    video_id: string;
    title: string | null;
    artist: string | null;
    vec_json: string;
  }>(
    `SELECT e.video_id, t.title, t.artist, e.vec_json
     FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
     WHERE t.status = 'downloaded'`,
  );
  const corpus: {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
  }[] = [];
  let queryVec: number[] | null = null;
  let queryTitle: string | null = null;
  for (const r of rows) {
    let vec: number[];
    try {
      vec = JSON.parse(r.vec_json) as number[];
    } catch {
      continue; // corrupt row — skip, never poison the ranking
    }
    if (!Array.isArray(vec) || vec.length === 0) continue;
    if (r.video_id === videoId) {
      queryVec = vec;
      queryTitle = r.title;
      continue;
    }
    corpus.push({ videoId: r.video_id, title: r.title, artist: r.artist, vec });
  }
  if (!queryVec) return empty(corpus.length);
  const kk = Math.min(Math.max(k, 1), 50);
  const hits = corpus
    .filter((c) => c.vec.length === queryVec!.length)
    .map((c) => ({
      video_id: c.videoId,
      title: c.title,
      artist: c.artist,
      score: r4(cosineSimilarity(queryVec!, c.vec)),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, kk);
  return {
    available: true,
    video_id: videoId,
    title: queryTitle,
    corpus: corpus.length,
    hits,
  };
}

/**
 * M66 set-builder: load the candidate pool (playable tracks joined with
 * beats + mood ledgers + the cached TKEY ledger). Feeds the pure engine
 * in setbuild.ts. Unparsable keys degrade to null (no key-score), never
 * throw.
 *
 * The source census is the WHOLE downloaded library by default — the old
 * `updated_at DESC LIMIT 300` cap silently hid 200+ analyzed tracks from
 * every proposal (and re-syncing reshuffled which ones). Missing paths are
 * counted but cannot enter a proposal: a stale `downloaded` row is not an
 * actual playable track. Existing files are read only on a valid track_keys
 * cache miss (~80 ms each: ffprobe + mutagen). This request never fills the
 * cache: the entire archive read surface stays physically readonly.
 */
export function setCandidates(
  reader: ArchiveQuery,
  limit?: number,
  shelfContents?: string,
): {
  available: boolean;
  /** Downloaded DB rows inspected, including stale missing paths. */
  sourceTotal: number;
  /** Existing files that can actually enter the proposal. */
  total: number;
  /** Downloaded DB rows rejected because their file is absent. */
  missingFiles: number;
  /** Existing DB rows rejected because another id resolves to that file. */
  duplicateFiles: number;
  /** Unique candidates resolved from a stale DJ-Imports path to the shelf. */
  relocatedFiles: number;
  /** How many candidates needed a live file read for their key (cache
   *  misses) — surfaced so a slow first request is explainable. */
  keyReads: number;
  /** Live key-tag reads that failed; those tracks keep a neutral key score. */
  keyReadFailures: number;
  candidates: {
    videoId: string;
    title: string | null;
    artist: string | null;
    durationS: number | null;
    bpm: number | null;
    key: string | null;
    valence: number | null;
    arousal: number | null;
    dance: number | null;
    /** Local archive path — internal only (route/MCP/CLI payloads omit
     *  it); rb-playlist needs the FILENAME to match master content rows. */
    filePath: string | null;
  }[];
  freshness: {
    beatsAt: string | null;
    moodAt: string | null;
  };
} {
  const rows = reader.rows<{
    video_id: string;
    title: string | null;
    artist: string | null;
    duration_s: number | null;
    file_path: string | null;
    bpm_folded: number | null;
    valence: number | null;
    arousal: number | null;
    dance: number | null;
  }>(
    `SELECT t.video_id, t.title, t.artist, t.duration_s, t.file_path,
            b.bpm_folded, m.valence, m.arousal, m.dance
     FROM tracks t
     LEFT JOIN beats b ON b.video_id = t.video_id
     LEFT JOIN mood m ON m.video_id = t.video_id
     WHERE t.status = 'downloaded'
     ORDER BY t.updated_at DESC
     ${limit !== undefined && limit > 0 ? "LIMIT ?" : ""}`,
    ...(limit !== undefined && limit > 0 ? [limit] : []),
  );
  const existingRows = rows.flatMap((row) => {
    const resolvedPath = existingCandidatePath(row.file_path, shelfContents);
    return resolvedPath
      ? [
          {
            ...row,
            file_path: resolvedPath.path,
            relocated: resolvedPath.relocated,
          },
        ]
      : [];
  });
  const missingFiles = rows.length - existingRows.length;
  const seenFiles = new Set<string>();
  const actualRows = existingRows.filter((row) => {
    const key = physicalPathKey(row.file_path);
    if (seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });
  const duplicateFiles = existingRows.length - actualRows.length;
  const relocatedFiles = actualRows.filter((row) => row.relocated).length;
  let keyReads = 0;
  let keyReadFailures = 0;
  const candidates = actualRows.map((r) => {
    // TKEY lives on the FILE (AIFF/MP3 only — WAV has no key field).
    // Cache first (exact source path validated); a miss pays one groundTruth
    // read without mutating the archive DB.
    let key: string | null = null;
    const cached = reader.keyRecord(r.video_id, r.file_path);
    if (cached) {
      key = cached.key === "" ? null : cached.key;
    } else {
      keyReads++;
      try {
        key = groundTruth(r.file_path).key;
        reader.rememberKeyRecord({
          videoId: r.video_id,
          key: key ?? "",
          sourcePath: r.file_path,
        });
      } catch (error) {
        // The count is the public diagnostic; raw decoder errors may contain
        // private local paths, so do not put their text on the wire.
        void error;
        keyReadFailures++;
        key = null; // unreadable file loses key-score, never throws
      }
    }
    return {
      videoId: r.video_id,
      title: r.title,
      artist: r.artist,
      durationS: r.duration_s,
      bpm: r.bpm_folded,
      key,
      valence: r.valence,
      arousal: r.arousal,
      dance: r.dance,
      filePath: r.file_path,
    };
  });
  return {
    available: reader.available(),
    sourceTotal: rows.length,
    total: candidates.length,
    missingFiles,
    duplicateFiles,
    relocatedFiles,
    keyReads,
    keyReadFailures,
    candidates,
    freshness: poolFreshness(reader),
  };
}

/** Set-builder freshness: the newest `analyzed_at` in the beats/mood
 *  ledgers (null when a ledger is empty). The UI/CLI surfaces this so a
 *  stale pool is VISIBLE ("built from analysis older than your latest
 *  drops") instead of silently proposing from yesterday's census. */
export function poolFreshness(reader: ArchiveQuery): {
  beatsAt: string | null;
  moodAt: string | null;
} {
  const row = reader.row<{ beats_at: string | null; mood_at: string | null }>(
    `SELECT
       (SELECT MAX(analyzed_at) FROM beats) AS beats_at,
       (SELECT MAX(analyzed_at) FROM mood) AS mood_at`,
  );
  return {
    beatsAt: row?.beats_at ?? null,
    moodAt: row?.mood_at ?? null,
  };
}
