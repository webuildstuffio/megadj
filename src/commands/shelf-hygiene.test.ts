import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { HygieneStore } from "../hygiene/store";
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
  const db = mkdtempSync("/tmp/megadj-hygiene-cmdb-") + "/archive.db";
  return { vol, db };
}

/** Capture stdout (the --json object goes there) while the human log
 *  goes to stderr via opts.log → captured separately. */
async function run(
  opts: Record<string, unknown>,
): Promise<{ parsed: Record<string, unknown>; code: number }> {
  let out = "";
  const orig: typeof console.log = console.log;
  console.log = (s: string) => (out += s + "\n");
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
    const id = store.list({ status: "open" })[0]!.id;
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
    const db = mkdtempSync("/tmp/megadj-hygiene-multidb-") + "/archive.db";
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
      .sort((a, b) => a.before - b.before);
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
});
