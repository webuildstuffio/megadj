/**
 * Pure vector-space corrections shared by the archive engine and CrateDeck.
 *
 * Dependency-free by the same rule as similarity.ts (the import leaf): both
 * sides of the archive boundary import this without pulling application
 * code across the boundary.
 *
 * Two corrections from the embedding research review
 * (docs/fulltags/embedding-research-2026-09-14.md R5/F4):
 *
 *  - `fitAllButTheTop` — Mu & Viswanath 2018 "All-but-the-Top": mean-centre
 *    the corpus, then remove its top-C principal components (power iteration
 *    + deflation — no linalg dependency). effnet vectors are anisotropic: a
 *    few dominant directions encode production loudness/energy rather than
 *    genre, so every track sits cosine-close to every other (hubness).
 *    Removing the top components sharpens neighbourhoods; C=2 is the
 *    default and the measured difference to C=10 is small.
 *
 *  - CSLS penalties — Conneau et al. 2018: a hub track (cosine-close to
 *    everyone) keeps winning top-k lists. Penalize each candidate by the
 *    mean similarity to its own R nearest corpus neighbours, so only
 *    candidates that are close to the QUERY *and not to everything* rank
 *    high. Score = 2·cos(q,c) − r(q) − r(c); r(q) is constant across
 *    candidates but is included so wire scores stay honest.
 *
 * Everything here is deterministic (no RNG: power iteration seeds from the
 * first basis vector) and pure (no DB, no IO).
 */

/** The retrieval-space selector shared by `megadj similar --space`,
 * the `/api/archive/similar` route, and the MCP `archive_similar_tracks`
 * tool. One source of truth so the three surfaces cannot drift. */
export type SimilarSpace = "raw" | "whitened";

export const SIMILAR_SPACES: readonly SimilarSpace[] = ["raw", "whitened"];

export function isSimilarSpace(value: string): value is SimilarSpace {
  return (SIMILAR_SPACES as readonly string[]).includes(value);
}

/** CSLS neighbourhood size R (mean of the top-R similarities). */
export const CSLS_R = 10;

/** Penalty-reference cap: the CSLS penalty of candidate c is estimated
 * against a deterministic stride sample of the corpus when it exceeds
 * this size (full corpus otherwise). A 3k-corpus pairwise pass costs
 * ~10 s; a 1500-reference sample estimates the same mean at ~2 s. The
 * cap trades a hair of penalty accuracy for interactive A/B latency and
 * is honest on the wire (the penalty is an estimate either way at any R). */
export const CSLS_REF_CAP = 1500;

export interface SpaceModel {
  /** Corpus mean (d). */
  readonly mean: number[];
  /** Top principal directions, flattened row-major (C×d). */
  readonly components: number[];
  readonly componentCount: number;
}

/** Zero-filled numeric array of length n (`Array.from` — the oxlint-safe
 *  allocation; `new Array(n).fill(0)` is ambiguous to readers). */
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/** L2-normalize in place-style: returns a new array; zero vectors stay
 * zero (cosine handles them as 0 anyway). */
export function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return [...vec];
  return vec.map((v) => v / norm);
}

/** Dot product of two equal-length vectors (0 when lengths differ). */
function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** One power-iteration pass set: the top principal direction of the
 * centred data matrix (rows are vectors), seeded from basis vector e0 —
 * deterministic, no RNG. Converges when successive directions align to
 * within 1e-6 (or after `iters` passes). */
function topDirection(rows: number[][], d: number, iters = 60): number[] {
  let v = zeros(d);
  if (d === 0) return v;
  v[0] = 1;
  for (let iter = 0; iter < iters; iter++) {
    // v' = Xᵀ(Xv) — accumulate per dimension without materializing XvᵀX
    const next = zeros(d);
    for (const row of rows) {
      const proj = dot(row, v);
      if (proj === 0) continue;
      for (let i = 0; i < d; i++) next[i]! += proj * row[i]!;
    }
    const normalized = l2normalize(next);
    const aligned = Math.abs(dot(normalized, v));
    v = normalized;
    if (aligned > 1 - 1e-6) break;
  }
  return v;
}

