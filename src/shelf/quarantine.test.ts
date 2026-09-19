// quarantine.test.ts — #35/#36 pins: the census counts only REAL
// recoverable copies (stale rows reported, never counted), the empty
// deletes + flips applied → archived (receipt kept), the lease is
// honored, and keepers are never touched. Fixture rides the same
// detect → confirm → apply harness restore.test.ts uses.
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFakeAudio } from "../test-support/audio-fixtures";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../archive/hygiene/store";
import { shelfHygiene } from "./hygiene";
import { shelfQuarantineCensus, shelfQuarantineEmpty } from "./quarantine";

const t = tempDir("megadj-quarantine-shelf-").rippable();
const t2 = tempDir("megadj-quarantine-db-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
});

function fixture(): {
  shelf: string;
  db: string;
  keeper: string;
  loser: string;
} {
  const shelf = t.dir();
  const dir = join(shelf, "Contents", "Artist");
  mkdirSync(dir, { recursive: true });
  const keeper = join(dir, "track.mp3");
  writeFakeAudio(keeper, "same bytes");
  const loser = join(dir, "track copy.mp3");
  writeFileSync(loser, "same bytes");
  const db = join(t2.dir(), "archive.db");
  return { shelf, db, keeper, loser };
}

function fixtureMd5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

async function detectAndApply(f: ReturnType<typeof fixture>): Promise<string> {
  await shelfHygiene({
    shelfVolume: f.shelf,
    dbPath: f.db,
    md5: fixtureMd5,
    log: () => {},
  });
  const db = new Database(f.db);
  const store = new HygieneStore(db);
  const finding = store.list({ status: "open" })[0];
  if (!finding) {
    db.close();
    throw new Error("fixture did not produce a finding");
  }
  try {
    expect(store.decide(finding.id, true)).toBe(true);
  } finally {
    db.close();
  }
  await shelfHygiene({
    shelfVolume: f.shelf,
    dbPath: f.db,
    md5: fixtureMd5,
    apply: true,
    yes: true,
    log: () => {},
  });
  const verifyDb = new Database(f.db);
  try {
    const applied = new HygieneStore(verifyDb).get(finding.id);
    if (applied?.status !== "applied")
      throw new Error(
        `fixture apply did not complete: ${applied?.status ?? "missing"}`,
      );
  } finally {
    verifyDb.close();
  }
  return finding.id;
}

describe("quarantine census (#36)", () => {
  test("counts the applied copy: N files / X bytes; keeper untouched", async () => {
    const f = fixture();
    await detectAndApply(f);
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
    const id = await detectAndApply(f);
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
    await detectAndApply(f);
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
