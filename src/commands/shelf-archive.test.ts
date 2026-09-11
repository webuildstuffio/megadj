import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { shelfArchive } from "./shelf-archive";

/**
 * shelf-archive: the drive → shelf intake sweep. Tests exercise the walk,
 * the junk filter, the coverage classes, and the never-overwrite guarantee
 * with temp "volumes" (plain dirs) — no real drives touched.
 */

function makeDrive(root: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

function makeShelf(files: Record<string, string> = {}): string {
  const vol = mkdtempSync("/tmp/megadj-sa-shelf-");
  mkdirSync(join(vol, "Contents"), { recursive: true });
  return makeDrive(vol, files);
}

const run = (opts: Partial<Parameters<typeof shelfArchive>[0]> = {}) =>
  shelfArchive({
    volumes: [],
    shelfVolume: mkdtempSync("/tmp/megadj-sa-empty-"),
    log: () => {},
    // ledger isolation: never touch the developer's real archive DB
    ledgerPath: mkdtempSync("/tmp/megadj-sa-ledger-") + "/state.db",
    ...opts,
  } as Parameters<typeof shelfArchive>[0]);

describe("shelf-archive", () => {
  test("copies fresh drive content into Contents/, preserving layout", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-drive-"), {
      "Contents/Artist/Album/track.mp3": "audio-bytes",
      "PIONEER REC/set.wav": "recording",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(
      existsSync(join(shelf, "Contents", "Artist", "Album", "track.mp3")),
    ).toBe(true);
    expect(existsSync(join(shelf, "Contents", "PIONEER REC", "set.wav"))).toBe(
      true,
    );
    expect(
      readFileSync(
        join(shelf, "Contents", "Artist", "Album", "track.mp3"),
        "utf8",
      ),
    ).toBe("audio-bytes");
  });

  test("skips AppleDouble/DS_Store junk and PIONEER device trees", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-junk-"), {
      "Contents/Artist/real.mp3": "x",
      "Contents/Artist/._real.mp3": "junk",
      "Contents/Artist/.DS_Store": "junk",
      "PIONEER/rekordbox/export.pdb": "device-db",
      "PIONEER/USBANLZ/xyz/ANLZ0000.DAT": "cache",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(existsSync(join(shelf, "Contents", "Artist", "real.mp3"))).toBe(
      true,
    );
    expect(existsSync(join(shelf, "Contents", "Artist", "._real.mp3"))).toBe(
      false,
    );
    expect(existsSync(join(shelf, "Contents", "export.pdb"))).toBe(false);
    expect(existsSync(join(shelf, "Contents", "ANLZ0000.DAT"))).toBe(false);
  });

  test("re-run is a no-op (idempotent coverage)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-rerun-"), {
      "Contents/A/one.mp3": "1",
      "Contents/A/two.mp3": "2",
    });
    const shelf = makeShelf();
    await run({ volumes: [drive], shelfVolume: shelf });
    await run({ volumes: [drive], shelfVolume: shelf });
    // no [drive] variant copies should exist after a clean re-run
    const listed = [
      ...new Bun.Glob("**/*").scanSync({ cwd: join(shelf, "Contents") }),
    ];
    expect(listed.filter((f) => f.includes("[")).length).toBe(0);
    expect(listed.filter((f) => f.endsWith(".mp3")).length).toBe(2);
  });

  test("case-variant names count as covered (exFAT is case-insensitive)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-case-"), {
      "Contents/ARTIST/song.MP3": "x",
    });
    const shelf = makeShelf({ "Contents/artist/Song.mp3": "x" });
    await run({ volumes: [drive], shelfVolume: shelf });
    const listed = [
      ...new Bun.Glob("**/*.mp3").scanSync({ cwd: join(shelf, "Contents") }),
    ];
    expect(listed).toHaveLength(1); // no duplicate written
  });

  test("same name + different size is preserved as <stem> [drive] copy — shelf original untouched", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-divergent-"), {
      "Contents/A/track.mp3": "drive-version-bytes",
    });
    const shelf = makeShelf({ "Contents/A/track.mp3": "shelf-original" });
    await run({ volumes: [drive], shelfVolume: shelf, suffix: "bang" });
    expect(
      readFileSync(join(shelf, "Contents", "A", "track.mp3"), "utf8"),
    ).toBe("shelf-original"); // NEVER overwritten
    expect(
      readFileSync(join(shelf, "Contents", "A", "track [bang].mp3"), "utf8"),
    ).toBe("drive-version-bytes");
  });

  test("same size but different content: default trusts size; --deep preserves", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-samesize-"), {
      "Contents/A/track.mp3": "aaaaXXXX",
    });
    // shelf twin has the SAME byte count (8) but different bytes
    const shelf = makeShelf({ "Contents/A/track.mp3": "bbbbYYYY" });
    await run({ volumes: [drive], shelfVolume: shelf });
    expect(
      existsSync(join(shelf, "Contents", "A", "track [").replace(/ \[$/, "")),
    ).toBe(false); // nothing extra written without --deep
    await run({
      volumes: [drive],
      shelfVolume: shelf,
      deep: true,
      suffix: "d",
    });
    expect(
      readFileSync(join(shelf, "Contents", "A", "track [d].mp3"), "utf8"),
    ).toBe("aaaaXXXX");
  });

  test("--trashes + --into lands trashed files flat under Contents/<into>/", async () => {
    const drive = mkdtempSync("/tmp/megadj-sa-trash-");
    makeDrive(drive, {
      ".Trashes/501/Cool Mix.mp3": "mix-bytes",
    });
    const shelf = makeShelf();
    await run({
      volumes: [drive],
      shelfVolume: shelf,
      trashes: true,
      into: "DJ Sets & Mixes",
    });
    expect(
      existsSync(join(shelf, "Contents", "DJ Sets & Mixes", "Cool Mix.mp3")),
    ).toBe(true);
  });

  test("unmounted drive is skipped, run stays ok, mounted one still works", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-ok-"), {
      "Contents/A/x.mp3": "x",
    });
    const shelf = makeShelf();
    await run({
      volumes: [drive, "/tmp/megadj-sa-not-mounted-zzz"],
      shelfVolume: shelf,
    });
    expect(existsSync(join(shelf, "Contents", "A", "x.mp3"))).toBe(true);
  });

  test("unmounted shelf is a hard error (exit 1)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-d2-"), {
      "Contents/A/x.mp3": "x",
    });
    const logs: string[] = [];
    await run({
      volumes: [drive],
      shelfVolume: "/tmp/megadj-sa-no-shelf-zzz",
      log: (s) => logs.push(s),
    });
    expect(logs.some((l) => l.includes("shelf not mounted"))).toBe(true);
    // shelf-archive signals failure via the STICKY process.exitCode — left
    // set, every later bun test exit in this process reports 1 with 0
    // failed tests (the hook then blocks the commit on a green suite).
    // Restore it so the failure is the assertion's to report, not the
    // process's.
    process.exitCode = 0;
  });

  test("--json emits one parseable summary (P1 contract) with ok flag", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-json-"), {
      "Contents/A/y.mp3": "y",
    });
    const shelf = makeShelf();
    const orig = console.log;
    let out = "";
    console.log = (s: string) => (out += s + "\n");
    try {
      await shelfArchive({
        volumes: [drive],
        shelfVolume: shelf,
        json: true,
        log: () => {},
        ledgerPath: null, // isolated: the --json test writes no ledger
      });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(out.trim()) as {
      command: string;
      drives: {
        files: number;
        coveredExact: number;
        copied: number;
        failed: number;
        ok: boolean;
      }[];
      ok: boolean;
    };
    expect(parsed.command).toBe("shelf-archive");
    expect(parsed.drives[0]?.files).toBe(1);
    expect(parsed.drives[0]?.copied).toBe(1);
    expect(parsed.ok).toBe(true);
  });
});

