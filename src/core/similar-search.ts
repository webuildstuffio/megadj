import { cosineSimilarity } from "../shared/leaf/vector-space";

export interface SimilarHit {
  videoId: string;
  title: string | null;
  artist: string | null;
  /** Cosine similarity 0..1 — higher is more similar. */
  score: number;
}

/** k nearest neighbours of `queryVec` within `corpus`, excluding the query
 * track itself. Pure — the DB read happens in embeddingCorpus(). */
export function similarTracks(
  corpus: {
    videoId: string;
    title: string | null;
    artist: string | null;
    vec: number[];
  }[],
  queryVideoId: string,
  queryVec: number[],
  k: number,
): SimilarHit[] {
  return corpus
    .filter(
      (c) => c.videoId !== queryVideoId && c.vec.length === queryVec.length,
    )
    .map((c) => ({
      videoId: c.videoId,
      title: c.title,
      artist: c.artist,
      score: cosineSimilarity(queryVec, c.vec),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}
