/**
 * fetch-estimator.ts — Dawid-Skene batch estimator wiring (#443/#447).
 *
 * After the vote ladder runs on each track and evidence is bridged,
 * this module runs the Dawid-Skene EM algorithm ONCE over all evidence
 * and persists genre_vector (full posterior distribution) back to
 * tracks.
 *
 * Flag-gated: MEGADJ_GENRE_ESTIMATOR=1 enables. Default is off
 * (falls back to the legacy vote path).
 */
import type { Database } from "bun:sqlite";
import {
  loadEvidenceBatch,
  migrateEvidenceTable,
} from "../evidence/evidence-store";
import { dawidSkene, type Annotation } from "../genre/dawid-skene";
import { GENRE_FAMILIES } from "../genre/taxonomy-v3";
import { round3 } from "../../shared/leaf/fmt";

/** Whether the estimator is enabled (re-exported for pipeline import). */
export function estimatorEnabled(): boolean {
  return process.env["MEGADJ_GENRE_ESTIMATOR"] === "1";
}

/** Serialize the posterior distribution for the genre_vector column.
 *  Format: JSON object { family: probability } — only entries above
 *  0.001 are stored to keep the blob compact. */
function serializeVector(dist: ReadonlyMap<string, number>): string {
  const obj: Record<string, number> = {};
  for (const [family, prob] of dist) {
    if (prob >= 0.001) {
      obj[family] = round3(prob);
    }
  }
  return JSON.stringify(obj);
}

/**
 * Run the Dawid-Skene estimator over ALL tracks with evidence and
 * persist genre_vector to the tracks table.
 *
 * Called once per fetch run, after all per-track votes and evidence
 * bridging are complete. The full-batch approach lets the model learn
 * annotator reliability from the entire evidence corpus.
 */
export function runEstimatorBatch(db: Database): void {
  migrateEvidenceTable(db);
  // Ensure genre_vector column exists (safe to re-run)
  try {
    db.exec("ALTER TABLE tracks ADD COLUMN genre_vector TEXT");
  } catch {
    // Column already exists — expected path
  }

  // Load all track IDs that have evidence
  const trackRows = db
    .query("SELECT DISTINCT track_id FROM genre_evidence")
    .all() as { track_id: string }[];
  const trackIds = trackRows.map((r) => r.track_id);
  if (trackIds.length === 0) return;

  // Load all evidence and convert to Dawid-Skene annotations
  const evidenceMap = loadEvidenceBatch(db, trackIds);
  const annotations: Annotation[] = [];
  for (const [trackId, rows] of evidenceMap) {
    for (const e of rows) {
      annotations.push({
        trackId,
        annotatorId: e.annotatorId,
        label: e.genreFamily,
      });
    }
  }
  if (annotations.length === 0) return;

  // Run Dawid-Skene EM
  const result = dawidSkene(annotations, [...GENRE_FAMILIES]);

  // Persist genre_vector for each track
  const stmt = db.prepare(
    "UPDATE tracks SET genre_vector = ? WHERE video_id = ?",
  );
  let written = 0;
  for (const posterior of result.posteriors) {
    const vec = serializeVector(posterior.distribution);
    stmt.run(vec, posterior.trackId);
    written++;
  }

  if (written > 0) {
    process.stderr.write(
      `  estimator: ${written} genre vectors from ${annotations.length} annotations (${result.iterations} EM iters, ${result.converged ? "converged" : "max-iter"})\n`,
    );
  }
}

/** Parse a stored genre_vector back to a Map (for display/query). */
export function parseGenreVector(
  raw: string | null,
): ReadonlyMap<string, number> | null {
  if (raw === null || raw === "") return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return null;
    }
    const map = new Map<string, number>();
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val)) {
        map.set(key, val);
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}