import { ShelfSweeps, type ShelfSweepRow } from "../shelf-sweeps";
import { Database } from "bun:sqlite";

describe("shelf sweep ledger", () => {
  test("start → finish records a complete verdict with counters", () => {
    const db = new Database(":memory:");
    const sweeps = new ShelfSweeps(db);
    const id = sweeps.start({
      drive: "TESTDRIVE",
      shelf: "SHELF1",
      deep: true,
      trashes: false,
      into: null,
    });
    sweeps.finish(id, {
      filesSeen: 100,
      coveredExact: 90,
      preserved: 7,
      copied: 3,
      bytesCopied: 12345678,
      failed: 0,
    });
    const row = sweeps.latestPerDrive()[0]!;
    expect(row.drive).toBe("TESTDRIVE");
    expect(row.verdict).toBe("complete");
    expect(row.deep).toBe(1);
    expect(row.files_seen).toBe(100);
    expect(row.finished_at).toBeString();
  });

  test("failures produce a failed verdict, never 'complete'", () => {
    const db = new Database(":memory:");
    const sweeps = new ShelfSweeps(db);
    const id = sweeps.start({ drive: "X", shelf: "SHELF1" });
    sweeps.finish(
      id,
      {
        filesSeen: 10,
        coveredExact: 8,
        preserved: 0,
        copied: 1,
        bytesCopied: 1,
        failed: 1,
      },
      "hash mismatch: a.mp3",
    );
    expect(sweeps.latestPerDrive()[0]?.verdict).toBe("failed");
  });

  test("dry runs record as preview, latestPerDrive keeps one row per drive", () => {
    const db = new Database(":memory:");
    const sweeps = new ShelfSweeps(db);
    const a = sweeps.start({ drive: "A", shelf: "SHELF1" });
    sweeps.finishPreview(a, {
      filesSeen: 5,
      coveredExact: 5,
      preserved: 0,
      copied: 0,
      bytesCopied: 0,
      failed: 0,
    });
    const b = sweeps.start({ drive: "B", shelf: "SHELF1" });
    sweeps.finishPreview(b, {
      filesSeen: 2,
      coveredExact: 1,
      preserved: 0,
      copied: 1,
      bytesCopied: 9,
      failed: 0,
    });
    const latest: ShelfSweepRow[] = sweeps.latestPerDrive();
    expect(latest).toHaveLength(2);
    expect(latest.map((r) => r.drive).toSorted()).toEqual(["A", "B"]);
    expect(latest.every((r) => r.verdict === "preview")).toBe(true);
  });
});

