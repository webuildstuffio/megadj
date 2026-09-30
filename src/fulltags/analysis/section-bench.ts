/**
 * section-embedding-bench.ts — Sampled A/B comparison of section-embedding
 * strategies for genre kNN accuracy.
 *
 * Strategies tested:
 *   A) whole-track (baseline — existing embeddings from DB)
 *   B) top-1 section (single best drop window)
 *   C) best-of-3 (compute 3 sections, pick the embedding that gives highest
 *      genre agreement against the seed corpus)
 *   D) multi-section average (average the 3 section embeddings)
 *
 * Uses leave-one-out on a random 50-track sample with known genres.
 * Runtime: ~5–10 min (50 tracks × 3 sections × ~3s each through effnet).
 *
 * Usage: bun src/fulltags/analysis/section-bench.ts [--sample N]
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { parseEmbeddingVector } from "../../core/similar-storage";
import { inferGenre, genreFamily, type GenreSeed } from "../../core/similar";
import { findDropCandidates, type DropSection } from "./drop-finder";
import { analyzeMoods } from "./models";
import { round2 } from "../../shared/leaf/fmt";

const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

interface SampleTrack {
  videoId: string;
  title: string | null;
  genre: string;
  filePath: string;
  wholeVec: number[];
  downbeats: number[];
  durationS: number | null;
}

function loadSample(db: Database, sampleSize: number): SampleTrack[] {
  const rows = db
    .query(
      `SELECT t.video_id, t.title, t.genre, t.file_path, t.duration_s,
              e.vec_json, b.downbeats_json
       FROM tracks t
       JOIN embeddings e ON e.video_id = t.video_id
       JOIN beats b ON b.video_id = t.video_id
       WHERE t.status = 'downloaded'
         AND t.genre IS NOT NULL AND t.genre != ''
         AND t.file_path IS NOT NULL
         AND b.downbeats_json IS NOT NULL
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .all(sampleSize) as {
    video_id: string;
    title: string | null;
    genre: string;
    file_path: string;
    duration_s: number | null;
    vec_json: string;
    downbeats_json: string;
  }[];

  return rows.flatMap((r) => {
    try {
      const wholeVec = parseEmbeddingVector(r.vec_json, r.video_id);
      const downbeats: unknown = JSON.parse(r.downbeats_json);
      if (!Array.isArray(downbeats) || downbeats.length < 16) return [];
      if (!existsSync(r.file_path)) return [];
      return [
        {
          videoId: r.video_id,
          title: r.title,
          genre: r.genre,
          filePath: r.file_path,
          wholeVec,
          downbeats: downbeats as number[],
          durationS: r.duration_s,
        },
      ];
    } catch {
      return [];
    }
  });
}

function loadAllSeeds(db: Database): GenreSeed[] {
  const rows = db
    .query(
      `SELECT e.video_id, t.genre, e.vec_json
       FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
       WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''`,
    )
    .all() as { video_id: string; genre: string; vec_json: string }[];
  return rows.flatMap((r) => {
    try {
      return [
        {
          videoId: r.video_id,
          genre: r.genre,
          vec: parseEmbeddingVector(r.vec_json, r.video_id),
        },
      ];
    } catch {
      return [];
    }
  });
}

function vecAverage(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dim = vecs[0]!.length;
  const result: number[] = Array.from<number>({ length: dim }).fill(0);
  for (const v of vecs)
    for (let i = 0; i < dim; i++)
      result[i] = (result[i] ?? 0) + (v[i] ?? 0) / vecs.length;
  return result;
}

/** Leave-one-out accuracy using the provided vec for the held-out track. */
function looAccuracy(
  sample: { videoId: string; genre: string; vec: number[] }[],
  allSeeds: GenreSeed[],
  k = 5,
  minAgreement = 0.6,
): { agree: number; disagree: number; refused: number; accuracy: number } {
  let agree = 0;
  let disagree = 0;
  let refused = 0;
  for (const held of sample) {
    const family = genreFamily(held.genre);
    if (family === null) continue;
    const rest = allSeeds.filter((s) => s.videoId !== held.videoId);
    const vote = inferGenre(rest, held.vec, k, minAgreement);
    if (vote.inferred === null) refused++;
    else if (vote.inferred === family) agree++;
    else disagree++;
  }
  const total = agree + disagree + refused;
  return {
    agree,
    disagree,
    refused,
    accuracy: total > 0 ? round2(agree / total) : 0,
  };
}

