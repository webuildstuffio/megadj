/**
 * bench/ak1-loader.ts — AK1 loaders for external public gold sets (B6.1).
 *
 * Loads annotations from:
 * - GiantSteps Tempo dataset (BPM ground truth)
 * - GiantSteps Key dataset (key ground truth)
 * - GiantSteps+ EDM Key (EDM-specific key annotations)
 * - EDM-98 (structure labels from rekordbox cue points)
 *
 * These are loaded into the answer_keys table as AK1 entries.
 * Audio files referenced by the datasets are expected at a configurable path.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { upsertAnswerKeys } from "./store";
import type { AnswerKeyRow } from "./types";

const KEY_MAP: Record<string, string> = {
  "0": "C major",
  "1": "C# major",
  "2": "D major",
  "3": "D# major",
  "4": "E major",
  "5": "F major",
  "6": "F# major",
  "7": "G major",
  "8": "G# major",
  "9": "A major",
  "10": "A# major",
  "11": "B major",
  "12": "C minor",
  "13": "C# minor",
  "14": "D minor",
  "15": "D# minor",
  "16": "E minor",
  "17": "F minor",
  "18": "F# minor",
  "19": "G minor",
  "20": "G# minor",
  "21": "A minor",
  "22": "A# minor",
  "23": "B minor",
};

/**
 * Load GiantSteps Tempo annotations.
 * Expected format: one .bpm file per track, containing a single float.
 * File name = track ID (e.g. "1234.bpm" → track_id "giantsteps:1234").
 */
export function loadGiantStepsTempo(
  db: Database,
  annotationsDir: string,
): { loaded: number; errors: number } {
  if (!existsSync(annotationsDir)) return { loaded: 0, errors: 0 };

  const files = readdirSync(annotationsDir).filter((f) => f.endsWith(".bpm"));
  const rows: AnswerKeyRow[] = [];
  let errors = 0;

  for (const f of files) {
    const content = readFileSync(join(annotationsDir, f), "utf8").trim();
    const bpm = parseFloat(content);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      errors++;
      continue;
    }
    const trackId = `giantsteps:${basename(f, ".bpm")}`;
    rows.push({
      keyId: "AK1",
      trackId,
      field: "bpm",
      value: String(bpm),
      confidence: 1.0,
      sourceOfTruth: "giantsteps-tempo",
      split: "eval",
      evidence: `GiantSteps Tempo ${f}`,
      createdAt: new Date().toISOString(),
    });
  }

  upsertAnswerKeys(db, rows);
  return { loaded: rows.length, errors };
}

/**
 * Load GiantSteps Key annotations.
 * Expected format: one .key file per track, containing a numeric key ID (0-23).
 */
export function loadGiantStepsKey(
  db: Database,
  annotationsDir: string,
): { loaded: number; errors: number } {
  if (!existsSync(annotationsDir)) return { loaded: 0, errors: 0 };

  const files = readdirSync(annotationsDir).filter((f) => f.endsWith(".key"));
  const rows: AnswerKeyRow[] = [];
  let errors = 0;

  for (const f of files) {
    const content = readFileSync(join(annotationsDir, f), "utf8").trim();
    const keyName = KEY_MAP[content];
    if (keyName === undefined) {
      errors++;
      continue;
    }
    const trackId = `giantsteps:${basename(f, ".key")}`;
    rows.push({
      keyId: "AK1",
      trackId,
      field: "key",
      value: keyName,
      confidence: 1.0,
      sourceOfTruth: "giantsteps-key",
      split: "eval",
      evidence: `GiantSteps Key ${f} (${content} → ${keyName})`,
      createdAt: new Date().toISOString(),
    });
  }

  upsertAnswerKeys(db, rows);
  return { loaded: rows.length, errors };
}

/**
 * Load EDM-98 structure annotations.
 * Expected format: one .txt file per track with timestamped section labels.
 * Lines: "start_time\tend_time\tlabel" (e.g. "0.0\t15.5\tintro")
 */
export function loadEdm98Structure(
  db: Database,
  annotationsDir: string,
): { loaded: number; errors: number } {
  if (!existsSync(annotationsDir)) return { loaded: 0, errors: 0 };

  const files = readdirSync(annotationsDir).filter((f) => f.endsWith(".txt") || f.endsWith(".lab"));
  const rows: AnswerKeyRow[] = [];
  let errors = 0;

  for (const f of files) {
    const content = readFileSync(join(annotationsDir, f), "utf8").trim();
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const sections: { start: number; end: number; label: string }[] = [];

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 3) {
        errors++;
        continue;
      }
      const start = parseFloat(parts[0] ?? "");
      const end = parseFloat(parts[1] ?? "");
      const label = (parts[2] ?? "").trim().toLowerCase();
      if (!Number.isFinite(start) || !Number.isFinite(end) || label === "") {
        errors++;
        continue;
      }
      sections.push({ start, end, label });
    }

    if (sections.length === 0) continue;

    const trackId = `edm98:${basename(f, extname(f))}`;
    rows.push({
      keyId: "AK1",
      trackId,
      field: "structure",
      value: JSON.stringify(sections),
      confidence: 1.0,
      sourceOfTruth: "edm-98",
      split: "eval",
      evidence: `EDM-98 ${f}: ${sections.length} sections`,
      createdAt: new Date().toISOString(),
    });
  }

  upsertAnswerKeys(db, rows);
  return { loaded: rows.length, errors };
}

/**
 * Load all available AK1 datasets from a base directory.
 * Expected layout:
 *   <baseDir>/giantsteps-tempo/    (*.bpm files)
 *   <baseDir>/giantsteps-key/      (*.key files)
 *   <baseDir>/edm-98/              (*.txt or *.lab files)
 */
export function loadAllAK1(
  db: Database,
  baseDir: string,
): {
  tempo: { loaded: number; errors: number };
  key: { loaded: number; errors: number };
  structure: { loaded: number; errors: number };
  total: number;
} {
  const tempo = loadGiantStepsTempo(db, join(baseDir, "giantsteps-tempo"));
  const key = loadGiantStepsKey(db, join(baseDir, "giantsteps-key"));
  const structure = loadEdm98Structure(db, join(baseDir, "edm-98"));
  return { tempo, key, structure, total: tempo.loaded + key.loaded + structure.loaded };
}
