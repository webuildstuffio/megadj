// dupescan-engine.test.ts — regression for the ONE fingerprint-dedupe
// engine (#142): fingerprint loop (never cache a null), group cut, and
// the apply safety gate (same-size → md5 equality; different-size →
// name agreement; collisions abort THAT file, never the run).
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DupFpCache, type DupGroup } from "./dupescan-shared";
import {
  applyGroupsSafety,
  cutDupGroups,
  fingerprintFiles,
  sameSizeSafe,
  type GroupContext,
} from "./dupescan-engine";

function group(files: [string, number][], keep?: string): DupGroup {
  const entries = files.map(([path, bytes]) => ({ path, bytes }));
  return {
    fingerprint: "FP",
    files: entries,
    keep: keep ?? entries[0]!.path,
    reason: "test group",
  };
}

function ctx(keeper: { path: string; bytes: number }): GroupContext {
  return { keeper, keeperMd5: null, nameRatio: 1 };
}

describe("fingerprintFiles (#142 engine)", () => {
  test("computes missing fingerprints, reports cached vs computed", async () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "engine_test_fp");
    const dir = mkdtempSync("/tmp/engine-fp-");
    const a = join(dir, "a.mp3");
    const b = join(dir, "b.mp3");
    writeFileSync(a, "aaa");
    writeFileSync(b, "bbb");
    // prime one row so the first pass sees it as cached
    cache.put(a, 3, "FP-A");
    const stats = await fingerprintFiles([a, b], cache, {
      fingerprint: (p) => (p === b ? "FP-B" : null),
    });
    expect(stats.cached).toBe(1);
    expect(stats.computed).toBe(1);
    expect(cache.get(b, 3)).toBe("FP-B");
  });

  test("NEVER caches a null fingerprint (the poisoning trap)", async () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "engine_test_fp_null");
    const dir = mkdtempSync("/tmp/engine-fp-null-");
    const f = join(dir, "gone.mp3");
    writeFileSync(f, "x");
    const stats = await fingerprintFiles([f], cache, {
      fingerprint: () => null, // fpcalc failure
    });
    expect(stats.computed).toBe(1);
    expect(cache.get(f, 1)).toBeUndefined(); // row must NOT exist
  });

  test("a vanished file is skipped, not an error", async () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "engine_test_fp_van");
    const stats = await fingerprintFiles(["/nonexistent/x.mp3"], cache, {
      fingerprint: () => "FP",
    });
    expect(stats.computed).toBe(0);
    expect(stats.cached).toBe(0);
  });
});

describe("cutDupGroups (#142 engine)", () => {
  test("cuts >=2 same-fingerprint groups, keeper = sort winner", () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "engine_test_cut");
    const dir = mkdtempSync("/tmp/engine-cut-");
    const files = ["big.mp3", "small.mp3", "mid.mp3", "lonely.mp3"].map(
      (n, i) => {
        const p = join(dir, n);
        writeFileSync(p, "x".repeat(10 - i));
        return p;
      },
    );
    // big+small+mid share FP1 (keeper = largest = big.mp3); lonely differs
    cache.put(files[0]!, 10, "FP1");
    cache.put(files[1]!, 9, "FP1");
    cache.put(files[2]!, 8, "FP1");
    cache.put(files[3]!, 7, "FP2");
    const cut = cutDupGroups(files, cache, {
      keeperSort: (a, b) => b.bytes - a.bytes,
      reason: (g) => `largest of ${g.length}`,
    });
    expect(cut.groups).toHaveLength(1);
    expect(cut.groups[0]!.keep).toBe(files[0]!);
    expect(cut.groups[0]!.files).toHaveLength(3);
    expect(cut.groups[0]!.reason).toBe("largest of 3");
    // losers only: 9 + 8 bytes
    expect(cut.redundantBytes).toBe(17);
  });

  test("singleton fingerprints never group (no >=2 cut, no group)", () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "engine_test_solo");
    const dir = mkdtempSync("/tmp/engine-solo-");
    const f = join(dir, "only.mp3");
    writeFileSync(f, "x");
    cache.put(f, 1, "FP-SOLO");
    const cut = cutDupGroups([f], cache, {
      keeperSort: (a, b) => b.bytes - a.bytes,
      reason: () => "never",
    });
    expect(cut.groups).toEqual([]);
    expect(cut.redundantBytes).toBe(0);
  });
});