describe("shelf sweep ledger wiring", () => {
  test("a real sweep records a complete row in the ledger DB", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-ledger2-"), {
      "Contents/A/z.mp3": "z",
    });
    const shelf = makeShelf();
    const ledgerDb = mkdtempSync("/tmp/megadj-sa-ledger3-") + "/state.db";
    await shelfArchive({
      volumes: [drive],
      shelfVolume: shelf,
      ledgerPath: ledgerDb,
      log: () => {},
    });
    const db = new Database(ledgerDb, { readonly: true });
    const rows = db.query("SELECT * FROM shelf_sweeps").all() as Array<{
      drive: string;
      verdict: string;
      copied: number;
    }>;
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.drive).toBe(basename(drive));
    expect(rows[0]?.verdict).toBe("complete");
    expect(rows[0]?.copied).toBe(1);
  });

  test("ledgerPath: null disables recording (no DB anywhere)", async () => {
    const drive = makeDrive(mkdtempSync("/tmp/megadj-sa-noled-"), {
      "Contents/A/w.mp3": "w",
    });
    const shelf = makeShelf();
    // no ledgerPath → default would write the real DB; null disables
    await shelfArchive({
      volumes: [drive],
      shelfVolume: shelf,
      ledgerPath: null,
      log: () => {},
    });
    expect(existsSync(join(shelf, "Contents", "A", "w.mp3"))).toBe(true);
  });
});
