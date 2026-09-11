import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../archive/hygiene/store";
import { shelfHygiene } from "./shelf-hygiene";

/** byte-twin fixture: two identical + one unique file, no fpcalc needed
 *  (byte-twin is md5-only — the whole suite runs without chromaprint). */
function shelf(): { vol: string; db: string } {
  const vol = mkdtempSync("/tmp/megadj-hygiene-cmd-");
  const w = (rel: string, c: string) => {
    const abs = join(vol, "Contents", rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, c);
  };
  w("Artist A/song.mp3", "IDENTICAL");
  w("Artist A/song copy.mp3", "IDENTICAL");
  w("Artist B/other.mp3", "DIFFERENT");
  const db = join(mkdtempSync("/tmp/megadj-hygiene-cmdb-"), "archive.db");
  return { vol, db };
}

/** Capture stdout (the --json object goes there) while the human log
 *  goes to stderr via opts.log → captured separately. */
async function run(
  opts: Record<string, unknown>,
): Promise<{ parsed: Record<string, unknown>; code: number }> {
  let out = "";
  const orig: typeof console.log = console.log;
  console.log = (s: string) => (out += `${s}\n`);
  let code = 0;
  try {
    await shelfHygiene({
      json: true,
      log: () => {},
      ...opts,
    });
  } finally {
    console.log = orig;
    code = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.exitCode = 0; // sticky-exit trap: reset or the SUITE exits 1
  }
  return { parsed: JSON.parse(out.trim()) as Record<string, unknown>, code };
}

