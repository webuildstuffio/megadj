// quarantine.test.ts — #35/#36 pins: the census counts only REAL
// recoverable copies (stale rows reported, never counted), the empty
// deletes + flips applied → archived (receipt kept), the lease is
// honored, and keepers are never touched. Fixture rides the same
// detect → confirm → apply harness restore.test.ts uses.
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../archive/hygiene/store";
import {
  detectAndApply,
  hygieneShelfFixture,
  type HygieneFixture,
} from "../test-support/hygiene-fixture";
import { shelfQuarantineCensus, shelfQuarantineEmpty } from "./quarantine";

const t = tempDir("megadj-quarantine-shelf-").rippable();
const t2 = tempDir("megadj-quarantine-db-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
});

function fixtureMd5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

function fixture(): HygieneFixture {
  return hygieneShelfFixture(t, t2);
}

describe("quarantine census (#36)", () => {
  test("counts the applied copy: N files / X bytes; keeper untouched", async () => {
    const f = fixture();
    await detectAndApply(f, fixtureMd5);
    const r = await shelfQuarantineCensus({
      dbPath: f.db,
      shelfVolume: f.shelf,
    });
    expect(r.ok).toBe(true);
    expect(r.files).toBe(1);
    expect(r.bytes).toBe("same bytes".length);
    expect(r.stale).toBe(0);
    expect(existsSync(f.keeper)).toBe(true);
  });

  test("an empty quarantine answers zeros (missing dir is zeros, not error)", async () => {
    const f = fixture(); // no scan/apply — no quarantine dir at all
    const r = await shelfQuarantineCensus({
      dbPath: f.db,
      shelfVolume: f.shelf,
    });
    expect(r).toMatchObject({ ok: true, files: 0, bytes: 0, stale: 0 });
  });
});

describe("quarantine empty (#36)", () => {
  test("deletes the copy, flips applied → archived, keeps the receipt", async () => {
    const f = fixture();
    const id = await detectAndApply(f, fixtureMd5);
    const qFile = join(
      f.shelf,
      ".hygiene-quarantine",
      "Artist · track copy.mp3",
    );
    expect(existsSync(qFile)).toBe(true);

    const r = await shelfQuarantineEmpty({
      dbPath: f.db,
      shelfVolume: f.shelf,
    });
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(1);
    expect(r.failed).toEqual([]);
    expect(existsSync(qFile)).toBe(false);
    expect(existsSync(f.keeper)).toBe(true);

    // the ledger keeps the row + its receipt, status archived
    const db = new Database(f.db);
    try {
      const row = new HygieneStore(db).get(id)!;
      expect(row.status).toBe("archived");
      expect(row.validation?.ok).toBe(true);
    } finally {
      db.close();
    }
    // the census agrees: nothing recoverable remains
    const after = await shelfQuarantineCensus({
      dbPath: f.db,
      shelfVolume: f.shelf,
    });
    expect(after.files).toBe(0);
  });

  test("honors the operation lease — a concurrent apply blocks the empty", async () => {
    const f = fixture();
    await detectAndApply(f, fixtureMd5);
    const db = new Database(f.db);
    const store = new HygieneStore(db);
    expect(store.acquireOperation("other-op")).toBe(true);
    try {
      const r = await shelfQuarantineEmpty({
        dbPath: f.db,
        shelfVolume: f.shelf,
      });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("already in flight");
      // the copy survived the refused empty
      expect(
        existsSync(
          join(f.shelf, ".hygiene-quarantine", "Artist · track copy.mp3"),
        ),
      ).toBe(true);
    } finally {
      store.releaseOperation("other-op");
      db.close();
    }
  });
});
