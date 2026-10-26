/**
 * ak1-loader.test.ts — Tests for AK1 external gold loaders (B6.1).
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrateBenchTables } from "./store";
import {
  loadGiantStepsTempo,
  loadGiantStepsKey,
  loadEdm98Structure,
  loadAllAK1,
} from "./ak1-loader";

const tmpDir = join(import.meta.dir, "__test_ak1_fixtures__");

beforeAll(() => {
  mkdirSync(join(tmpDir, "giantsteps-tempo"), { recursive: true });
  mkdirSync(join(tmpDir, "giantsteps-key"), { recursive: true });
  mkdirSync(join(tmpDir, "edm-98"), { recursive: true });

  writeFileSync(join(tmpDir, "giantsteps-tempo", "1001.bpm"), "128.0\n");
  writeFileSync(join(tmpDir, "giantsteps-tempo", "1002.bpm"), "174.5\n");
  writeFileSync(join(tmpDir, "giantsteps-tempo", "bad.bpm"), "not-a-number\n");

  writeFileSync(join(tmpDir, "giantsteps-key", "1001.key"), "0\n"); // C major
  writeFileSync(join(tmpDir, "giantsteps-key", "1002.key"), "14\n"); // D minor
  writeFileSync(join(tmpDir, "giantsteps-key", "bad.key"), "99\n");

  writeFileSync(
    join(tmpDir, "edm-98", "track1.txt"),
    "0.0\t15.5\tintro\n15.5\t45.0\tbuildup\n45.0\t90.0\tdrop\n",
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadGiantStepsTempo", () => {
  test("loads valid BPM annotations", () => {
    const db = new Database(":memory:");
    migrateBenchTables(db);
    const result = loadGiantStepsTempo(db, join(tmpDir, "giantsteps-tempo"));
    expect(result.loaded).toBe(2);
    expect(result.errors).toBe(1); // bad.bpm

    const rows = db
      .query("SELECT * FROM answer_keys WHERE field = 'bpm' AND key_id = 'AK1'")
      .all() as { track_id: string; value: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.track_id === "giantsteps:1001")!.value).toBe("128");
    db.close();
  });

  test("returns zeros for missing directory", () => {
    const db = new Database(":memory:");
    migrateBenchTables(db);
    expect(loadGiantStepsTempo(db, "/nonexistent")).toEqual({ loaded: 0, errors: 0 });
    db.close();
  });
});

describe("loadGiantStepsKey", () => {
  test("loads valid key annotations", () => {
    const db = new Database(":memory:");
    migrateBenchTables(db);
    const result = loadGiantStepsKey(db, join(tmpDir, "giantsteps-key"));
    expect(result.loaded).toBe(2);
    expect(result.errors).toBe(1); // bad.key (99 not in map)

    const rows = db
      .query("SELECT * FROM answer_keys WHERE field = 'key' AND key_id = 'AK1'")
      .all() as { track_id: string; value: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.track_id === "giantsteps:1001")!.value).toBe("C major");
    expect(rows.find((r) => r.track_id === "giantsteps:1002")!.value).toBe("D minor");
    db.close();
  });
});

describe("loadEdm98Structure", () => {
  test("loads structure annotations", () => {
    const db = new Database(":memory:");
    migrateBenchTables(db);
    const result = loadEdm98Structure(db, join(tmpDir, "edm-98"));
    expect(result.loaded).toBe(1);

    const rows = db.query("SELECT * FROM answer_keys WHERE field = 'structure'").all() as {
      track_id: string;
      value: string;
    }[];
    expect(rows).toHaveLength(1);
    const sections = JSON.parse(rows[0]!.value) as { label: string }[];
    expect(sections).toHaveLength(3);
    expect(sections[0]!.label).toBe("intro");
    db.close();
  });
});

describe("loadAllAK1", () => {
  test("loads all datasets from base dir", () => {
    const db = new Database(":memory:");
    migrateBenchTables(db);
    const result = loadAllAK1(db, tmpDir);
    expect(result.tempo.loaded).toBe(2);
    expect(result.key.loaded).toBe(2);
    expect(result.structure.loaded).toBe(1);
    expect(result.total).toBe(5);
    db.close();
  });
});
