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
import type {
  ArchiveFreshness,
  ArchiveSetCandidates,
  ArchiveSimilar,
} from "../shared/archive-wire";
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
): ArchiveSimilar {
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
      const parsed: unknown = JSON.parse(r.vec_json);
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
        )
      ) {
        console.warn(`embedding ${r.video_id} has invalid vec_json — skipping`);
        continue;
      }
      vec = parsed;
    } catch (error) {
      console.warn(
        `embedding ${r.video_id} has invalid vec_json — skipping`,
        error,
      );
      continue;
    }
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
 * actual playable track. Rekordbox's mirrored BPM/key metadata is the cheap
 * fallback when a FullTags ledger value is absent; only tracks unknown to
 * both sources need a live file read (~80 ms each: ffprobe + mutagen). This
 * request never fills the persistent cache: the entire archive read surface
 * stays physically readonly.
 */
export function setCandidates(
  reader: ArchiveQuery,
  limit?: number,
  shelfContents?: string,
): ArchiveSetCandidates {
  const hasRekordboxContent =
    reader.row<{ present: number }>(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = 'rekordbox_content'`,
    )?.present === 1;
  const rekordboxColumns = hasRekordboxContent
    ? `CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.KeyName') END AS rekordbox_key,
       CASE WHEN json_valid(rc.metadata_json)
         THEN CAST(json_extract(rc.metadata_json, '$.BPM') AS REAL) / 100.0
         END AS rekordbox_bpm`
    : `NULL AS rekordbox_key, NULL AS rekordbox_bpm`;
  const rekordboxJoin = hasRekordboxContent
    ? `LEFT JOIN rekordbox_content rc ON rc.rowid = (
         SELECT rc2.rowid FROM rekordbox_content rc2
         WHERE rc2.video_id = t.video_id
         ORDER BY rc2.updated_at DESC, rc2.content_id DESC LIMIT 1
       )`
    : "";
  const rows = reader.rows<{
    video_id: string;
    title: string | null;
    artist: string | null;
    duration_s: number | null;
    file_path: string | null;
    bpm_folded: number | null;
    rekordbox_bpm: number | null;
    rekordbox_key: string | null;
    valence: number | null;
    arousal: number | null;
    dance: number | null;
  }>(
    `SELECT t.video_id, t.title, t.artist, t.duration_s, t.file_path,
            b.bpm_folded, ${rekordboxColumns},
            m.valence, m.arousal, m.dance
     FROM tracks t
     LEFT JOIN beats b ON b.video_id = t.video_id
     LEFT JOIN mood m ON m.video_id = t.video_id
     ${rekordboxJoin}
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
  let rekordboxKeyHits = 0;
  let rekordboxBpmHits = 0;
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
    } else if (r.rekordbox_key?.trim()) {
      key = r.rekordbox_key.trim();
      rekordboxKeyHits++;
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
    const rekordboxBpm =
      r.rekordbox_bpm !== null &&
      Number.isFinite(r.rekordbox_bpm) &&
      r.rekordbox_bpm > 0
        ? r.rekordbox_bpm
        : null;
    const bpm = r.bpm_folded ?? rekordboxBpm;
    if (r.bpm_folded === null && rekordboxBpm !== null) rekordboxBpmHits++;
    return {
      videoId: r.video_id,
      title: r.title,
      artist: r.artist,
      durationS: r.duration_s,
      bpm,
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
    rekordboxKeyHits,
    rekordboxBpmHits,
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
export function poolFreshness(reader: ArchiveQuery): ArchiveFreshness {
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