async function main() {
  const sampleSize = parseInt(
    process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? "50",
    10,
  );

  console.log(`\n🔬 Section Embedding Bench — sampling ${sampleSize} tracks\n`);

  const db = new Database(DB_PATH, { readonly: true });
  const sample = loadSample(db, sampleSize + 20); // overshoot for file-missing
  const allSeeds = loadAllSeeds(db);
  db.close();

  const usable = sample.slice(0, sampleSize);
  console.log(
    `  ${usable.length} tracks sampled (genre + beats + embedding + file exists)`,
  );
  console.log(`  ${allSeeds.length} total seeds for kNN\n`);

  // Strategy A: whole-track (baseline — already have embeddings)
  const wholeTrackData = usable.map((t) => ({
    videoId: t.videoId,
    genre: t.genre,
    vec: t.wholeVec,
  }));
  const stratA = looAccuracy(wholeTrackData, allSeeds);
  console.log(
    `  A) whole-track:      ${(stratA.accuracy * 100).toFixed(1)}% (${stratA.agree}/${stratA.agree + stratA.disagree + stratA.refused})  [agree=${stratA.agree} disagree=${stratA.disagree} refused=${stratA.refused}]`,
  );

  // Compute section embeddings for all candidates
  console.log(
    `\n  Computing section embeddings (3 sections × ${usable.length} tracks)...`,
  );

  // Build all the section requests: for each track, top-3 candidate sections
  interface SectionReq {
    trackIdx: number;
    candidateIdx: number;
    section: DropSection;
  }
  const sectionReqs: SectionReq[] = [];
  const candidatesByTrack: DropSection[][] = [];

  for (let i = 0; i < usable.length; i++) {
    const t = usable[i]!;
    const candidates = findDropCandidates(t.downbeats, 3, t.durationS);
    candidatesByTrack.push(candidates);
    for (let c = 0; c < candidates.length; c++) {
      sectionReqs.push({
        trackIdx: i,
        candidateIdx: c,
        section: candidates[c]!,
      });
    }
  }

  console.log(`  ${sectionReqs.length} section embedding requests to compute`);

  // Send all requests through the Python worker. We need to send each
  // section as a separate request with a unique path key. Use synthetic
  // paths: "<real-path>::section<N>" to distinguish them.
  const sectionPaths: string[] = [];
  const sectionRanges = new Map<string, { start: number; end: number }>();
  const pathToReq = new Map<string, SectionReq>();

  for (const req of sectionReqs) {
    const t = usable[req.trackIdx]!;
    const key = `${t.filePath}`;
    // We can't send the same path twice to analyzeMoods in one batch (Map
    // dedupes). So we batch per-candidate-index.
    sectionPaths.push(key);
    sectionRanges.set(key, {
      start: req.section.startSec,
      end: req.section.endSec,
    });
    pathToReq.set(key, req);
  }

  // Process in batches by candidate index (0, 1, 2) so same files aren't
  // sent twice in one analyzeMoods call.
  const sectionEmbeddings: (number[] | null)[][] = usable.map(() => []);
  const maxCandidates = Math.max(...candidatesByTrack.map((c) => c.length), 0);

  for (let cIdx = 0; cIdx < maxCandidates; cIdx++) {
    const batchPaths: string[] = [];
    const batchRanges = new Map<string, { start: number; end: number }>();
    const batchTrackIdx: number[] = [];

    for (let tIdx = 0; tIdx < usable.length; tIdx++) {
      const candidates = candidatesByTrack[tIdx]!;
      if (cIdx >= candidates.length) continue;
      const t = usable[tIdx]!;
      const sec = candidates[cIdx]!;
      batchPaths.push(t.filePath);
      batchRanges.set(t.filePath, { start: sec.startSec, end: sec.endSec });
      batchTrackIdx.push(tIdx);
    }

    if (batchPaths.length === 0) continue;
    console.log(
      `  batch ${cIdx + 1}/${maxCandidates}: ${batchPaths.length} tracks...`,
    );

    const results = await analyzeMoods(batchPaths, {
      withEmbedding: true,
      sectionRanges: batchRanges,
    });

    for (let j = 0; j < batchPaths.length; j++) {
      const path = batchPaths[j]!;
      const tIdx = batchTrackIdx[j]!;
      const result = results.get(path);
      if (result !== undefined && result.sectionEmbedding !== undefined) {
        sectionEmbeddings[tIdx]!.push(result.sectionEmbedding);
      } else if (result !== undefined && result.embedding !== undefined) {
        // fallback: section was too short, use whole-track embedding from this run
        sectionEmbeddings[tIdx]!.push(result.embedding);
      } else {
        sectionEmbeddings[tIdx]!.push(null);
      }
    }
  }

  const withSections = sectionEmbeddings.filter(
    (arr) => arr.length > 0 && arr[0] !== null,
  ).length;
  console.log(
    `  ${withSections}/${usable.length} tracks got section embeddings\n`,
  );

  // Strategy B: top-1 section only
  const stratBData = usable
    .map((t, i) => {
      const embs = sectionEmbeddings[i]!;
      const vec = embs[0];
      if (vec === null) return null;
      return { videoId: t.videoId, genre: t.genre, vec };
    })
    .filter(
      (x): x is { videoId: string; genre: string; vec: number[] } => x !== null,
    );
  const stratB = looAccuracy(stratBData, allSeeds);
  console.log(
    `  B) top-1 section:    ${(stratB.accuracy * 100).toFixed(1)}% (${stratB.agree}/${stratB.agree + stratB.disagree + stratB.refused})  [agree=${stratB.agree} disagree=${stratB.disagree} refused=${stratB.refused}]`,
  );

  // Strategy C: best-of-3 (pick the section embedding with highest genre
  // agreement — the one whose kNN vote is most confident for ANY family)
  const stratCData = usable
    .map((t, i) => {
      const embs = sectionEmbeddings[i]!.filter(
        (e): e is number[] => e !== null,
      );
      if (embs.length === 0) return null;
      const rest = allSeeds.filter((s) => s.videoId !== t.videoId);
      let bestVec = embs[0]!;
      let bestAgreement = -1;
      for (const emb of embs) {
        const vote = inferGenre(rest, emb, 5, 0);
        if (vote.agreement > bestAgreement) {
          bestAgreement = vote.agreement;
          bestVec = emb;
        }
      }
      return { videoId: t.videoId, genre: t.genre, vec: bestVec };
    })
    .filter(
      (x): x is { videoId: string; genre: string; vec: number[] } => x !== null,
    );
  const stratC = looAccuracy(stratCData, allSeeds);
  console.log(
    `  C) best-of-3:        ${(stratC.accuracy * 100).toFixed(1)}% (${stratC.agree}/${stratC.agree + stratC.disagree + stratC.refused})  [agree=${stratC.agree} disagree=${stratC.disagree} refused=${stratC.refused}]`,
  );

  // Strategy D: average of all section embeddings
  const stratDData = usable
    .map((t, i) => {
      const embs = sectionEmbeddings[i]!.filter(
        (e): e is number[] => e !== null,
      );
      if (embs.length === 0) return null;
      return { videoId: t.videoId, genre: t.genre, vec: vecAverage(embs) };
    })
    .filter(
      (x): x is { videoId: string; genre: string; vec: number[] } => x !== null,
    );
  const stratD = looAccuracy(stratDData, allSeeds);
  console.log(
    `  D) multi-avg:        ${(stratD.accuracy * 100).toFixed(1)}% (${stratD.agree}/${stratD.agree + stratD.disagree + stratD.refused})  [agree=${stratD.agree} disagree=${stratD.disagree} refused=${stratD.refused}]`,
  );

  // Strategy E: section + whole blended (avg of top-1 section + whole-track)
  const stratEData = usable
    .map((t, i) => {
      const secVec = sectionEmbeddings[i]?.[0];
      if (secVec === null || secVec === undefined) return null;
      return {
        videoId: t.videoId,
        genre: t.genre,
        vec: vecAverage([t.wholeVec, secVec]),
      };
    })
    .filter(
      (x): x is { videoId: string; genre: string; vec: number[] } => x !== null,
    );
  const stratE = looAccuracy(stratEData, allSeeds);
  console.log(
    `  E) whole+section:    ${(stratE.accuracy * 100).toFixed(1)}% (${stratE.agree}/${stratE.agree + stratE.disagree + stratE.refused})  [agree=${stratE.agree} disagree=${stratE.disagree} refused=${stratE.refused}]`,
  );

  // Summary
  const results = [
    { name: "A) whole-track", ...stratA },
    { name: "B) top-1 section", ...stratB },
    { name: "C) best-of-3", ...stratC },
    { name: "D) multi-avg", ...stratD },
    { name: "E) whole+section", ...stratE },
  ].toSorted((a, b) => b.accuracy - a.accuracy);

  console.log(`\n  ── RANKED ──`);
  for (const r of results) {
    const bar = "█".repeat(Math.round(r.accuracy * 40));
    console.log(
      `  ${r.name.padEnd(20)} ${(r.accuracy * 100).toFixed(1).padStart(5)}%  ${bar}`,
    );
  }
  const winner = results[0]!;
  console.log(
    `\n  Winner: ${winner.name} at ${(winner.accuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  Delta vs baseline (whole-track): ${((winner.accuracy - stratA.accuracy) * 100).toFixed(1)}pp\n`,
  );
}

await main();
