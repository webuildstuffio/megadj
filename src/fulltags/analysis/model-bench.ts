/**
 * model-bench.ts — Compare embedding models for section-based genre inference.
 *
 * Uses the proven best-of-3 strategy; tests 5 models:
 *   1. effnet-discogs-1280 (incumbent)
 *   2. vggish-128
 *   3. msd-musicnn-200
 *   4. openl3-music-512
 *   5. maest-10s-768
 *
 * Each model is evaluated LOO within the sample (same model for seeds+queries).
 * Also computes silhouette scores for embedding quality.
 *
 * Usage: bun src/fulltags/analysis/model-bench.ts [--sample=50]
 */

import { Database } from "bun:sqlite";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { genreFamily } from "../../core/similar";
import { findDropCandidates } from "./drop-finder";
import { round2 } from "../../shared/leaf/fmt";

const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

const CHECKPOINT_PATH = "/tmp/model-bench-checkpoint.jsonl";

const ALL_MODELS = [
  "effnet-discogs-1280",
  "vggish-128",
  "msd-musicnn-200",
  "openl3-music-512",
  "maest-10s-768",
] as const;

type ModelName = (typeof ALL_MODELS)[number];

const MODEL_DIMS: Record<ModelName, number> = {
  "effnet-discogs-1280": 1280,
  "vggish-128": 128,
  "msd-musicnn-200": 200,
  "openl3-music-512": 512,
  "maest-10s-768": 768,
};

interface SampleTrack {
  videoId: string;
  title: string | null;
  genre: string;
  family: string;
  filePath: string;
  downbeats: number[];
  durationS: number | null;
  voteCount: number;
}

interface Section {
  start: number;
  end: number;
}

// ── Data loading ──────────────────────────────────────────────────────

