import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { findTwinPairs, shelfDedupe } from "./shelf-dedupe";

function makeShelf(
  withPair: { stem: string; origContent: string; twinContent: string },
  also: Record<string, string> = {},
) {
  const shelf = mkdtempSync("/tmp/megadj-dedupe-");
  const artistDir = join(shelf, "Contents", "Artist");
  mkdirSync(artistDir, { recursive: true });
  writeFileSync(join(artistDir, `${withPair.stem}.mp3`), withPair.origContent);
  writeFileSync(
    join(artistDir, `${withPair.stem} [TESTDRIVE].mp3`),
    withPair.twinContent,
  );
  for (const [name, content] of Object.entries(also)) {
    writeFileSync(join(artistDir, name), content);
  }
  return shelf;
}

describe("findTwinPairs", () => {
  test("finds [drive] twins and their originals, ignores junk", () => {
    const shelf = makeShelf(
      { stem: "song", origContent: "a", twinContent: "b" },
      { "._song [TESTDRIVE].mp3": "junk", "other.mp3": "c" },
    );
    const pairs = findTwinPairs(shelf);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.twin.endsWith("song [TESTDRIVE].mp3")).toBe(true);
    expect(pairs[0]!.original.endsWith("song.mp3")).toBe(true);
  });
});

describe("shelfDedupe", () => {
  test("byte-identical twin => keep-original (pure dupe)", async () => {
    const shelf = makeShelf({
      stem: "same",
      origContent: "IDENTICAL",
      twinContent: "IDENTICAL",
    });
    const res = await shelfDedupe({
      shelfVolume: shelf,
      skipFingerprint: true,
      log: () => {},
    });
    expect(res.byteDupes).toBe(1);
    expect(res.pairs[0]!.verdict).toBe("keep-original");
    expect(res.pairs[0]!.loser).toBe(res.pairs[0]!.twin);
  });

  test("differing bytes without fingerprint => keep-both (conservative)", async () => {
    const shelf = makeShelf({
      stem: "diff",
      origContent: "AAA",
      twinContent: "BBB",
    });
    const res = await shelfDedupe({
      shelfVolume: shelf,
      skipFingerprint: true,
      log: () => {},
    });
    expect(res.keepBoth).toBe(1);
    expect(res.pairs[0]!.loser).toBeNull();
  });

  test("report mode never touches files", async () => {
    const shelf = makeShelf({ stem: "x", origContent: "1", twinContent: "1" });
    await shelfDedupe({
      shelfVolume: shelf,
      skipFingerprint: true,
      log: () => {},
    });
    expect(
      existsSync(join(shelf, "Contents", "Artist", "x [TESTDRIVE].mp3")),
    ).toBe(true);
    expect(existsSync(join(shelf, ".dedupe-quarantine"))).toBe(false);
  });

  test("apply moves the loser to quarantine on the shelf", async () => {
    const shelf = makeShelf({
      stem: "dupe",
      origContent: "SAME",
      twinContent: "SAME",
    });
    const res = await shelfDedupe({
      shelfVolume: shelf,
      apply: true,
      yes: true,
      skipFingerprint: true,
      log: () => {},
    });
    expect(res.moved).toBe(1);
    expect(
      existsSync(join(shelf, "Contents", "Artist", "dupe [TESTDRIVE].mp3")),
    ).toBe(false);
    const q = join(shelf, "Contents", ".dedupe-quarantine");
    expect(readdirSync(q)).toContain("dupe [TESTDRIVE].mp3");
    expect(existsSync(join(shelf, "Contents", "Artist", "dupe.mp3"))).toBe(
      true,
    );
  });

  test("json output carries the contract", async () => {
    const shelf = makeShelf({ stem: "j", origContent: "z", twinContent: "z" });
    const orig = console.log;
    let out = "";
    console.log = (s) => (out += s + "\n");
    try {
      await shelfDedupe({
        shelfVolume: shelf,
        json: true,
        skipFingerprint: true,
        log: () => {},
      });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(out.trim()) as {
      command: string;
      ok: boolean;
      scanned: number;
    };
    expect(parsed.command).toBe("shelf-dedupe");
    expect(parsed.ok).toBe(true);
    expect(parsed.scanned).toBe(1);
  });
});
