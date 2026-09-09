// archive_similar.ts — the I49/M66 extensions to ArchiveReader, split out
// of archive.ts (file-length guard). Same readonly ArchiveReader handle,
// same rules: pure reads over megadj's archive DB — a bug here cannot
// corrupt archive state.
//
//   similarTracks — I49 "sounds like": cosine kNN over the embeddings
//                   ledger (written by `megadj mood --embeddings`)
//   setCandidates — M66 set-builder candidate pool (beats + mood + TKEY)
//   cosine        — unit-scale similarity, exported for tests
import { existsSync } from "node:fs";
import { groundTruth } from "../../fulltags/src/exports";
import type { ArchiveReader } from "./archive";

/** Unit-scale cosine similarity (module fn so tests can hit it directly). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * I49 "sounds like": cosine kNN over megadj's `embeddings` ledger
 * (effnet 1280-d mean embeddings, written by `megadj mood
 * --embeddings`). Pure read + TS-side cosine — the doc blesses
 * "blob + cosine at 3–10k tracks". Degrades to available:false when
 * the ledger is empty or the query track has no embedding.
 */
export function similarTracks(
  reader: ArchiveReader,
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
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;
  const hits = corpus
    .filter((c) => c.vec.length === queryVec!.length)
    .map((c) => ({
      video_id: c.videoId,
      title: c.title,
      artist: c.artist,
      score: r4(cosine(queryVec!, c.vec)),
    }))
    .sort((a, b) => b.score - a.score)
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
 * beats + mood ledgers; TKEY read per-file at request time — a few
 * hundred ms for hundreds of files, bounded by `limit`). Feeds the pure
 * engine in setbuild.ts. Unparsable keys degrade to null (no key-score),
 * never throw.
 */
export function setCandidates(
  reader: ArchiveReader,
  limit = 400,
): {
  available: boolean;
  total: number;
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
  }[];
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
     WHERE t.status = 'downloaded' AND t.file_path IS NOT NULL
     ORDER BY t.updated_at DESC LIMIT ?`,
    limit,
  );
  const candidates = rows.map((r) => {
    // TKEY lives on the FILE (AIFF/MP3 only — WAV has no key field); a
    // failed read means the candidate loses key-score, never throws.
    let key: string | null = null;
    if (r.file_path && existsSync(r.file_path)) {
      try {
        key = groundTruth(r.file_path).key;
      } catch {
        key = null;
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
    };
  });
  return {
    available: reader.available(),
    total: candidates.length,
    candidates,
  };
}
