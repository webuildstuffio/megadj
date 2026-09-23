// dump-ledger.test.ts — #20's ledger pins: same-day dumps stay distinct,
// re-ingest of a done dump is a safe no-op flip, partial→done resumes,
// and the census counts. The natural key IS the batch folder — a dump
// that re-runs must never fork a second row (#20 acceptance).
import { describe, expect, test } from "bun:test";
import { openLedger } from "../shared/sqlite-ledger";
import { DumpLedger } from "./dump-ledger";

function freshLedger(): DumpLedger {
  const db = openLedger(":memory:", { create: true });
  return new DumpLedger(db);
}

describe("DumpLedger (#20)", () => {
  test("two dumps on the same day stay distinct (own folder slugs)", () => {
    const l = freshLedger();
    l.record({
      folder: "2026-09-09 new dump",
      sourceFolder: "/Downloads/new dump sept 9",
      ingested: 17,
      duplicates: 1,
      pending: 0,
      lastError: null,
    });
    l.record({
      folder: "2026-09-09 bandcamp haul",
      sourceFolder: "/Downloads/bandcamp",
      ingested: 5,
      duplicates: 0,
      pending: 0,
      lastError: null,
    });
    const c = l.census();
    expect(c.counts.total).toBe(2);
    expect(c.counts.done).toBe(2);
    expect(l.get("2026-09-09 new dump")?.ingested).toBe(17);
    expect(l.get("2026-09-09 bandcamp haul")?.ingested).toBe(5);
  });

  test("re-ingesting the same dump UPSERTS (no second row), keeps created_at", () => {
    const l = freshLedger();
    l.record({
      folder: "2026-09-09 new dump",
      sourceFolder: "/Downloads/new dump sept 9",
      ingested: 17,
      duplicates: 0,
      pending: 1,
      lastError: "zip hold",
    });
    const before = l.get("2026-09-09 new dump")!;
    // re-run: the pending file landed, no new files
    l.record({
      folder: "2026-09-09 new dump",
      sourceFolder: "/Downloads/new dump sept 9",
      ingested: 18,
      duplicates: 0,
      pending: 0,
      lastError: null,
    });
    const c = l.census();
    expect(c.counts.total).toBe(1);
    const after = l.get("2026-09-09 new dump")!;
    expect(after.status).toBe("done");
    expect(after.ingested).toBe(18);
    expect(after.createdAt).toBe(before.createdAt);
  });

  test("pending > 0 records as partial — the 17/18 outcome is representable", () => {
    const l = freshLedger();
    l.record({
      folder: "2026-09-09 new dump",
      sourceFolder: "/x",
      ingested: 17,
      duplicates: 0,
      pending: 1,
      lastError: "1 file lost",
    });
    const d = l.get("2026-09-09 new dump")!;
    expect(d.status).toBe("partial");
    expect(d.lastError).toBe("1 file lost");
    expect(l.census().counts.partial).toBe(1);
  });

  test("census counts partial/done/pending and orders newest-first", () => {
    const l = freshLedger();
    l.record({
      folder: "d1",
      sourceFolder: "/a",
      ingested: 1,
      duplicates: 0,
      pending: 0,
      lastError: null,
    });
    l.record({
      folder: "d2",
      sourceFolder: "/b",
      ingested: 2,
      duplicates: 1,
      pending: 3,
      lastError: "broken files",
    });
    const c = l.census();
    expect(c.counts).toEqual({ total: 2, partial: 1, done: 1, pending: 3 });
    expect(c.dumps[0]!.folder).toBe("d2"); // updated later → newest first
  });
});