describe("shelf-hygiene command", () => {
  test("detect: one summary object, byte-twin found, ledger written", async () => {
    const { vol, db } = shelf();
    const { parsed, code } = await run({ shelfVolume: vol, dbPath: db });
    expect(code).toBe(0);
    expect(parsed.command).toBe("shelf-hygiene");
    expect(parsed.scanned).toBe(3);
    expect((parsed.byKind as Record<string, number>)["byte-twin"]).toBe(1);
    expect(parsed.open).toBe(1);
    // ledger is real: a second engine reads the same row
    const store = new HygieneStore(new Database(db));
    expect(store.list({ kind: "byte-twin" }).length).toBe(1);
  });

  test("re-run is idempotent (same census, no duplicate rows)", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    const second = await run({ shelfVolume: vol, dbPath: db });
    expect(second.parsed.written).toBe(0);
    expect(second.parsed.detected).toBe(1);
    const store = new HygieneStore(new Database(db));
    expect(store.list().length).toBe(1);
  });

  test("apply without --yes is refused with zero work (two-step safety)", async () => {
    const { vol, db } = shelf();
    const { parsed, code } = await run({
      shelfVolume: vol,
      dbPath: db,
      apply: true,
    });
    expect(code).toBe(1);
    expect(parsed.error).toContain("--yes");
    expect(existsSync(join(vol, "Contents", "Artist A", "song copy.mp3"))).toBe(
      true,
    );
  });

  test("apply moves only CONFIRMED findings; receipts land on the row", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    const store = new HygieneStore(new Database(db));
    const { id } = store.list({ status: "open" })[0]!;
    expect(store.decide(id, true)).toBe(true);
    const { parsed } = await run({
      shelfVolume: vol,
      dbPath: db,
      apply: true,
      yes: true,
    });
    expect(parsed.applied).toBe(1);
    const got = store.get(id)!;
    expect(got.status).toBe("applied");
    expect(got.validation?.ok).toBe(true);
    // loser quarantined, keeper intact — never deleted
    expect(existsSync(join(vol, "Contents", "Artist A", "song copy.mp3"))).toBe(
      false,
    );
    expect(existsSync(join(vol, ".hygiene-quarantine"))).toBe(true);
    expect(existsSync(join(vol, "Contents", "Artist A", "song.mp3"))).toBe(
      true,
    );
  });

  test("MULTI-apply: every receipt is green with delta 1 (no cumulative drift)", async () => {
    // two independent byte-twin pairs — the second receipt must measure
    // its own move, not "everything moved so far"
    const vol = mkdtempSync("/tmp/megadj-hygiene-multi-");
    const w = (rel: string, c: string) => {
      const abs = join(vol, "Contents", rel);
      mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
      writeFileSync(abs, c);
    };
    w("Artist A/one.mp3", "PAIR-ONE");
    w("Artist A/one copy.mp3", "PAIR-ONE");
    w("Artist B/two.mp3", "PAIR-TWO");
    w("Artist B/two copy.mp3", "PAIR-TWO");
    w("Artist C/unique.mp3", "UNIQUE");
    const db = join(mkdtempSync("/tmp/megadj-hygiene-multidb-"), "archive.db");
    await run({ shelfVolume: vol, dbPath: db });
    const store = new HygieneStore(new Database(db));
    const opens = store.list({ status: "open" });
    expect(opens.length).toBe(2);
    for (const f of opens) expect(store.decide(f.id, true)).toBe(true);
    const { parsed } = await run({
      shelfVolume: vol,
      dbPath: db,
      apply: true,
      yes: true,
    });
    expect(parsed.applied).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(parsed.applyErrors).toEqual([]);
    for (const f of opens) {
      const got = store.get(f.id)!;
      expect(got.status).toBe("applied");
      // BOTH receipts: exactly one file quarantined against the apply
      // baseline — a cumulative count (quarantined: 2 on the second)
      // fails this and flips the row to `failed`
      expect(got.validation?.ok).toBe(true);
      const d = got.validation!.shelfDelta;
      expect(d.quarantined).toBe(1);
      expect(d.after).toBe(d.before - 1);
    }
    // the two receipts tile the apply leg: one saw 5→4, the other 4→3
    const deltas = opens
      .map((f) => store.get(f.id)!.validation!.shelfDelta)
      .toSorted((a, b) => a.before - b.before);
    expect(deltas[0]).toEqual({ before: 4, after: 3, quarantined: 1 });
    expect(deltas[1]).toEqual({ before: 5, after: 4, quarantined: 1 });
    expect(existsSync(join(vol, "Contents", "Artist A", "one copy.mp3"))).toBe(
      false,
    );
    expect(existsSync(join(vol, "Contents", "Artist B", "two copy.mp3"))).toBe(
      false,
    );
  });

  test("unconfirmed findings never move on --apply --yes", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db }); // detect, no confirm
    const { parsed } = await run({
      shelfVolume: vol,
      dbPath: db,
      apply: true,
      yes: true,
    });
    expect(parsed.applied).toBe(0);
    expect(existsSync(join(vol, "Contents", "Artist A", "song copy.mp3"))).toBe(
      true,
    );
  });

  test("unmounted shelf is a clean error, exit 1", async () => {
    const { db } = shelf();
    const { parsed, code } = await run({
      shelfVolume: "/Volumes/definitely-not-here",
      dbPath: db,
    });
    expect(code).toBe(1);
    expect(parsed.error).toContain("not mounted");
  });

  // ---- bucket batch-confirm (--bucket, the acoustic subcategory slice)

  test("bucket confirm: matches only the requested subcategory", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    // seed two acoustic-twin rows with different subcategories
    const store = new HygieneStore(new Database(db));
    const now = new Date().toISOString();
    const mk = (sub: string, p: string) =>
      store.upsert([
        {
          id: `test-${sub}-${p.length}`,
          kind: "acoustic-twin",
          severity: "likely",
          status: "open",
          paths: [`/V/Contents/A/${p}`, `/V/Contents/A/${p} 2.mp3`],
          bytes: [4_000_000, 4_010_000],
          md5s: [null, null],
          fps: ["fp", "fp"],
          evidence: { subcategory: sub, sizeDeltaBytes: 10_000 },
          proposedAction: { type: "quarantine-loser" },
          keeperPath: `/V/Contents/A/${p}`,
          walkToken: "tok",
          autoSafe: false,
          createdAt: now,
          decidedAt: null,
          appliedAt: null,
          validation: null,
        },
      ]);
    mk("metadata-diff", "m.mp3");
    mk("quality-diff", "q.mp3");

    const { parsed } = await run({
      shelfVolume: vol,
      dbPath: db,
      bucket: "metadata-diff",
    });
    expect(parsed.bucketMatched).toBe(1);
    const subs = store
      .list({ status: "confirmed" })
      .map((f) => (f.evidence as Record<string, unknown>).subcategory);
    expect(subs).toContain("metadata-diff");
    expect(subs).not.toContain("quality-diff");
  });

  test("bucket confirm: composite bucket (safe-batch) matches both safe subcategories", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    const store = new HygieneStore(new Database(db));
    const now = new Date().toISOString();
    const mk = (sub: string, name: string) =>
      store.upsert([
        {
          id: `sb-${sub}-${name}`,
          kind: "acoustic-twin",
          severity: "likely",
          status: "open",
          paths: [`/V/Contents/A/${name}`, `/V/Contents/A/${name} 2.mp3`],
          bytes: [4_000_000, 4_010_000],
          md5s: [null, null],
          fps: ["fp", "fp"],
          evidence: { subcategory: sub },
          proposedAction: { type: "quarantine-loser" },
          keeperPath: `/V/Contents/A/${name}`,
          walkToken: "tok",
          autoSafe: false,
          createdAt: now,
          decidedAt: null,
          appliedAt: null,
          validation: null,
        },
      ]);
    mk("metadata-diff", "a.mp3");
    mk("re-encode", "b.mp3");
    mk("quality-diff", "c.mp3");

    const { parsed } = await run({
      shelfVolume: vol,
      dbPath: db,
      bucket: "safe-batch",
    });
    // safe-batch = metadata-diff + re-encode; quality-diff waits
    expect(parsed.bucketMatched).toBe(2);
    const confirmed = store.list({ status: "confirmed" });
    expect(confirmed.length).toBe(2);
    const subs = confirmed.map(
      (f) => (f.evidence as Record<string, unknown>).subcategory,
    );
    expect(subs).not.toContain("quality-diff");
  });

  test("bucket confirm: unknown bucket name fails with zero work", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    const { parsed, code } = await run({
      shelfVolume: vol,
      dbPath: db,
      bucket: "not-a-bucket",
    });
    expect(code).toBe(1);
    expect(parsed.error).toContain("unknown bucket");
    const store = new HygieneStore(new Database(db));
    expect(store.list({ status: "confirmed" }).length).toBe(0);
  });

  // Sep 11 super-sure: a live probe proved `--bucket quality-diff` silently
  // confirmed 94 UNREVIEWED findings — the listen-first refusal the docs
  // promised never shipped. These tests pin the guard at the engine.
  test("bucket confirm: listen-first buckets refuse with zero work", async () => {
    const { vol, db } = shelf();
    await run({ shelfVolume: vol, dbPath: db });
    const now = Date.now();
    const store0 = new HygieneStore(new Database(db));
    for (const sub of ["quality-diff", "oddball"]) {
      const name = `${sub}.mp3`;
      store0.upsert([
        {
          id: `f-${sub}`,
          kind: "acoustic-twin",
          severity: "likely",
          status: "open",
          paths: [`/V/Contents/A/${name}`, `/V/Contents/A/${name} 2.mp3`],
          bytes: [4_000_000, 4_010_000],
          md5s: [null, null],
          fps: ["fp", "fp"],
          evidence: { subcategory: sub },
          proposedAction: { type: "quarantine-loser" },
          keeperPath: `/V/Contents/A/${name}`,
          walkToken: "tok",
          autoSafe: false,
          createdAt: new Date(now).toISOString(),
          decidedAt: null,
          appliedAt: null,
          validation: null,
        },
      ]);
    }
    for (const bucket of ["quality-diff", "oddball", "ear-check"]) {
      const { parsed, code } = await run({
        shelfVolume: vol,
        dbPath: db,
        bucket,
      });
      expect(code).toBe(1);
      expect(parsed.error).toContain("listen-first");
      // zero work — the ledger is byte-for-byte unchanged (the fixture's
      // detection pass also leaves one open byte-twin row; refusal must
      // not touch ANY status, not just acoustic ones)
      const store = new HygieneStore(new Database(db));
      expect(store.list({ status: "confirmed" }).length).toBe(0);
      expect(store.list({ status: "open" }).length).toBe(3); // 2 seeded + 1 detected
      expect(store.list({ status: "dismissed" }).length).toBe(0);
    }
  });
});
