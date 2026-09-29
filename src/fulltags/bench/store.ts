/**
 * bench/store.ts — persistence layer for bench runs, per-track outcomes,
 * and answer keys. Uses the archive.db ledger (same connection as
 * ArchiveState) via additive migrations.
 *
 * Tables: bench_runs, bench_rows, answer_keys (§3.2 of the rebench plan).
 */
import type { Database } from "bun:sqlite";
import type {
  AnswerKeyRow,
  BenchRow,
  BenchRun,
  BenchSplit,
  BenchStage,
} from "./types";

/** Run the bench table migrations on an open archive.db connection. */
export function migrateBenchTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bench_runs (
      run_id      TEXT PRIMARY KEY,
      stage       TEXT NOT NULL,
      answer_key  TEXT NOT NULL,
      split       TEXT NOT NULL DEFAULT 'eval',
      git_sha     TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      n           INTEGER NOT NULL,
      metrics     TEXT NOT NULL,
      ci          TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bench_rows (
      run_id   TEXT NOT NULL,
      track_id TEXT NOT NULL,
      truth    TEXT NOT NULL,
      pred     TEXT NOT NULL,
      conf     REAL,
      correct  INTEGER NOT NULL,
      PRIMARY KEY (run_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS answer_keys (
      key_id          TEXT NOT NULL,
      track_id        TEXT NOT NULL,
      field           TEXT NOT NULL,
      value           TEXT NOT NULL,
      confidence      REAL,
      source_of_truth TEXT NOT NULL,
      split           TEXT NOT NULL DEFAULT 'eval',
      evidence        TEXT,
      created_at      TEXT NOT NULL,
      PRIMARY KEY (key_id, track_id, field)
    );
  `);
}

/** Generate a ULID-like run id (timestamp prefix + random suffix). */
export function generateRunId(): string {
  const now = Date.now().toString(36).padStart(9, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

/** Insert a bench run + its per-track rows in a transaction. */
export function insertBenchRun(
  db: Database,
  run: BenchRun,
  rows: readonly BenchRow[],
): void {
  const tx = db.transaction(() => {
    db.query(
      `INSERT INTO bench_runs (run_id, stage, answer_key, split, git_sha, config_hash, n, metrics, ci, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.runId,
      run.stage,
      run.answerKey,
      run.split,
      run.gitSha,
      run.configHash,
      run.n,
      JSON.stringify(run.metrics),
      run.ci !== null ? JSON.stringify(run.ci) : null,
      run.createdAt,
    );
    const stmt = db.query(
      `INSERT INTO bench_rows (run_id, track_id, truth, pred, conf, correct)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      stmt.run(r.runId, r.trackId, r.truth, r.pred, r.conf, r.correct);
    }
  });
  tx();
}

/** Load a bench run by id. */
export function loadBenchRun(db: Database, runId: string): BenchRun | null {
  const row = db
    .query("SELECT * FROM bench_runs WHERE run_id = ?")
    .get(runId) as {
    run_id: string;
    stage: string;
    answer_key: string;
    split: string;
    git_sha: string;
    config_hash: string;
    n: number;
    metrics: string;
    ci: string | null;
    created_at: string;
  } | null;
  if (!row) return null;
  return {
    runId: row.run_id,
    stage: row.stage as BenchStage,
    answerKey: row.answer_key,
    split: row.split as BenchSplit,
    gitSha: row.git_sha,
    configHash: row.config_hash,
    n: row.n,
    metrics: JSON.parse(row.metrics) as Record<string, number | string | null>,
    ci:
      row.ci !== null
        ? (JSON.parse(row.ci) as Record<string, [number, number]>)
        : null,
    createdAt: row.created_at,
  };
}

/** Load per-track rows for a run. */
export function loadBenchRows(db: Database, runId: string): BenchRow[] {
  const rows = db
    .query("SELECT * FROM bench_rows WHERE run_id = ?")
    .all(runId) as {
    run_id: string;
    track_id: string;
    truth: string;
    pred: string;
    conf: number | null;
    correct: number;
  }[];
  return rows.map((r) => ({
    runId: r.run_id,
    trackId: r.track_id,
    truth: r.truth,
    pred: r.pred,
    conf: r.conf,
    correct: r.correct as 0 | 1,
  }));
}

/** List runs for a stage, newest first. */
export function listBenchRuns(
  db: Database,
  stage?: BenchStage,
  limit = 20,
): BenchRun[] {
  const query = stage
    ? "SELECT * FROM bench_runs WHERE stage = ? ORDER BY created_at DESC LIMIT ?"
    : "SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT ?";
  const params = stage ? [stage, limit] : [limit];
  const rows = db.query(query).all(...params) as {
    run_id: string;
    stage: string;
    answer_key: string;
    split: string;
    git_sha: string;
    config_hash: string;
    n: number;
    metrics: string;
    ci: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    runId: r.run_id,
    stage: r.stage as BenchStage,
    answerKey: r.answer_key,
    split: r.split as BenchSplit,
    gitSha: r.git_sha,
    configHash: r.config_hash,
    n: r.n,
    metrics: JSON.parse(r.metrics) as Record<string, number | string | null>,
    ci:
      r.ci !== null
        ? (JSON.parse(r.ci) as Record<string, [number, number]>)
        : null,
    createdAt: r.created_at,
  }));
}

/** Insert or replace answer-key rows. */
export function upsertAnswerKeys(
  db: Database,
  rows: readonly AnswerKeyRow[],
): void {
  const stmt = db.query(
    `INSERT OR REPLACE INTO answer_keys (key_id, track_id, field, value, confidence, source_of_truth, split, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.keyId,
        r.trackId,
        r.field,
        r.value,
        r.confidence,
        r.sourceOfTruth,
        r.split,
        r.evidence,
        r.createdAt,
      );
    }
  });
  tx();
}

/** Load answer-key rows for a specific key and field. */
export function loadAnswerKeys(
  db: Database,
  keyId: string,
  field?: string,
): AnswerKeyRow[] {
  const query = field
    ? "SELECT * FROM answer_keys WHERE key_id = ? AND field = ?"
    : "SELECT * FROM answer_keys WHERE key_id = ?";
  const params = field ? [keyId, field] : [keyId];
  const rows = db.query(query).all(...params) as {
    key_id: string;
    track_id: string;
    field: string;
    value: string;
    confidence: number | null;
    source_of_truth: string;
    split: string;
    evidence: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    keyId: r.key_id,
    trackId: r.track_id,
    field: r.field,
    value: r.value,
    confidence: r.confidence,
    sourceOfTruth: r.source_of_truth,
    split: r.split as BenchSplit,
    evidence: r.evidence,
    createdAt: r.created_at,
  }));
}
