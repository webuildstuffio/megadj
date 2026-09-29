/**
 * bench/stages/key.ts — key detection accuracy bench.
 *
 * Grades OpenKeyScan key analysis against answer keys:
 * - AK2 (rekordbox): exact match + MIREX weighted score
 * - AK1 (GiantSteps Key / GiantSteps+): same metrics on external gold
 *
 * Gate (§6): ≥ baseline on AK1 (exact and MIREX weighted); report vs AK2.
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface KeyRow {
  video_id: string;
  key: string;
}

interface AKRow {
  track_id: string;
  value: string;
}

/** MIREX key scoring: exact=1, fifth=0.5, relative=0.3, parallel=0.2, else=0. */
const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

function parseKey(
  raw: string,
): { pitch: number; mode: "major" | "minor" } | null {
  const norm = raw.trim().replace(/\s+/gu, " ");
  for (let i = 0; i < PITCH_CLASSES.length; i++) {
    const pc = PITCH_CLASSES[i]!;
    if (norm.startsWith(pc)) {
      const suffix = norm.slice(pc.length).trim().toLowerCase();
      if (suffix === "" || suffix === "major" || suffix === "maj") {
        return { pitch: i, mode: "major" };
      }
      if (suffix === "m" || suffix === "minor" || suffix === "min") {
        return { pitch: i, mode: "minor" };
      }
    }
  }
  const flat = norm.replace("b", "♭");
  for (let i = 0; i < PITCH_CLASSES.length; i++) {
    const pc = PITCH_CLASSES[i]!;
    const flatPc = pc.replace("#", "♭");
    if (flat.startsWith(flatPc)) {
      const suffix = flat.slice(flatPc.length).trim().toLowerCase();
      if (suffix === "" || suffix === "major" || suffix === "maj") {
        return { pitch: (i + 11) % 12, mode: "major" };
      }
      if (suffix === "m" || suffix === "minor" || suffix === "min") {
        return { pitch: (i + 11) % 12, mode: "minor" };
      }
    }
  }
  return null;
}

function mirexScore(truth: string, pred: string): number {
  const t = parseKey(truth);
  const p = parseKey(pred);
  if (!t || !p) return 0;
  if (t.pitch === p.pitch && t.mode === p.mode) return 1.0; // exact
  const interval = (p.pitch - t.pitch + 12) % 12;
  if (interval === 7 && t.mode === p.mode) return 0.5; // fifth
  if (interval === 5 && t.mode === p.mode) return 0.5; // fourth (inverse fifth)
  if (
    t.mode === "major" &&
    p.mode === "minor" &&
    (t.pitch + 9) % 12 === p.pitch
  )
    return 0.3; // relative
  if (
    t.mode === "minor" &&
    p.mode === "major" &&
    (t.pitch + 3) % 12 === p.pitch
  )
    return 0.3; // relative
  if (t.pitch === p.pitch && t.mode !== p.mode) return 0.2; // parallel
  return 0;
}

function runKeyStage(
  db: Database,
  answerKey: string,
  _split: BenchSplit,
): StageResult {
  const keys = db
    .query("SELECT video_id, key FROM track_keys")
    .all() as KeyRow[];

  const benchRows: BenchRow[] = [];
  const metrics: Record<string, number | string | null> = {
    n_tracks: keys.length,
  };

  const akIds = answerKey === "all" ? ["AK1", "AK2"] : [answerKey];
  for (const akId of akIds) {
    const ak = db
      .query(
        `SELECT track_id, value FROM answer_keys
         WHERE key_id = ? AND field = 'key'`,
      )
      .all(akId) as AKRow[];
    const truthMap = new Map(ak.map((r) => [r.track_id, r.value]));
    let exact = 0;
    let mirexSum = 0;
    let matched = 0;
    for (const k of keys) {
      const truth = truthMap.get(k.video_id);
      if (!truth) continue;
      matched++;
      const score = mirexScore(truth, k.key);
      mirexSum += score;
      if (score === 1.0) exact++;
      benchRows.push({
        runId: "",
        trackId: k.video_id,
        truth,
        pred: k.key,
        conf: null,
        correct: score === 1.0 ? 1 : 0,
      });
    }
    const prefix = akId.toLowerCase();
    metrics[`${prefix}_matched`] = matched;
    metrics[`${prefix}_exact`] = matched > 0 ? round4(exact / matched) : null;
    metrics[`${prefix}_mirex`] =
      matched > 0 ? round4(mirexSum / matched) : null;
  }

  return {
    stage: "key",
    answerKey,
    rows: benchRows,
    metrics,
    configHash: "key-v1",
  };
}

registerStage("key", runKeyStage);
