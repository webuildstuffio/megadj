import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  generateRunId,
  insertBenchRun,
  listBenchRuns,
  loadAnswerKeys,
  loadBenchRows,
  loadBenchRun,
  migrateBenchTables,
  upsertAnswerKeys,
} from "./store";
import type { AnswerKeyRow, BenchRow, BenchRun } from "./types";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateBenchTables(db);
  return db;
}

describe("migrateBenchTables", () => {
  test("creates all three tables", () => {
    const db = freshDb();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bench_%' OR name = 'answer_keys' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).toSorted();
    expect(names).toEqual(["answer_keys", "bench_rows", "bench_runs"]);
    db.close();
  });

  test("idempotent — second call is a no-op", () => {
    const db = freshDb();
    expect(() => migrateBenchTables(db)).not.toThrow();
    db.close();
  });
});

describe("generateRunId", () => {
  test("returns a string with timestamp prefix", () => {
    const id = generateRunId();
    expect(typeof id).toBe("string");
    expect(id.includes("-")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });

  test("two calls produce different ids", () => {
    expect(generateRunId()).not.toBe(generateRunId());
  });
});

describe("insertBenchRun + loadBenchRun", () => {
  test("round-trip", () => {
    const db = freshDb();
    const run: BenchRun = {
      runId: "test-run-1",
      stage: "mood",
      answerKey: "distribution",
      split: "eval",
      gitSha: "abc123",
      configHash: "config1",
      n: 3,
      metrics: { fire_rate_dance: 0.85, fire_rate_happy: 0.12 },
      ci: { fire_rate_dance: [0.8, 0.9] },
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    const rows: BenchRow[] = [
      {
        runId: "test-run-1",
        trackId: "t1",
        truth: "high",
        pred: "high",
        conf: 0.9,
        correct: 1,
      },
      {
        runId: "test-run-1",
        trackId: "t2",
        truth: "low",
        pred: "high",
        conf: 0.6,
        correct: 0,
      },
      {
        runId: "test-run-1",
        trackId: "t3",
        truth: "high",
        pred: "high",
        conf: 0.8,
        correct: 1,
      },
    ];
    insertBenchRun(db, run, rows);
    const loaded = loadBenchRun(db, "test-run-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.stage).toBe("mood");
    expect(loaded!.n).toBe(3);
    expect(loaded!.metrics.fire_rate_dance).toBe(0.85);
    expect(loaded!.ci!.fire_rate_dance).toEqual([0.8, 0.9]);
    const loadedRows = loadBenchRows(db, "test-run-1");
    expect(loadedRows).toHaveLength(3);
    expect(loadedRows.filter((r) => r.correct === 1)).toHaveLength(2);
    db.close();
  });

  test("missing run returns null", () => {
    const db = freshDb();
    expect(loadBenchRun(db, "nonexistent")).toBeNull();
    db.close();
  });
});

describe("listBenchRuns", () => {
  test("newest first, filterable by stage", () => {
    const db = freshDb();
    const base = {
      answerKey: "AK2",
      split: "eval" as const,
      gitSha: "abc",
      configHash: "c1",
      n: 10,
      metrics: {},
      ci: null,
    };
    insertBenchRun(
      db,
      { ...base, runId: "r1", stage: "bpm", createdAt: "2026-09-01" },
      [],
    );
    insertBenchRun(
      db,
      { ...base, runId: "r2", stage: "mood", createdAt: "2026-09-02" },
      [],
    );
    insertBenchRun(
      db,
      { ...base, runId: "r3", stage: "bpm", createdAt: "2026-09-03" },
      [],
    );
    const all = listBenchRuns(db);
    expect(all).toHaveLength(3);
    expect(all[0]!.runId).toBe("r3");
    const bpmOnly = listBenchRuns(db, "bpm");
    expect(bpmOnly).toHaveLength(2);
    expect(bpmOnly[0]!.runId).toBe("r3");
    db.close();
  });
});

describe("upsertAnswerKeys + loadAnswerKeys", () => {
  test("round-trip with field filter", () => {
    const db = freshDb();
    const rows: AnswerKeyRow[] = [
      {
        keyId: "AK2",
        trackId: "t1",
        field: "bpm",
        value: "128.0",
        confidence: null,
        sourceOfTruth: "rekordbox",
        split: "eval",
        evidence: null,
        createdAt: "2026-09-29",
      },
      {
        keyId: "AK2",
        trackId: "t1",
        field: "key",
        value: "Am",
        confidence: null,
        sourceOfTruth: "rekordbox",
        split: "eval",
        evidence: null,
        createdAt: "2026-09-29",
      },
    ];
    upsertAnswerKeys(db, rows);
    const all = loadAnswerKeys(db, "AK2");
    expect(all).toHaveLength(2);
    const bpmOnly = loadAnswerKeys(db, "AK2", "bpm");
    expect(bpmOnly).toHaveLength(1);
    expect(bpmOnly[0]!.value).toBe("128.0");
    db.close();
  });

  test("upsert replaces existing row", () => {
    const db = freshDb();
    const row: AnswerKeyRow = {
      keyId: "AK1",
      trackId: "t1",
      field: "bpm",
      value: "120.0",
      confidence: null,
      sourceOfTruth: "giantsteps",
      split: "eval",
      evidence: null,
      createdAt: "2026-09-01",
    };
    upsertAnswerKeys(db, [row]);
    upsertAnswerKeys(db, [{ ...row, value: "121.0", createdAt: "2026-09-02" }]);
    const loaded = loadAnswerKeys(db, "AK1", "bpm");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.value).toBe("121.0");
    db.close();
  });
});
