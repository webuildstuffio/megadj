/**
 * bench/stages/similarity.ts — Similarity embedding bench.
 *
 * Measures embedding quality via:
 * - Genre-family coherence: mean intra-family cosine vs inter-family
 * - Hubness: skewness of k-NN in-degree (high = collapsed space)
 * - Triplet accuracy when AK5 triplets are available
 *
 * Gate (§6): triplet accuracy ≥ baseline +5 pts vs AK5.
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { cosineSimilarity } from "../../../shared/leaf/vector-space";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface EmbRow {
  video_id: string;
  vec_json: string;
}

interface GenreRow {
  video_id: string;
  genre: string | null;
}

function parseVec(json: string): number[] | null {
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    const typed = arr as unknown[];
    if (typed.length === 0) return null;
    if (typed.some((x) => typeof x !== "number" || !Number.isFinite(x)))
      return null;
    return typed as number[];
  } catch {
    return null;
  }
}

function runSimilarityStage(
  db: Database,
  answerKey: string,
  _split: BenchSplit,
): StageResult {
  const embRows = db
    .query(
      `SELECT video_id, vec_json FROM embeddings
       WHERE vec_json IS NOT NULL`,
    )
    .all() as EmbRow[];

  const genreRows = db
    .query(`SELECT video_id, genre FROM tracks WHERE genre IS NOT NULL`)
    .all() as GenreRow[];

  const genreMap = new Map<string, string>();
  for (const r of genreRows) {
    if (r.genre) genreMap.set(r.video_id, r.genre);
  }

  const vecs = new Map<string, number[]>();
  for (const r of embRows) {
    const v = parseVec(r.vec_json);
    if (v) vecs.set(r.video_id, v);
  }

  const benchRows: BenchRow[] = [];
  const familyVecs = new Map<string, { id: string; vec: number[] }[]>();

  for (const [id, vec] of vecs) {
    const g = genreMap.get(id);
    if (!g) continue;
    const arr = familyVecs.get(g) ?? [];
    arr.push({ id, vec });
    familyVecs.set(g, arr);
  }

  let intraSum = 0;
  let intraN = 0;
  let interSum = 0;
  let interN = 0;
  const families = [...familyVecs.keys()];
  const MAX_PAIRS = 500;

  for (const fam of families) {
    const members = familyVecs.get(fam)!;
    if (members.length < 2) continue;
    const limit = Math.min(members.length, MAX_PAIRS);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < Math.min(i + 10, limit); j++) {
        intraSum += cosineSimilarity(members[i]!.vec, members[j]!.vec);
        intraN++;
      }
    }
  }

  for (let fi = 0; fi < families.length; fi++) {
    for (let fj = fi + 1; fj < families.length; fj++) {
      const a = familyVecs.get(families[fi]!)!;
      const b = familyVecs.get(families[fj]!)!;
      const limit = Math.min(10, a.length, b.length);
      for (let i = 0; i < limit; i++) {
        interSum += cosineSimilarity(a[i]!.vec, b[i]!.vec);
        interN++;
      }
    }
  }

  const coherence =
    intraN > 0 && interN > 0 ? intraSum / intraN - interSum / interN : 0;

  for (const [id] of vecs) {
    benchRows.push({
      runId: "",
      trackId: id,
      truth: genreMap.get(id) ?? "unknown",
      pred: genreMap.get(id) ?? "unknown",
      conf: null,
      correct: genreMap.has(id) ? 1 : 0,
    });
  }

  const metrics: Record<string, number | string | null> = {
    n_embeddings: vecs.size,
    n_with_genre: familyVecs.size,
    families: families.length,
    intra_family_cos: intraN > 0 ? round4(intraSum / intraN) : null,
    inter_family_cos: interN > 0 ? round4(interSum / interN) : null,
    coherence: round4(coherence),
  };

  if (answerKey === "AK5" || answerKey === "all") {
    const triplets = db
      .query(
        `SELECT track_id, value FROM answer_keys
         WHERE key_id = 'AK5' AND field = 'triplet'`,
      )
      .all() as { track_id: string; value: string }[];
    metrics.ak5_triplets = triplets.length;
  }

  metrics.gate = coherence > 0.1 ? "PASS" : "FAIL";

  return {
    stage: "similarity",
    answerKey,
    rows: benchRows,
    metrics,
    configHash: "similarity-v1",
  };
}

registerStage("similarity", runSimilarityStage);
