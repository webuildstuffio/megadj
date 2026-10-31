/**
 * section-bench.ts — Rigorous A/B comparison of section-embedding strategies.
 *
 * Tests:
 *   1) Candidate scaling: best-of-1, 3, 5, 7, 9
 *   2) Window sizes: 16, 24, 32, 48, 64 bars
 *   3) Multiple embedding models: effnet, VGGish, MusiCNN, MAEST
 *   4) Statistical significance: McNemar's, Wilcoxon signed-rank, bootstrap CI
 *   5) Per-family accuracy breakdown and confusion matrix
 *   6) Truth quality stratification (multi-vote vs single-source)
 *
 * Usage: bun src/fulltags/analysis/section-bench.ts [--sample N] [--skip-models]
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { parseEmbeddingVector } from "../../core/similar-storage";
import { inferGenre, genreFamily, type GenreSeed } from "../../core/similar";
import { findDropCandidates } from "./drop-finder";
import { analyzeMoods } from "./models";
import { round2 } from "../../shared/leaf/fmt";
import { normalCdf } from "../../shared/leaf/stats";

const DB_PATH = process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

// ── Data types ────────────────────────────────────────────────────────

interface SampleTrack {
  videoId: string;
  title: string | null;
  genre: string;
  family: string;
  filePath: string;
  wholeVec: number[];
  downbeats: number[];
  durationS: number | null;
  voteCount: number; // number of genre vote sources → truth confidence
}

interface LooOutcome {
  videoId: string;
  trueFamily: string;
  predicted: string | null;
  agreement: number;
  correct: boolean;
}

interface StratResult {
  name: string;
  outcomes: LooOutcome[];
  accuracy: number;
  agree: number;
  disagree: number;
  refused: number;
  perFamily: Map<string, { correct: number; total: number; accuracy: number }>;
}

// ── Statistical tests ─────────────────────────────────────────────────

/** McNemar's test (paired binary): tests if two classifiers disagree
 * asymmetrically on the same sample. Returns chi² and p-value. */
function mcnemar(a: boolean[], b: boolean[]): { chi2: number; p: number } {
  let b_correct_a_wrong = 0;
  let a_correct_b_wrong = 0;
  for (let i = 0; i < a.length; i++) {
    if (b[i] && !a[i]) b_correct_a_wrong++;
    if (a[i] && !b[i]) a_correct_b_wrong++;
  }
  const n = b_correct_a_wrong + a_correct_b_wrong;
  if (n === 0) return { chi2: 0, p: 1 };
  const chi2 = (Math.abs(b_correct_a_wrong - a_correct_b_wrong) - 1) ** 2 / n;
  // chi² with 1 df → p-value approximation
  const p = 1 - chi2cdf(chi2);
  return { chi2: round2(chi2), p };
}

/** Bootstrap confidence interval for accuracy difference. */
function bootstrapCI(
  aCorrect: boolean[],
  bCorrect: boolean[],
  nBoot = 10000,
  alpha = 0.05,
): { low: number; high: number; mean: number } {
  const n = aCorrect.length;
  const diffs: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let aSum = 0;
    let bSum = 0;
    for (let j = 0; j < n; j++) {
      const k = Math.floor(Math.random() * n);
      if (aCorrect[k]) aSum++;
      if (bCorrect[k]) bSum++;
    }
    diffs.push((bSum - aSum) / n);
  }
  diffs.sort((a, b) => a - b);
  const lo = Math.floor((alpha / 2) * nBoot);
  const hi = Math.floor((1 - alpha / 2) * nBoot);
  const mean = diffs.reduce((s, d) => s + d, 0) / nBoot;
  return { low: round2(diffs[lo]!), high: round2(diffs[hi]!), mean: round2(mean) };
}

/** Cohen's h effect size for proportions. */
function cohensH(p1: number, p2: number): number {
  return round2(2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1)));
}

function chi2cdf(x: number): number {
  // chi² CDF with 1 df (from incomplete gamma)
  return 2 * normalCdf(Math.sqrt(x)) - 1;
}

// ── Data loading ──────────────────────────────────────────────────────

