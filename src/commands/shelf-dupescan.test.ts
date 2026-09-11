import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { shelfDupescan, FpCache, parseFpcalcOutput } from "./shelf-dupescan";

/**
 * Regression (Sep 11 mass-collision): the fingerprint parser's char
 * class omitted `-` and `_`, so base64url fingerprints truncated at the
 * first hyphen and unrelated files sharing the prefix collided into fake
 * duplicate groups (29 fake groups over 3,061 files — one "matched"
 * Missy Elliott with a Jason Derulo remix). Real fingerprints are 700+
 * chars; truncated prefixes were 4–54.
 */
describe("fpcalc fingerprint parsing (base64url-safe)", () => {
  test("keeps hyphens in the fingerprint body", () => {
    const out =
      "DURATION=239\nFINGERPRINT=AQADtE-WRYlS5DpO9DDx8FArHU_N4M2RHs\n";
    const fp = parseFpcalcOutput(out);
    expect(fp).toBe("AQADtE-WRYlS5DpO9DDx8FArHU_N4M2RHs");
  });

  test("keeps underscores and padded equals signs", () => {
    const out = "FINGERPRINT=AbC_dE-F=";
    expect(parseFpcalcOutput(out)).toBe("AbC_dE-F=");
  });

  test("does NOT truncate at the first hyphen (the regression)", () => {
    const out = "FINGERPRINT=AQADtE-WRYlS5DpO\n";
    const fp = parseFpcalcOutput(out)!;
    expect(fp).toContain("-");
    expect(fp.length).toBeGreaterThan("AQADtE".length);
  });

  test("absent fingerprint → null, not empty string", () => {
    expect(parseFpcalcOutput("DURATION=239\n")).toBeNull();
    expect(parseFpcalcOutput("")).toBeNull();
  });
});

/** Generate one real 10-second mp3 with ffmpeg (deterministic sine tone). */
function tone(file: string, freq = 440): void {
  const r = Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-v",
    "quiet",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=10`,
    "-b:a",
    "32k",
    file,
  ]);
  if (!r.success) throw new Error("ffmpeg tone failed");
}

function makeShelf(files: Record<string, "tone" | "tone2">): string {
  const shelf = mkdtempSync("/tmp/megadj-dupescan-");
  for (const [rel, kind] of Object.entries(files)) {
    const abs = join(shelf, "Contents", rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    if (kind === "tone") tone(abs);
    else tone(abs, 880); // a DIFFERENT tone → different fingerprint
  }
  return shelf;
}

describe("shelf-dupescan", () => {
  test("report mode finds cross-folder duplicates, touches nothing", async () => {
    const shelf = makeShelf({
      "Artist A/Album/song.mp3": "tone",
      "Artist B/compilation/song (some edit).mp3": "tone",
      "Artist C/other track.mp3": "tone2",
    });
    const ledger = mkdtempSync("/tmp/megadj-dupescan-db-") + "/state.db";
    let out = "";
    const orig = console.log;
    console.log = (s: string) => (out += s + "\n");
    try {
      await shelfDupescan({ shelfVolume: shelf, json: true, dbPath: ledger });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(out.slice(out.indexOf("{"))) as {
      command: string;
      scanned: number;
      duplicateGroups: number;
      applied: boolean;
    };
    expect(parsed.command).toBe("shelf-dupescan");
    expect(parsed.scanned).toBe(3);
    expect(parsed.duplicateGroups).toBe(1);
    expect(parsed.applied).toBe(false);
    expect(
      existsSync(
        join(
          shelf,
          "Contents",
          "Artist B",
          "compilation",
          "song (some edit).mp3",
        ),
      ),
    ).toBe(true);
  });

  test("quarantine mode moves the loser, keeps the keeper, needs --yes", async () => {
    const shelf = makeShelf({
      "Artist A/Album/song.mp3": "tone",
      "Artist A/Album/song-1.mp3": "tone",
    });
    const ledger = mkdtempSync("/tmp/megadj-dupescan-db2-") + "/state.db";
    // without --yes: nothing moves
    await shelfDupescan({
      shelfVolume: shelf,
      quarantine: true,
      dbPath: ledger,
      log: () => {},
    });
    expect(
      existsSync(join(shelf, "Contents", "Artist A", "Album", "song-1.mp3")),
    ).toBe(true);
    // with --yes: exactly one loser moves to quarantine, keeper stays
    await shelfDupescan({
      shelfVolume: shelf,
      quarantine: true,
      yes: true,
      dbPath: ledger,
      log: () => {},
    });
    const album = join(shelf, "Contents", "Artist A", "Album");
    const remaining = ["song.mp3", "song-1.mp3"].filter((f) =>
      existsSync(join(album, f)),
    );
    expect(remaining.length).toBe(1);
    const q = readdirSync(join(shelf, "Contents", ".dupescan-quarantine"));
    expect(q.length).toBe(1);
  });
});

describe("FpCache", () => {
  test("put/get roundtrip and size change invalidation", () => {
    const db = new Database(":memory:");
    const cache = new FpCache(db);
    expect(cache.get("/a.mp3", 100)).toBeUndefined();
    cache.put("/a.mp3", 100, "FP1");
    expect(cache.get("/a.mp3", 100)).toBe("FP1");
    expect(cache.get("/a.mp3", 200)).toBeUndefined(); // size changed → stale
  });
});
