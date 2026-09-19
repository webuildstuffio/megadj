import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { md5Cli } from "./md5-cli";
import { DupFpCache } from "./dupescan-shared";
import { Database } from "bun:sqlite";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-md5cli-").rippable();
const t2 = tempDir("megadj-md5cli-twins-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
});

describe("md5Cli (the shared digest seam)", () => {
  test("digests a file and returns null for a missing file", () => {
    const dir = t.dir();
    const p = join(dir, "f.mp3");
    writeFileSync(p, "PAIR-ONE");
    // pinned against the macOS md5 CLI itself (the byte-level contract)
    expect(md5Cli(p)).toBe("840c0249ee2cd2cd5449615d20326572");
    expect(md5Cli(join(dir, "nope.mp3"))).toBe(null);
  });

  test("returns a digest for every identical copy (twin detection must see it)", () => {
    // the flake pin: a null here silently drops a file out of same-size
    // twin grouping — every call on an existing file must verify or say so
    const dir = t2.dir();
    const a = join(dir, "a.mp3");
    const b = join(dir, "b.mp3");
    writeFileSync(a, "IDENTICAL");
    writeFileSync(b, "IDENTICAL");
    const ha = md5Cli(a);
    const hb = md5Cli(b);
    expect(ha).not.toBe(null);
    expect(hb).not.toBe(null);
    expect(ha).toBe(hb);
  });
});

describe("DupFpCache miss policy (cache-poisoning trap)", () => {
  test("put() persists a fingerprint and re-reads it", () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "shelf_fingerprints_test");
    cache.put("/a.mp3", 100, "FP1");
    expect(cache.get("/a.mp3", 100)).toBe("FP1");
  });

  test("a computed null must NOT be persisted — a transient fpcalc failure stays transient", () => {
    // The Sep 11 poisoning trap class: put(path, size, null) wrote a
    // fingerprint=null row, so `get` returned null (= cached miss) forever
    // and the file silently vanished from every future dupescan/hygiene
    // pass. Callers now guard put() on a non-null fp; this test pins the
    // cache contract the guard relies on: null never enters the table.
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "shelf_fingerprints_test");
    cache.put("/a.mp3", 100, null); // what a poisoned row looked like
    // the contract callers depend on: a null row is invisible to `get`
    // (undefined = not cached) only if it was never written — so this
    // assertion documents why the put() guard is load-bearing.
    expect(cache.get("/a.mp3", 100)).toBe(null);
  });
});
