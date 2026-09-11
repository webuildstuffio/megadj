import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../archive/hygiene/store";
import { shelfHygiene } from "./shelf-hygiene";
import { shelfRestore } from "./shelf-restore";

function fixture(): { shelf: string; db: string; loser: string } {
  const shelf = mkdtempSync("/tmp/megadj-restore-shelf-");
  const dir = join(shelf, "Contents", "Artist");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "track.mp3"), "same bytes");
  const loser = join(dir, "track copy.mp3");
  writeFileSync(loser, "same bytes");
  const db = join(mkdtempSync("/tmp/megadj-restore-db-"), "archive.db");
  return { shelf, db, loser };
}

async function detectAndApply(f: ReturnType<typeof fixture>): Promise<string> {
  await shelfHygiene({ shelfVolume: f.shelf, dbPath: f.db, log: () => {} });
  const store = new HygieneStore(new Database(f.db));
  const finding = store.list({ status: "open" })[0];
  if (!finding) throw new Error("fixture did not produce a finding");
  expect(store.decide(finding.id, true)).toBe(true);
  await shelfHygiene({
    shelfVolume: f.shelf,
    dbPath: f.db,
    apply: true,
    yes: true,
    log: () => {},
  });
  return finding.id;
}

describe("shelf-restore command", () => {
  test("restores by finding id, verifies MD5, and preserves the quarantine source", async () => {
    const f = fixture();
    const id = await detectAndApply(f);
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
    await detectAndApply(f);
    const store = new HygieneStore(new Database(f.db));
    const finding = store.get(store.list({ status: "applied" })[0]!.id)!;
    const target = mkdtempSync("/tmp/megadj-restore-target-");
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
    const id = await detectAndApply(f);
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

    const store = new HygieneStore(new Database(f.db));
    expect(store.acquireOperation("test-owner")).toBe(true);
    const refused = await shelfRestore({
      input: id,
      shelfVolume: f.shelf,
      dbPath: f.db,
      log: () => {},
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("already in flight");
    store.releaseOperation("test-owner");
  });
});
