// archive/similar.ts — the I49 sounds-like + set-builder extensions to
// ArchiveReader, split out
// of archive.ts (file-length guard). Same readonly ArchiveReader handle,
// same rules: pure reads over megadj's archive DB — a bug here cannot
// corrupt archive state.
//
//   similarTracks — I49 "sounds like": cosine kNN over the embeddings
//   similarTracks — I49 "sounds like": cosine kNN over the embeddings
//                   ledger (written by `megadj mood --embeddings`)
//   (the set-builder pool reader lives in archive/pool.ts)
import { isFiniteNumberArray } from "../../../src/shared/leaf/guards";
import {
  applySpace,
  cosineSimilarity,
  cslsPenalties,
  cslsQueryPenalty,
  fitAllButTheTop,
  isSimilarSpace,
} from "../../../src/shared/leaf/vector-space";
import type { ArchiveSimilar } from "../../shared/archive-wire";
import type { ArchiveQuery } from "./types";

/** Round to 4 decimals for wire payloads. Pure — module-level. */
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function similarTracks(
  reader: ArchiveQuery,
  videoId: string,
  k = 10,
  space = "raw",
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
      if (!isFiniteNumberArray(parsed) || parsed.length === 0) {
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
  const compatible = corpus.filter((c) => c.vec.length === queryVec!.length);
  if (!isSimilarSpace(space))
    throw new Error(`similarTracks: unknown space "${space}"`);
  let hits: {
    video_id: string;
    title: string | null;
    artist: string | null;
    score: number;
  }[];
  if (space === "whitened" && compatible.length > 1) {
    const model = fitAllButTheTop(
      [...compatible.map((c) => c.vec), queryVec],
      2,
    );
    const querySpaceVec = applySpace(model, queryVec);
    const spaceVecs = compatible.map((c) => applySpace(model, c.vec));
    const penalties = cslsPenalties(spaceVecs);
    const queryPenalty = cslsQueryPenalty(querySpaceVec, spaceVecs);
    hits = compatible
      .map((c, i) => ({
        video_id: c.videoId,
        title: c.title,
        artist: c.artist,
        score: r4(
          2 * cosineSimilarity(querySpaceVec, spaceVecs[i]!) -
            queryPenalty -
            penalties[i]!,
        ),
      }))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, kk);
  } else {
    hits = compatible
      .map((c) => ({
        video_id: c.videoId,
        title: c.title,
        artist: c.artist,
        score: r4(cosineSimilarity(queryVec!, c.vec)),
      }))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, kk);
  }
  return {
    available: true,
    video_id: videoId,
    title: queryTitle,
    corpus: corpus.length,
    hits,
  };
}
