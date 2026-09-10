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
  const orig = console.log;
  console.log = (s) => (out += s + "\n");
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
    expect(existsSync(join(vol, "Contents", ".hygiene-quarantine"))).toBe(true);
    expect(existsSync(join(vol, "Contents", "Artist A", "song.mp3"))).toBe(
      true,
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
