// archive/pool.ts — the set-builder's pool reader (#89 diet extraction
// from archive/similar.ts): candidate load (tracks ⋈ beats ⋈ mood ⋈ TKEY
// ⋈ embeddings ledgers) + pool freshness. Feeds the pure engine in
// megaset.ts. Unparsable keys/rows degrade to null, never throw.
import { existsSync } from "node:fs";
import { groundTruth } from "../../../src/fulltags/write/readers";
import { resolve, sep } from "node:path";
import {
  isFiniteNumber,
  isFiniteNumberArray,
  isRecord,
} from "../../../src/shared/leaf/guards";
import type {
  ArchiveFreshness,
  ArchiveSetCandidates,
} from "../../shared/archive-wire";
import type { ArchiveQuery } from "./types";

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
  if (anchor === -1 || anchor + 2 >= parts.length) return null;
  const rebased = resolve(shelfContents, ...parts.slice(anchor + 2));
  return existsSync(rebased) ? { path: rebased, relocated: true } : null;
}

/** B1 (#104): the MEASURED tempo of a pool row — the beats ledger's
 *  folded BPM first, else the rekordbox mirror's BPM (analysis
 *  rekordbox ran itself). Both are real measurements, not guesses; a
 *  row with either can be scored without its file. */
function measuredBpm(row: {
  bpm_folded: number | null;
  rekordbox_bpm: number | null;
}): number | null {
  if (row.bpm_folded !== null && Number.isFinite(row.bpm_folded)) {
    return row.bpm_folded;
  }
  return row.rekordbox_bpm !== null &&
    Number.isFinite(row.rekordbox_bpm) &&
    row.rekordbox_bpm > 0
    ? row.rekordbox_bpm
    : null;
}

/** #106 Phase D: parse the `cues` ledger join into the pool-candidate
 *  cue subset (bar + position). Guarded: null/absent → [] (the track
 *  simply has no derivation); malformed JSON or non-finite fields → []
 *  with a console.warn diagnostic — one bad row never kills a pool
 *  build, and the handoff derivation degrades to null, never invented
 *  bars. The `memory` flag and model fields are ignored here (the
 *  memory spine is a CDJ-write concern, not a proposal concern). */
function parsePoolCues(raw: string | null): {
  bar: number;
  position: number;
}[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    console.warn("cues_json is malformed JSON — pool row scored without cues");
    void error;
    return [];
  }
  if (!Array.isArray(value)) {
    console.warn("cues_json is not an array — pool row scored without cues");
    return [];
  }
  const out: { bar: number; position: number }[] = [];
  for (const entry of value as unknown[]) {
    if (
      isRecord(entry) &&
      isFiniteNumber(entry.bar) &&
      isFiniteNumber(entry.position)
    ) {
      out.push({ bar: entry.bar, position: entry.position });
    }
  }
  return out;
}

/** #171 similarity prior: guarded vector parse for one pool row. A
 * corrupt/malformed embedding degrades to null (no prior) exactly like
 * every other poison-row ledger read — never throws into the build. */
function parsePoolEmbedding(raw: string | null): number[] | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    console.warn(
      "embeddings.vec_json is malformed JSON — pool row scored without the similarity prior",
    );
    void error;
    return null;
  }
  if (!isFiniteNumberArray(value) || value.length === 0) {
    console.warn(
      "embeddings.vec_json is not a finite-number array — pool row scored without the similarity prior",
    );
    return null;
  }
  return value;
}

/**
 * I49 "sounds like": cosine kNN over megadj's `embeddings` ledger
 * (effnet 1280-d mean embeddings, written by `megadj mood
 * --embeddings`). Pure read + TS-side cosine — the doc blesses
 * "blob + cosine at 3–10k tracks". Degrades to available:false when
 * the ledger is empty or the query track has no embedding.
 *
 * `space: "whitened"` applies the research review's retrieval
 * corrections (mean-centre + all-but-the-top + CSLS, research review
 * R5) fitted on the live corpus. The shared `isSimilarSpace` guard is
 * the same one the CLI uses — an unknown value here is a programming
 * error (route/MCP validate first), so it throws rather than silently
 * ranking in the wrong space.
 */