describe("applyGroupsSafety (#142 engine — the ONE safety gate)", () => {
  test("policy-accepted losers quarantine; refusals go to review", () => {
    const dir = mkdtempSync("/tmp/engine-apply-");
    const qDir = join(dir, "q");
    mkdirSync(qDir, { recursive: true });
    const keeper = join(dir, "keep.mp3");
    const loserA = join(dir, "loser-a.mp3");
    const loserB = join(dir, "loser-b.mp3");
    writeFileSync(keeper, "k");
    writeFileSync(loserA, "a");
    writeFileSync(loserB, "b");
    const reviewed: string[] = [];
    const quarantined: string[] = [];
    const tally = applyGroupsSafety(
      [
        group(
          [
            [keeper, 1],
            [loserA, 1],
            [loserB, 1],
          ],
          keeper,
        ),
      ],
      qDir,
      // accept only loser-a
      (loser) => loser.path === loserA,
      () => 1,
      {
        onQuarantined: (p) => quarantined.push(p),
        onReview: (p) => reviewed.push(p),
      },
    );
    expect(tally.quarantined).toBe(1);
    expect(tally.skippedForReview).toBe(1);
    expect(existsSync(join(qDir, "loser-a.mp3"))).toBe(true);
    expect(existsSync(loserA)).toBe(false);
    expect(existsSync(loserB)).toBe(true); // refusal = untouched
    expect(reviewed).toEqual([loserB]);
    expect(quarantined).toEqual([loserA]);
  });

  test("quarantine collision aborts THAT file, never the run", () => {
    const dir = mkdtempSync("/tmp/engine-coll-");
    const qDir = join(dir, "q");
    mkdirSync(qDir, { recursive: true });
    const keeper = join(dir, "keep.mp3");
    const first = join(dir, "dupe.mp3");
    const second = join(dir, "other.mp3");
    writeFileSync(keeper, "k");
    writeFileSync(first, "1");
    writeFileSync(second, "2");
    // pre-existing quarantine file blocks the FIRST loser only
    writeFileSync(join(qDir, "dupe.mp3"), "stale");
    const errors: string[] = [];
    const tally = applyGroupsSafety(
      [
        group(
          [
            [keeper, 1],
            [first, 1],
            [second, 1],
          ],
          keeper,
        ),
      ],
      qDir,
      () => true, // policy accepts both
      () => 1,
      { onError: (m) => errors.push(m) },
    );
    // first: collision → review; second: moves fine
    expect(tally.quarantined).toBe(1);
    expect(tally.skippedForReview).toBe(1);
    expect(errors.join("\n")).toContain("quarantine name collision: ");
    expect(existsSync(join(qDir, "other.mp3"))).toBe(true);
    expect(readOf(join(qDir, "dupe.mp3"))).toBe("stale"); // never overwritten
  });

  test("moveLoser rename failures surface as per-file errors, run continues", () => {
    const dir = mkdtempSync("/tmp/engine-err-");
    const qDir = join(dir, "q-unwritable");
    // qDir's parent exists but qDir itself is a FILE → rename fails
    writeFileSync(join(dir, "q-unwritable"), "not a dir");
    const keeper = join(dir, "keep.mp3");
    const loser = join(dir, "loser.mp3");
    writeFileSync(keeper, "k");
    writeFileSync(loser, "l");
    const errors: string[] = [];
    const tally = applyGroupsSafety(
      [
        group(
          [
            [keeper, 1],
            [loser, 1],
          ],
          keeper,
        ),
      ],
      qDir,
      () => true,
      () => 1,
      { onError: (m) => errors.push(m) },
    );
    expect(tally.quarantined).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(existsSync(loser)).toBe(true); // source untouched on failure
  });
});

function readOf(path: string): string {
  return readFileSync(path, "utf8");
}

describe("sameSizeSafe (the byte-verify rule, ONE body)", () => {
  test("different size is not same-size-safe (falls through to policy)", () => {
    const errors2: string[] = [];
    const hooks = { onError: (m: string) => errors2.push(m) };
    expect(
      sameSizeSafe(
        { path: "/l", bytes: 5 },
        { ...ctx({ path: "/k", bytes: 9 }), keeperMd5: "MD5" },
        hooks,
      ),
    ).toBe(false);
    expect(errors2).toEqual([]); // size gate: no md5 work, no error
  });
});