function loadSample(db: Database, sampleSize: number): SampleTrack[] {
  const rows = db
    .query(
      `SELECT t.video_id, t.title, t.genre, t.file_path, t.duration_s,
              b.downbeats_json, t.genre_votes
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
    downbeats_json: string;
    genre_votes: string | null;
  }[];

  return rows.flatMap((r) => {
    try {
      const downbeats: unknown = JSON.parse(r.downbeats_json);
      if (!Array.isArray(downbeats) || downbeats.length < 16) return [];
      if (!existsSync(r.file_path)) return [];
      const family = genreFamily(r.genre);
      if (family === null) return [];
      let voteCount = 0;
      if (r.genre_votes) {
        try {
          const votes: unknown = JSON.parse(r.genre_votes);
          if (Array.isArray(votes)) {
            voteCount = votes.filter(
              (v: unknown) =>
                v !== null &&
                typeof v === "object" &&
                "genre" in (v as Record<string, unknown>),
            ).length;
          }
        } catch {
          /* corrupt votes — treat as 0 */
        }
      }
      return [
        {
          videoId: r.video_id,
          title: r.title,
          genre: r.genre,
          family,
          filePath: r.file_path,
          downbeats: downbeats as number[],
          durationS: r.duration_s,
          voteCount,
        },
      ];
    } catch {
      return [];
    }
  });
}

// ── kNN helpers ────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function isZeroVec(v: number[]): boolean {
  return v.every((x) => x === 0);
}

/** LOO kNN within a set of tracks. Best-of-N: try all section embeddings,
 * pick the one with highest kNN agreement. */
function looKnn(
  tracks: SampleTrack[],
  embeddings: (number[] | null)[][],
  k: number,
  _minAgreement: number,
): {
  correct: number;
  total: number;
  outcomes: boolean[];
  predictions: (string | null)[];
  perFamily: Map<string, { correct: number; total: number }>;
} {
  let correct = 0;
  const outcomes: boolean[] = [];
  const predictions: (string | null)[] = [];
  const perFamily = new Map<string, { correct: number; total: number }>();

  for (let i = 0; i < tracks.length; i++) {
    const held = tracks[i]!;
    const heldEmbs = embeddings[i]!.filter(
      (e): e is number[] => e !== null && !isZeroVec(e),
    );

    const fam = perFamily.get(held.family) ?? { correct: 0, total: 0 };
    fam.total++;

    if (heldEmbs.length === 0) {
      outcomes.push(false);
      predictions.push(null);
      perFamily.set(held.family, fam);
      continue;
    }

    let bestPrediction: string | null = null;
    let bestAgreement = 0;

    for (const queryVec of heldEmbs) {
      const scored: { family: string; sim: number }[] = [];
      for (let j = 0; j < tracks.length; j++) {
        if (j === i) continue;
        const other = tracks[j]!;
        const otherEmbs = embeddings[j]!.filter(
          (e): e is number[] => e !== null && !isZeroVec(e),
        );
        let bestSim = -Infinity;
        for (const otherVec of otherEmbs) {
          const sim = cosine(queryVec, otherVec);
          if (sim > bestSim) bestSim = sim;
        }
        if (bestSim > -Infinity) {
          scored.push({ family: other.family, sim: bestSim });
        }
      }
      scored.sort((a, b) => b.sim - a.sim);
      const topK = scored.slice(0, k);
      if (topK.length === 0) continue;

      const votes = new Map<string, number>();
      for (const s of topK) {
        votes.set(s.family, (votes.get(s.family) ?? 0) + 1);
      }
      const winner = [...votes.entries()].toSorted((a, b) => b[1] - a[1])[0]!;
      const agreement = winner[1] / topK.length;
      if (agreement > bestAgreement) {
        bestAgreement = agreement;
        bestPrediction = winner[0];
      }
    }

    const isCorrect = bestPrediction === held.family;
    if (isCorrect) {
      correct++;
      fam.correct++;
    }
    outcomes.push(isCorrect);
    predictions.push(bestPrediction);
    perFamily.set(held.family, fam);
  }

  return { correct, total: tracks.length, outcomes, predictions, perFamily };
}

/** Retrieval precision@k: for each track, what fraction of k nearest
 * neighbors (by best section cosine) share the same family? */
function retrievalPrecision(
  tracks: SampleTrack[],
  embeddings: (number[] | null)[][],
  k: number,
): number {
  const precisions: number[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const held = tracks[i]!;
    const heldEmbs = embeddings[i]!.filter(
      (e): e is number[] => e !== null && !isZeroVec(e),
    );
    if (heldEmbs.length === 0) continue;

    const scored: { family: string; sim: number }[] = [];
    for (let j = 0; j < tracks.length; j++) {
      if (j === i) continue;
      const other = tracks[j]!;
      const otherEmbs = embeddings[j]!.filter(
        (e): e is number[] => e !== null && !isZeroVec(e),
      );
      let bestSim = -Infinity;
      for (const queryVec of heldEmbs) {
        for (const otherVec of otherEmbs) {
          const sim = cosine(queryVec, otherVec);
          if (sim > bestSim) bestSim = sim;
        }
      }
      if (bestSim > -Infinity) {
        scored.push({ family: other.family, sim: bestSim });
      }
    }
    scored.sort((a, b) => b.sim - a.sim);
    const topK = scored.slice(0, k);
    const sameFamily = topK.filter((s) => s.family === held.family).length;
    precisions.push(sameFamily / topK.length);
  }

  return precisions.length > 0
    ? precisions.reduce((s, v) => s + v, 0) / precisions.length
    : 0;
}

/** Intra/inter-class cosine gap: mean(intra) - mean(inter).
 * Positive = genre clusters are separable. */
function cosineGap(
  tracks: SampleTrack[],
  embeddings: (number[] | null)[][],
): { intra: number; inter: number; gap: number } {
  const intraSims: number[] = [];
  const interSims: number[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const eI = embeddings[i]?.find(
      (e): e is number[] => e !== null && !isZeroVec(e),
    );
    if (!eI) continue;
    for (let j = i + 1; j < tracks.length; j++) {
      const eJ = embeddings[j]?.find(
        (e): e is number[] => e !== null && !isZeroVec(e),
      );
      if (!eJ) continue;
      const sim = cosine(eI, eJ);
      if (tracks[i]!.family === tracks[j]!.family) {
        intraSims.push(sim);
      } else {
        interSims.push(sim);
      }
    }
  }

  const intra =
    intraSims.length > 0
      ? intraSims.reduce((s, v) => s + v, 0) / intraSims.length
      : 0;
  const inter =
    interSims.length > 0
      ? interSims.reduce((s, v) => s + v, 0) / interSims.length
      : 0;
  return {
    intra: round2(intra),
    inter: round2(inter),
    gap: round2(intra - inter),
  };
}

// ── Silhouette score ──────────────────────────────────────────────────

function silhouetteScore(
  tracks: SampleTrack[],
  embeddings: (number[] | null)[][],
): number {
  const scores: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const emb = embeddings[i]?.find(
      (e): e is number[] => e !== null && !isZeroVec(e),
    );
    if (!emb) continue;
    const family = tracks[i]!.family;

    const intraDists: number[] = [];
    const interDists = new Map<string, number[]>();

    for (let j = 0; j < tracks.length; j++) {
      if (j === i) continue;
      const other = embeddings[j]?.find(
        (e): e is number[] => e !== null && !isZeroVec(e),
      );
      if (!other) continue;
      const dist = 1 - cosine(emb, other);
      const otherFamily = tracks[j]!.family;
      if (otherFamily === family) {
        intraDists.push(dist);
      } else {
        const arr = interDists.get(otherFamily) ?? [];
        arr.push(dist);
        interDists.set(otherFamily, arr);
      }
    }

    if (intraDists.length === 0 || interDists.size === 0) continue;
    const a = intraDists.reduce((s, d) => s + d, 0) / intraDists.length;
    let minInterMean = Infinity;
    for (const dists of interDists.values()) {
      const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
      if (mean < minInterMean) minInterMean = mean;
    }
    const s = (minInterMean - a) / Math.max(a, minInterMean);
    scores.push(s);
  }
  return scores.length > 0
    ? scores.reduce((s, v) => s + v, 0) / scores.length
    : 0;
}

// ── Macro-F1 ──────────────────────────────────────────────────────────

function macroF1(
  trueFamilies: string[],
  predictions: (string | null)[],
): number {
  const classes = [...new Set(trueFamilies)];
  let f1Sum = 0;
  for (const cls of classes) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < trueFamilies.length; i++) {
      if (predictions[i] === cls && trueFamilies[i] === cls) tp++;
      else if (predictions[i] === cls && trueFamilies[i] !== cls) fp++;
      else if (predictions[i] !== cls && trueFamilies[i] === cls) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;
    f1Sum += f1;
  }
  return classes.length > 0 ? f1Sum / classes.length : 0;
}

// ── McNemar ────────────────────────────────────────────────────────────

function mcnemar(
  a: boolean[],
  b: boolean[],
): { chi2: number; p: number; sig: boolean } {
  let bc = 0;
  let cb = 0;
  for (let i = 0; i < a.length; i++) {
    if (b[i] && !a[i]) bc++;
    if (a[i] && !b[i]) cb++;
  }
  const n = bc + cb;
  if (n === 0) return { chi2: 0, p: 1, sig: false };
  const chi2 = (Math.abs(bc - cb) - 1) ** 2 / n;
  const p = 1 - (2 * normalCdf(Math.sqrt(chi2)) - 1);
  return { chi2: round2(chi2), p, sig: p < 0.05 };
}

function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * z);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return x < 0 ? 0.5 * (1 - y) : 0.5 * (1 + y);
}

// ── Checkpoint/streaming helpers ──────────────────────────────────────

interface CheckpointEntry {
  model: string;
  embeddings: Record<string, (number[] | null)[]>;
  timestamp: string;
}

function loadCheckpoint(): Map<string, Record<string, (number[] | null)[]>> {
  const loaded = new Map<string, Record<string, (number[] | null)[]>>();
  if (!existsSync(CHECKPOINT_PATH)) return loaded;
  try {
    const lines = readFileSync(CHECKPOINT_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    for (const line of lines) {
      const entry = JSON.parse(line) as CheckpointEntry;
      loaded.set(entry.model, entry.embeddings);
    }
    process.stderr.write(`  Loaded ${loaded.size} model(s) from checkpoint\n`);
  } catch {
    /* corrupt checkpoint — start fresh */
  }
  return loaded;
}

function writeCheckpointEntry(
  model: string,
  embeddings: Record<string, (number[] | null)[]>,
): void {
  const entry: CheckpointEntry = {
    model,
    embeddings,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(CHECKPOINT_PATH, `${JSON.stringify(entry)}\n`);
}

// ── Python bridge ──────────────────────────────────────────────────────

interface ManifestTrack {
  path: string;
  sections: Section[];
}

async function computeModelEmbeddings(
  tracks: SampleTrack[],
  models: string[],
): Promise<Map<string, (number[] | null)[][]>> {
  const manifest: ManifestTrack[] = tracks.map((t) => {
    const candidates = findDropCandidates(t.downbeats, 3, t.durationS);
    return {
      path: t.filePath,
      sections: candidates.map((c) => ({ start: c.startSec, end: c.endSec })),
    };
  });

  const checkpoint = loadCheckpoint();
  const result = new Map<string, (number[] | null)[][]>();

  for (const model of models) {
    // Check if already computed (kill resilience)
    const cached = checkpoint.get(model);
    if (cached) {
      process.stderr.write(`  [${model}] restored from checkpoint\n`);
      const trackEmbs: (number[] | null)[][] = tracks.map((t) => {
        const embs = cached[t.filePath];
        if (!embs) return [null, null, null];
        return embs.map((e) =>
          e !== null && !e.every((v) => v === 0) ? e : null,
        );
      });
      result.set(model, trackEmbs);
      continue;
    }

    const manifestJson = JSON.stringify({
      tracks: manifest,
      models: [model],
    });
    const tmpManifest = join("/tmp", `model-bench-${model}-${Date.now()}.json`);
    writeFileSync(tmpManifest, manifestJson);

    process.stderr.write(`  [${model}] spawning Python...\n`);
    const t0 = Date.now();

    const proc = Bun.spawn(
      [
        "uv",
        "run",
        "--with",
        "essentia",
        "--with",
        "onnxruntime",
        "--with",
        "numpy",
        "python",
        "tools/section_model_bench.py",
      ],
      {
        stdin: Bun.file(tmpManifest),
        stdout: "pipe",
        stderr: "inherit",
      },
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      process.stderr.write(
        `  [${model}] FAILED (exit ${exitCode}) — skipping\n`,
      );
      continue;
    }

    process.stderr.write(
      `  [${model}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
    );

    const raw = JSON.parse(output) as Record<
      string,
      Record<string, number[][]>
    >;
    const modelData = raw[model];
    if (!modelData) continue;

    // Stream result to checkpoint file (kill resilience)
    writeCheckpointEntry(model, modelData);

    const trackEmbs: (number[] | null)[][] = tracks.map((t) => {
      const embs = modelData[t.filePath];
      if (!embs) return [null, null, null];
      return embs.map((e) => (e.every((v) => v === 0) ? null : e));
    });
    result.set(model, trackEmbs);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sampleSize = parseInt(
    process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? "50",
    10,
  );

  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  Model Comparison Bench — Section Embeddings   ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);

  const db = new Database(DB_PATH, { readonly: true });
  const sample = loadSample(db, sampleSize).slice(0, sampleSize);
  db.close();

  const families = [...new Set(sample.map((t) => t.family))].toSorted();
  const familyCounts = new Map<string, number>();
  for (const t of sample) {
    familyCounts.set(t.family, (familyCounts.get(t.family) ?? 0) + 1);
  }

  console.log(`  Sample: ${sample.length} tracks`);
  console.log(
    `  Families: ${families.map((f) => `${f}(${familyCounts.get(f)})`).join(", ")}\n`,
  );

  const models = [...ALL_MODELS];
  const allEmbs = await computeModelEmbeddings(sample, models);

  console.log(
    `\n━━ Results: LOO kNN + Retrieval Precision (k=5, best-of-3) ━━\n`,
  );
  console.log(
    `  ${"Model".padEnd(22)} ${"kNN".padStart(5)} ${"mF1".padStart(5)} ${"P@5".padStart(5)} ${"Gap".padStart(6)} ${"Silh".padStart(6)} ${"Dim".padStart(5)}`,
  );
  console.log(`  ${"─".repeat(61)}`);

  const modelResults: {
    model: string;
    accuracy: number;
    macroF1: number;
    precision: number;
    gap: number;
    silhouette: number;
    dim: number;
    outcomes: boolean[];
    perFamily: Map<string, { correct: number; total: number }>;
  }[] = [];

  for (const model of models) {
    const embs = allEmbs.get(model);
    if (!embs) {
      console.log(`  ${model.padEnd(22)}  [skipped — no embeddings]`);
      continue;
    }

    const {
      correct,
      total,
      outcomes,
      predictions: preds,
      perFamily,
    } = looKnn(sample, embs, 5, 0.6);
    const accuracy = total > 0 ? correct / total : 0;
    const trueFamilies = sample.map((s) => s.family);
    const mf1 = macroF1(trueFamilies, preds);
    const precision = retrievalPrecision(sample, embs, 5);
    const gapData = cosineGap(sample, embs);
    const sil = silhouetteScore(sample, embs);
    const dim = MODEL_DIMS[model as ModelName];

    console.log(
      `  ${model.padEnd(22)} ${(accuracy * 100).toFixed(0).padStart(4)}% ${(mf1 * 100).toFixed(0).padStart(4)}% ${(precision * 100).toFixed(0).padStart(4)}% ${gapData.gap.toFixed(3).padStart(6)} ${sil.toFixed(3).padStart(6)} ${String(dim).padStart(5)}`,
    );

    modelResults.push({
      model,
      accuracy,
      macroF1: mf1,
      precision,
      gap: gapData.gap,
      silhouette: sil,
      dim,
      outcomes,
      perFamily,
    });
  }

  // McNemar pairwise vs incumbent (effnet) with Holm correction
  const incumbent = modelResults.find((m) => m.model === "effnet-discogs-1280");
  if (incumbent) {
    console.log(
      `\n━━ McNemar vs Incumbent (effnet-discogs-1280) — Holm-corrected ━━\n`,
    );
    const pairs: {
      model: string;
      mc: ReturnType<typeof mcnemar>;
      delta: number;
    }[] = [];
    for (const challenger of modelResults) {
      if (challenger.model === incumbent.model) continue;
      const mc = mcnemar(incumbent.outcomes, challenger.outcomes);
      pairs.push({
        model: challenger.model,
        mc,
        delta: round2(challenger.accuracy - incumbent.accuracy),
      });
    }
    const m = pairs.length;
    const sorted = pairs.toSorted((a, b) => a.mc.p - b.mc.p);
    for (let i = 0; i < sorted.length; i++) {
      const pair = sorted[i]!;
      const holmThreshold = 0.05 / (m - i);
      const sig = pair.mc.p < holmThreshold;
      const sign = pair.delta >= 0 ? "+" : "";
      console.log(
        `  ${pair.model.padEnd(22)} ${sign}${(pair.delta * 100).toFixed(1)}pp  χ²=${pair.mc.chi2} p=${pair.mc.p.toFixed(4)} holm<${holmThreshold.toFixed(3)} ${sig ? "✓" : "✗"}`,
      );
    }
  }

  // Per-family breakdown for top 3 models
  console.log(`\n━━ Per-Family kNN Accuracy (top 3 models) ━━\n`);
  const top3 = modelResults
    .toSorted((a, b) => b.precision - a.precision)
    .slice(0, 3);
  const header = `  ${"Family".padEnd(12)} ${top3.map((m) => m.model.slice(0, 12).padStart(13)).join("")}`;
  console.log(header);
  console.log(`  ${"─".repeat(12 + top3.length * 13)}`);

  for (const fam of families) {
    const cells = top3.map((m) => {
      const pf = m.perFamily.get(fam);
      if (!pf || pf.total === 0) return "—".padStart(13);
      const acc = (pf.correct / pf.total) * 100;
      return `${acc.toFixed(0)}%`.padStart(13);
    });
    console.log(
      `  ${fam.padEnd(12)} ${cells.join("")}  (n=${familyCounts.get(fam) ?? 0})`,
    );
  }

  // Final ranking by macro-F1 (primary), P@5 (secondary)
  console.log(`\n━━ FINAL RANKING (by macro-F1, then P@5) ━━\n`);
  const ranked = modelResults.toSorted((a, b) => {
    const f1Diff = b.macroF1 - a.macroF1;
    if (Math.abs(f1Diff) > 0.01) return f1Diff;
    return b.precision - a.precision;
  });
  for (let i = 0; i < ranked.length; i++) {
    const m = ranked[i]!;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
    const bar = "█".repeat(Math.round(m.macroF1 * 30));
    console.log(
      `  ${medal} ${m.model.padEnd(22)} mF1=${(m.macroF1 * 100).toFixed(1)}% kNN=${(m.accuracy * 100).toFixed(0)}% P@5=${(m.precision * 100).toFixed(0)}% gap=${m.gap.toFixed(3)} ${m.dim}d  ${bar}`,
    );
  }

  console.log(`\n  Done.\n`);
}

await main();