/**
 * Set-builder: load the candidate pool (playable tracks joined with
 * beats + mood ledgers + the cached TKEY ledger). Feeds the pure engine
 * in megaset.ts. Unparsable keys degrade to null (no key-score), never
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
  // #106 Phase D: the phrase-cue join. Like `cueStats`, guarded on the
  // table's existence — pre-cues archive DBs must still build sets (the
  // derivation then degrades to null handoff windows, not a crash).
  const hasCues =
    reader.row<{ present: number }>(
      `SELECT 1 AS present FROM sqlite_master
     WHERE type = 'table' AND name = 'cues'`,
    )?.present === 1;
  const cuesJoin = hasCues ? `LEFT JOIN cues c ON c.video_id = t.video_id` : "";
  const cuesColumn = hasCues ? "c.cues_json" : "NULL";
  // #171 embeddings join for the similarity prior. Same guarded pattern:
  // an archive without the embeddings table builds sets with every
  // candidate's embedding null (no prior, never a penalty).
  const hasEmbeddings =
    reader.row<{ present: number }>(
      `SELECT 1 AS present FROM sqlite_master
     WHERE type = 'table' AND name = 'embeddings'`,
    )?.present === 1;
  const embJoin = hasEmbeddings
    ? `LEFT JOIN embeddings e ON e.video_id = t.video_id`
    : "";
  const embColumn = hasEmbeddings ? "e.vec_json" : "NULL";
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
    cues_json: string | null;
    vec_json: string | null;
  }>(
    `SELECT t.video_id, t.title, t.artist, t.duration_s, t.file_path,
            b.bpm_folded, ${rekordboxColumns},
            m.valence, m.arousal, m.dance,
            ${cuesColumn} AS cues_json,
            ${embColumn} AS vec_json
     FROM tracks t
     LEFT JOIN beats b ON b.video_id = t.video_id
     LEFT JOIN mood m ON m.video_id = t.video_id
     ${cuesJoin}
     ${embJoin}
     ${rekordboxJoin}
     WHERE t.status = 'downloaded'
     ORDER BY t.updated_at DESC
     ${limit !== undefined && limit > 0 ? "LIMIT ?" : ""}`,
    ...(limit !== undefined && limit > 0 ? [limit] : []),
  );
  /** B1 (#104): a row whose FILE is gone can still be scored when
   *  MEASURED tempo exists — the beats ledger's folded BPM, or the
   *  rekordbox mirror's BPM (analysis rekordbox ran itself). Both are
   *  real measurements, not guesses. Metadata-only rows keep filePath
   *  null so no surface can export a dead path. */
  type CandidateRow = (typeof rows)[number] & {
    relocated: boolean;
    metadataOnly: boolean;
  };
  const [existingRows, metadataRows] = rows.reduce<
    [CandidateRow[], CandidateRow[]]
  >(
    (acc, row) => {
      const resolvedPath = existingCandidatePath(row.file_path, shelfContents);
      if (resolvedPath) {
        acc[0].push({
          ...row,
          file_path: resolvedPath.path,
          relocated: resolvedPath.relocated,
          metadataOnly: false,
        });
      } else if (measuredBpm(row) !== null) {
        // no file, but measured tempo — admitted as metadata-only (the
        // duration falls back to the engine's 300 s assumption)
        acc[1].push({
          ...row,
          file_path: null,
          relocated: false,
          metadataOnly: true,
        });
      }
      // else: no file AND no measured tempo — unscorable, stays excluded
      return acc;
    },
    [[], []],
  );
  const missingFiles = rows.length - existingRows.length;
  const metadataOnlyCount = metadataRows.length;
  const seenFiles = new Set<string>();
  const actualRows = [...existingRows, ...metadataRows].filter((row) => {
    if (row.file_path === null) return true; // metadata-only: no path to dedupe
    const key = physicalPathKey(row.file_path);
    if (seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });
  const duplicateFiles =
    existingRows.length - (actualRows.length - metadataRows.length);
  const relocatedFiles = actualRows.filter((row) => row.relocated).length;
  let rekordboxKeyHits = 0;
  let rekordboxBpmHits = 0;
  let keyReads = 0;
  let keyReadFailures = 0;
  const candidates = actualRows.map((r) => {
    // TKEY lives on the FILE (AIFF/MP3 only — WAV has no key field).
    // Cache first (exact source path validated); a miss pays one groundTruth
    // read without mutating the archive DB. B1: a metadata-only row has
    // no file to read — the mirror key (if any) is its ceiling, and no
    // live read/count is attempted.
    let key: string | null = null;
    const cached =
      r.file_path !== null ? reader.keyRecord(r.video_id, r.file_path) : null;
    if (cached) {
      key = cached.key === "" ? null : cached.key;
    } else if (r.rekordbox_key?.trim()) {
      key = r.rekordbox_key.trim();
      rekordboxKeyHits++;
    } else if (r.file_path !== null) {
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
      cues: parsePoolCues(r.cues_json),
      // #171 similarity prior: parse guarded — a corrupt vector row must
      // degrade to null (no bonus) like every other poison-row ledger
      // read, never throw into the pool build.
      embedding: parsePoolEmbedding(r.vec_json),
      filePath: r.file_path,
      metadataOnly: r.metadataOnly,
    };
  });
  return {
    available: reader.available(),
    sourceTotal: rows.length,
    total: candidates.length,
    missingFiles,
    metadataOnly: metadataOnlyCount,
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