/** Fit the all-but-the-top model on a corpus: mean-centre, then extract
 * the top `components` principal directions with deflation (each found
 * direction is projected out of the data before the next search). */
export function fitAllButTheTop(
  vectors: number[][],
  components = 2,
): SpaceModel {
  const d = vectors[0]?.length ?? 0;
  const mean = zeros(d);
  if (vectors.length === 0 || d === 0)
    return { mean, components: [], componentCount: 0 };
  for (const vec of vectors)
    for (let i = 0; i < d; i++) mean[i]! += vec[i]! / vectors.length;
  let centred = vectors.map((vec) => vec.map((v, i) => v - mean[i]!));
  const found: number[][] = [];
  for (let c = 0; c < Math.max(0, components); c++) {
    const dir = topDirection(centred, d);
    found.push(dir);
    // deflate: subtract each row's projection onto the found direction
    centred = centred.map((row) => {
      const proj = dot(row, dir);
      return row.map((v, i) => v - proj * dir[i]!);
    });
  }
  return {
    mean,
    components: found.flat(),
    componentCount: found.length,
  };
}

/** Transform one vector with a fitted model: centre, remove the top
 * components, re-L2-normalize (post-transform cosine is still cosine). */
export function applySpace(model: SpaceModel, vec: number[]): number[] {
  const d = model.mean.length;
  if (vec.length !== d) return [...vec];
  let out = vec.map((v, i) => v - model.mean[i]!);
  for (let c = 0; c < model.componentCount; c++) {
    const offset = c * d;
    const dir = model.components.slice(offset, offset + d);
    const proj = dot(out, dir);
    out = out.map((v, i) => v - proj * dir[i]!);
  }
  return l2normalize(out);
}

/** Mean of the top-R cosine similarities, rounded to 4 dp — the shared
 *  tail of cslsPenalties/cslsQueryPenalty (the only difference is which
 *  similarity set feeds it: self-excluded refs vs the whole corpus). */
function roundedMeanTop(sims: number[], r: number): number {
  const top = sims.toSorted((a, b) => b - a).slice(0, Math.max(1, r));
  const mean = top.reduce((acc, s) => acc + s, 0) / Math.max(1, top.length);
  return Math.round(mean * 10000) / 10000;
}

/** CSLS penalty per candidate: the mean of its CSLS_R largest cosine
 * similarities to the (deterministically sampled) reference corpus,
 * self-excluded. Hubs — tracks near everyone — get the largest
 * penalties, which is exactly the demotion the retrieval ranking wants. */
export function cslsPenalties(vectors: number[][], r = CSLS_R): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  // deterministic stride sample when the corpus exceeds the reference cap
  // (integer positions only — a fractional stride indexes undefined rows)
  const stride = n > CSLS_REF_CAP ? Math.ceil(n / CSLS_REF_CAP) : 1;
  const refs: number[] = [];
  for (let i = 0; i < n; i += stride) refs.push(i);
  return vectors.map((vec, i) => {
    const sims = refs.filter((j) => j !== i).map((j) => dot(vec, vectors[j]!));
    return roundedMeanTop(sims, r);
  });
}

/** CSLS penalty of a query vector against the transformed corpus — the
 * mean of its top-R similarities (nothing excluded: the query is not a
 * corpus member here). Constant across candidates; kept so the wire's
 * 2·cos − r(q) − r(c) scores are the published formula, not a variant. */
export function cslsQueryPenalty(
  queryVec: number[],
  corpusVecs: number[][],
  r = CSLS_R,
): number {
  const sims = corpusVecs.map((c) => dot(queryVec, c));
  return roundedMeanTop(sims, r);
}