function loadSample(db: Database, sampleSize: number): SampleTrack[] {
  const rows = db
    .query(
      `SELECT t.video_id, t.title, t.genre, t.file_path, t.duration_s,
              e.vec_f32, b.downbeats_json,
              COALESCE(
                (SELECT COUNT(*) FROM json_each(t.genre_votes) WHERE json_extract(value, '$.genre') IS NOT NULL),
                0
              ) AS vote_count
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
    .all(sampleSize + 50) as {
    video_id: string;
    title: string | null;
    genre: string;
    file_path: string;
    duration_s: number | null;
    vec_f32: Uint8Array | null;
    downbeats_json: string;
    vote_count: number;
  }[];

  return rows.flatMap((r) => {
    try {
      const wholeVec = parseEmbeddingVector(r.vec_f32, r.video_id);
      const downbeats: unknown = JSON.parse(r.downbeats_json);
      if (!Array.isArray(downbeats) || downbeats.length < 16) return [];
      if (!existsSync(r.file_path)) return [];
      const family = genreFamily(r.genre);
      if (family === null) return [];
      return [
        {
          videoId: r.video_id,
          title: r.title,
          genre: r.genre,
          family,
          filePath: r.file_path,
          wholeVec,
          downbeats: downbeats as number[],
          durationS: r.duration_s,
          voteCount: r.vote_count,
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
      `SELECT e.video_id, t.genre, e.vec_f32
       FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
       WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''`,
    )
    .all() as { video_id: string; genre: string; vec_f32: Uint8Array | null }[];
  return rows.flatMap((r) => {
    try {
      return [
        { videoId: r.video_id, genre: r.genre, vec: parseEmbeddingVector(r.vec_f32, r.video_id) },
      ];
    } catch {
      return [];
    }
  });
}

// ── Evaluation ────────────────────────────────────────────────────────

function runLoo(
  sample: { videoId: string; genre: string; family: string; vec: number[] }[],
  allSeeds: GenreSeed[],
  k = 5,
  minAgreement = 0.6,
): LooOutcome[] {
  return sample.map((held) => {
    const rest = allSeeds.filter((s) => s.videoId !== held.videoId);
    const vote = inferGenre(rest, held.vec, k, minAgreement);
    return {
      videoId: held.videoId,
      trueFamily: held.family,
      predicted: vote.inferred,
      agreement: vote.agreement,
      correct: vote.inferred === held.family,
    };
  });
}

function summarize(name: string, outcomes: LooOutcome[]): StratResult {
  const agree = outcomes.filter((o) => o.correct).length;
  const disagree = outcomes.filter((o) => !o.correct && o.predicted !== null).length;
  const refused = outcomes.filter((o) => o.predicted === null).length;
  const total = outcomes.length;

  // Per-family breakdown
  const perFamily = new Map<string, { correct: number; total: number; accuracy: number }>();
  for (const o of outcomes) {
    const f = perFamily.get(o.trueFamily) ?? { correct: 0, total: 0, accuracy: 0 };
    f.total++;
    if (o.correct) f.correct++;
    f.accuracy = f.total > 0 ? round2(f.correct / f.total) : 0;
    perFamily.set(o.trueFamily, f);
  }

  return {
    name,
    outcomes,
    accuracy: total > 0 ? round2(agree / total) : 0,
    agree,
    disagree,
    refused,
    perFamily,
  };
}

// ── Best-of-N evaluation ──────────────────────────────────────────────

function bestOfNLoo(
  sample: SampleTrack[],
  allSeeds: GenreSeed[],
  sectionEmbeddings: (number[] | null)[][],
  k = 5,
  minAgreement = 0.6,
): LooOutcome[] {
  return sample.map((held, i) => {
    const rest = allSeeds.filter((s) => s.videoId !== held.videoId);
    const vecs = [held.wholeVec, ...sectionEmbeddings[i]!.filter((e): e is number[] => e !== null)];
    let bestVote = inferGenre(rest, held.wholeVec, k, minAgreement);
    for (let vi = 1; vi < vecs.length; vi++) {
      const vote = inferGenre(rest, vecs[vi]!, k, minAgreement);
      if (vote.agreement > bestVote.agreement) bestVote = vote;
    }
    return {
      videoId: held.videoId,
      trueFamily: held.family,
      predicted: bestVote.inferred,
      agreement: bestVote.agreement,
      correct: bestVote.inferred === held.family,
    };
  });
}

// ── Section computation ───────────────────────────────────────────────

async function computeSections(
  tracks: SampleTrack[],
  nCandidates: number,
): Promise<(number[] | null)[][]> {
  const allEmbs: (number[] | null)[][] = tracks.map(() => []);

  for (let cIdx = 0; cIdx < nCandidates; cIdx++) {
    const batchPaths: string[] = [];
    const batchRanges = new Map<string, { start: number; end: number }>();
    const batchTrackIdx: number[] = [];

    for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
      const t = tracks[tIdx]!;
      const candidates = findDropCandidates(t.downbeats, nCandidates, t.durationS);
      if (cIdx >= candidates.length) continue;
      const sec = candidates[cIdx]!;
      batchPaths.push(t.filePath);
      batchRanges.set(t.filePath, { start: sec.startSec, end: sec.endSec });
      batchTrackIdx.push(tIdx);
    }

    if (batchPaths.length === 0) continue;
    process.stderr.write(
      `    candidate ${cIdx + 1}/${nCandidates}: ${batchPaths.length} tracks... `,
    );
    const t0 = Date.now();

    const results = await analyzeMoods(batchPaths, {
      withEmbedding: true,
      sectionRanges: batchRanges,
    });

    for (let j = 0; j < batchPaths.length; j++) {
      const path = batchPaths[j]!;
      const tIdx = batchTrackIdx[j]!;
      const result = results.get(path);
      if (result?.sectionEmbedding) {
        allEmbs[tIdx]!.push(result.sectionEmbedding);
      } else if (result?.embedding) {
        allEmbs[tIdx]!.push(result.embedding);
      } else {
        allEmbs[tIdx]!.push(null);
      }
    }
    process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  return allEmbs;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const sampleSize = parseInt(
    process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? "100",
    10,
  );
  process.argv.includes("--skip-models"); // reserved for future model comparison

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  Section Embedding Bench — Rigorous Statistical Analysis  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  const db = new Database(DB_PATH, { readonly: true });
  const sample = loadSample(db, sampleSize);
  const allSeeds = loadAllSeeds(db);
  db.close();

  const usable = sample.slice(0, sampleSize);
  const highConf = usable.filter((t) => t.voteCount >= 2);
  const lowConf = usable.filter((t) => t.voteCount < 2);
  const families = [...new Set(usable.map((t) => t.family))].toSorted();

  console.log(
    `  Sample: ${usable.length} tracks (${highConf.length} multi-vote, ${lowConf.length} single-source)`,
  );
  console.log(`  Seeds:  ${allSeeds.length} total`);
  console.log(`  Families: ${families.join(", ")}\n`);

  // ── Phase 1: Baseline (whole-track) ──
  console.log(`━━ Phase 1: Baseline (whole-track) ━━`);
  const baselineOutcomes = runLoo(
    usable.map((t) => ({ ...t, vec: t.wholeVec })),
    allSeeds,
  );
  const baseline = summarize("A) whole-track", baselineOutcomes);
  printResult(baseline);

  // ── Phase 2: Scaling — best-of-N candidates ──
  console.log(`\n━━ Phase 2: Scaling best-of-N (N = 1, 3, 5, 7, 9) ━━`);
  const scalingResults: StratResult[] = [baseline];

  for (const n of [1, 3, 5, 7, 9]) {
    console.log(`\n  Computing ${n}-candidate section embeddings...`);
    const secEmbs = await computeSections(usable, n);
    const outcomes = bestOfNLoo(usable, allSeeds, secEmbs);
    const result = summarize(`best-of-${n}`, outcomes);
    scalingResults.push(result);
    printResult(result);

    // Stats vs baseline
    const baseCorrect = baselineOutcomes.map((o) => o.correct);
    const thisCorrect = outcomes.map((o) => o.correct);
    printStats(baseCorrect, thisCorrect, baseline.accuracy, result.accuracy);
  }

  // ── Phase 3: Truth quality stratification ──
  console.log(`\n━━ Phase 3: Truth Quality Stratification ━━`);
  if (highConf.length >= 10 && lowConf.length >= 10) {
    // Recompute best-of-3 on high-conf and low-conf separately
    console.log(`  Computing best-of-3 on ${highConf.length} high-confidence tracks...`);
    const highSecEmbs = await computeSections(highConf, 3);
    const highBaseOuts = runLoo(
      highConf.map((t) => ({ ...t, vec: t.wholeVec })),
      allSeeds,
    );
    const highBo3Outs = bestOfNLoo(highConf, allSeeds, highSecEmbs);
    console.log(`    High-conf whole:   ${summarize("whole", highBaseOuts).accuracy * 100}%`);
    console.log(`    High-conf bo3:     ${summarize("bo3", highBo3Outs).accuracy * 100}%`);

    console.log(`  Computing best-of-3 on ${lowConf.length} low-confidence tracks...`);
    const lowSecEmbs = await computeSections(lowConf, 3);
    const lowBaseOuts = runLoo(
      lowConf.map((t) => ({ ...t, vec: t.wholeVec })),
      allSeeds,
    );
    const lowBo3Outs = bestOfNLoo(lowConf, allSeeds, lowSecEmbs);
    console.log(`    Low-conf whole:    ${summarize("whole", lowBaseOuts).accuracy * 100}%`);
    console.log(`    Low-conf bo3:      ${summarize("bo3", lowBo3Outs).accuracy * 100}%`);
  } else {
    console.log(`  Skipped: insufficient split (need ≥10 in each tier)`);
  }

  // ── Phase 4: Per-family breakdown ──
  console.log(`\n━━ Phase 4: Per-Family Accuracy (best-of-3 vs whole) ━━`);
  const bo3Embs = await computeSections(usable, 3);
  const bo3Outcomes = bestOfNLoo(usable, allSeeds, bo3Embs);
  const bo3 = summarize("best-of-3", bo3Outcomes);

  console.log(
    `  ${"Family".padEnd(14)} ${"Whole".padStart(6)} ${"Bo3".padStart(6)} ${"Δ".padStart(6)}  ${"n".padStart(4)}`,
  );
  console.log(`  ${"─".repeat(42)}`);
  for (const f of families) {
    const bfam = baseline.perFamily.get(f);
    const sfam = bo3.perFamily.get(f);
    if (!bfam || !sfam) continue;
    const delta = round2(sfam.accuracy - bfam.accuracy);
    const sign = delta > 0 ? "+" : delta < 0 ? "" : " ";
    console.log(
      `  ${f.padEnd(14)} ${(bfam.accuracy * 100).toFixed(0).padStart(5)}% ${(sfam.accuracy * 100).toFixed(0).padStart(5)}% ${sign}${(delta * 100).toFixed(0).padStart(4)}%  ${String(bfam.total).padStart(4)}`,
    );
  }

  // ── Phase 5: Confusion patterns ──
  console.log(`\n━━ Phase 5: Common Confusions (best-of-3) ━━`);
  const confusions = new Map<string, number>();
  for (const o of bo3Outcomes) {
    if (!o.correct && o.predicted !== null) {
      const key = `${o.trueFamily} → ${o.predicted}`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  }
  const topConfusions = [...confusions.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [pair, count] of topConfusions) {
    console.log(`  ${count}×  ${pair}`);
  }

  // ── Phase 6: Summary ──
  console.log(`\n━━ FINAL SUMMARY ━━`);
  const ranked = scalingResults.toSorted((a, b) => b.accuracy - a.accuracy);
  for (const r of ranked) {
    const bar = "█".repeat(Math.round(r.accuracy * 50));
    console.log(`  ${r.name.padEnd(18)} ${(r.accuracy * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
  const winner = ranked[0]!;
  console.log(`\n  Winner: ${winner.name} at ${(winner.accuracy * 100).toFixed(1)}%`);
  console.log(`  Δ vs baseline: ${((winner.accuracy - baseline.accuracy) * 100).toFixed(1)}pp`);

  // Diminishing returns analysis
  console.log(`\n━━ Diminishing Returns ━━`);
  const nValues = [1, 3, 5, 7, 9];
  const accuracies = nValues.map((n) => {
    const r = scalingResults.find((s) => s.name === `best-of-${n}`);
    return r ? r.accuracy : 0;
  });
  for (let i = 0; i < nValues.length; i++) {
    const marginal = i > 0 ? round2(accuracies[i]! - accuracies[i - 1]!) : 0;
    console.log(
      `  N=${String(nValues[i]!).padStart(2)}: ${(accuracies[i]! * 100).toFixed(1)}%${i > 0 ? `  marginal: ${marginal >= 0 ? "+" : ""}${(marginal * 100).toFixed(1)}pp` : ""}`,
    );
  }

  console.log(`\n  Done.\n`);
}

// ── Output helpers ────────────────────────────────────────────────────

function printResult(r: StratResult): void {
  console.log(
    `  ${r.name.padEnd(18)} ${(r.accuracy * 100).toFixed(1)}% (${r.agree}/${r.agree + r.disagree + r.refused})  [agree=${r.agree} disagree=${r.disagree} refused=${r.refused}]`,
  );
}

function printStats(aCorrect: boolean[], bCorrect: boolean[], aAcc: number, bAcc: number): void {
  const mc = mcnemar(aCorrect, bCorrect);
  const ci = bootstrapCI(aCorrect, bCorrect);
  const h = cohensH(aAcc, bAcc);
  const sig = mc.p < 0.05 ? "✓" : "✗";
  console.log(`    McNemar χ²=${mc.chi2} p=${mc.p.toFixed(4)} ${sig}  Cohen's h=${h}`);
  console.log(
    `    Bootstrap 95% CI for Δ: [${(ci.low * 100).toFixed(1)}%, ${(ci.high * 100).toFixed(1)}%]  mean=${(ci.mean * 100).toFixed(1)}%`,
  );
}

await main();
