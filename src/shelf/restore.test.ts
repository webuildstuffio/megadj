import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../core/hygiene/store";
import {
  detectAndApply,
  hygieneShelfFixture,
  type HygieneFixture,
} from "../test-support/hygiene-fixture";
import { shelfRestore } from "./restore";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-restore-shelf-").rippable();
const t2 = tempDir("megadj-restore-db-").rippable();
const t3 = tempDir("megadj-restore-target-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
  t3.rippleAll();
});

function fixtureMd5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

function fixture(): HygieneFixture {
  return hygieneShelfFixture(t, t2);
}

describe("restore command", () => {
  test("restores by finding id, verifies MD5, and preserves the quarantine source", async () => {
    const f = fixture();
    const id = await detectAndApply(f, fixtureMd5);
    expect(existsSync(f.loser)).toBe(false);
    const result = await shelfRestore({
      input: id,
      shelfVolume: f.shelf,
      dbPath: f.db,
      log: () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.findingId).toBe(id);
    expect(existsSync(f.loser)).toBe(true);
    expect(readFileSync(f.loser, "utf8")).toBe("same bytes");
    expect(existsSync(result.source!)).toBe(true);
  });

  test("accepts the ledger-owned quarantine path and --into target", async () => {
    const f = fixture();
    await detectAndApply(f, fixtureMd5);
    const db = new Database(f.db);
    const store = new HygieneStore(db);
    const finding = store.get(store.list({ status: "applied" })[0]!.id)!;
    db.close();
    const target = t3.dir();
    const source = join(
      f.shelf,
      ".hygiene-quarantine",
      "Artist · track copy.mp3",
    );
    const result = await shelfRestore({
      input: source,
      shelfVolume: f.shelf,
      into: target,
      dbPath: f.db,
      log: () => {},
    });
    expect(result.findingId).toBe(finding.id);
    expect(result.ok).toBe(true);
    expect(result.destination).toBe(
      join(target, "Contents", "Artist", "track copy.mp3"),
    );
    expect(existsSync(result.destination!)).toBe(true);
    expect(existsSync(source)).toBe(true);
  });

  test("refuses an existing destination and an in-flight hygiene operation", async () => {
    const f = fixture();
    const id = await detectAndApply(f, fixtureMd5);
    writeFileSync(f.loser, "do not overwrite");
    const collision = await shelfRestore({
      input: id,
      shelfVolume: f.shelf,
      dbPath: f.db,
      log: () => {},
    });
    expect(collision.ok).toBe(false);
    expect(collision.error).toContain("destination exists");
    expect(readFileSync(f.loser, "utf8")).toBe("do not overwrite");

    const db = new Database(f.db);
    const store = new HygieneStore(db);
    expect(store.acquireOperation("test-owner")).toBe(true);
    try {
      const refused = await shelfRestore({
        input: id,
        shelfVolume: f.shelf,
        dbPath: f.db,
        log: () => {},
      });
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain("already in flight");
    } finally {
      store.releaseOperation("test-owner");
      db.close();
    }
  });
});
