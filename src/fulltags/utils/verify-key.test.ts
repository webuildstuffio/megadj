/**
 * verify-key unit tests (#185) — the gauntlet gate's pure seams: argv
 * parsing, Camelot normalization, wheel distance, and the gate math.
 * The OpenKeyScan analyzer run is injected (KeyAnalyzer seam) and the
 * reference side uses the --refs JSON map, so no torch env and no
 * tagged audio fixtures are needed.
 */
import { afterAll, describe, test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  camelotDist,
  parseVerifyKeyArgs,
  runVerifyKey,
  toCamelot,
} from "./verify-key";
import { tempDir } from "../../test-support/testutil";

describe("toCamelot normalization", () => {
  test("passes Camelot values through, uppercased", () => {
    expect(toCamelot("9A")).toBe("9A");
    expect(toCamelot("9a")).toBe("9A");
    expect(toCamelot("12B")).toBe("12B");
  });
  test("maps traditional minor/major names via the analyzer's own table", () => {
    expect(toCamelot("E min")).toBe("9A");
    expect(toCamelot("C major")).toBe("8B");
    expect(toCamelot("F#m")).toBe("11A");
    expect(toCamelot("dbmaj")).toBe("3B");
    expect(toCamelot("Ab min")).toBe("1A");
  });
  test("garbage → null", () => {
    expect(toCamelot(null)).toBeNull();
    expect(toCamelot("")).toBeNull();
    expect(toCamelot("not a key")).toBeNull();
  });
});

describe("camelotDist wheel distance", () => {
  test("same key is 0", () => {
    expect(camelotDist("9A", "9A")).toBe(0);
  });
  test("relative (same number) and ±1 neighbors are 1", () => {
    expect(camelotDist("9A", "9B")).toBe(1); // relative major/minor
    expect(camelotDist("9A", "8A")).toBe(1); // energy-adjacent
    expect(camelotDist("1A", "12A")).toBe(1); // wheel wrap
  });
  test("far keys carry the circular distance", () => {
    expect(camelotDist("1A", "6A")).toBe(5);
  });
});

describe("parseVerifyKeyArgs", () => {
  test("targets + flags", () => {
    const a = parseVerifyKeyArgs(["/tmp/x", "--limit", "5", "--json"]);
    expect(a.targets).toEqual(["/tmp/x"]);
    expect(a.limit).toBe(5);
    expect(a.json).toBeTrue();
    expect(a.error).toBeNull();
  });
  test("--limit= form and --refs", () => {
    const a = parseVerifyKeyArgs(["--limit=7", "--refs", "/m.json", "dir"]);
    expect(a.limit).toBe(7);
    expect(a.refsPath).toBe("/m.json");
    expect(a.targets).toEqual(["dir"]);
  });
  test("negative/zero/NaN limit is a usage error", () => {
    expect(parseVerifyKeyArgs(["--limit", "0"]).error).toContain("--limit");
    expect(parseVerifyKeyArgs(["--limit=-3"]).error).toContain("--limit");
    expect(parseVerifyKeyArgs(["--limit=abc"]).error).toContain("--limit");
  });
  test("unknown flag is a usage error", () => {
    expect(parseVerifyKeyArgs(["--nope"]).error).toContain("unknown flag");
  });
});

const t = tempDir("megadj-verify-key-").rippable();
afterAll(() => t.rippleAll());

/** Four synthetic tracks with 9A reference keys + the refs JSON map —
 * module-scope so each test gets a fresh fixture without re-declaring. */
const makeDir = (): {
  dir: string;
  refsPath: string;
  refs: Record<string, string>;
} => {
  const dir = t.dir();
  const refs: Record<string, string> = {};
  for (const [name, key] of [
    ["a.mp3", "9A"],
    ["b.mp3", "9A"],
    ["c.mp3", "9A"],
    ["d.mp3", "9A"],
  ] as const) {
    writeFileSync(join(dir, name), "x"); // existence is all the run needs
    refs[name] = key;
  }
  const refsPath = join(dir, "refs.json");
  writeFileSync(refsPath, JSON.stringify(refs));
  return { dir, refsPath, refs };
};

describe("runVerifyKey gate math (analyzer + refs injected)", () => {
  test("2/4 exact → agreement 0.5 → gate FAIL (exit-1 shape)", async () => {
    const { dir, refsPath } = makeDir();
    const summary = await runVerifyKey({
      targets: [dir],
      limit: 20,
      refsPath,
      analyze: async (paths) => {
        const m = new Map();
        // a, b exact; c near (8A); d wrong (2A)
        const answers: Record<string, string> = {
          "a.mp3": "9A",
          "b.mp3": "9A",
          "c.mp3": "8A",
          "d.mp3": "2A",
        };
        for (const p of paths) {
          const base = p.split("/").pop() ?? "";
          const k = answers[base];
          if (k) m.set(p, { camelot: k, openkey: "", key: "" });
        }
        return m;
      },
    });
    expect(summary.analyzed).toBe(4);
    expect(summary.match).toBe(2);
    expect(summary.near).toBe(1);
    expect(summary.mismatch).toBe(1);
    expect(summary.agreement).toBe(0.5);
    expect(summary.gatePass).toBeFalse();
  });

  test("4/4 exact → gate PASS", async () => {
    const { dir, refsPath } = makeDir();
    const summary = await runVerifyKey({
      targets: [dir],
      limit: 20,
      refsPath,
      analyze: async (paths) => {
        const m = new Map();
        for (const p of paths)
          m.set(p, { camelot: "9A", openkey: "", key: "" });
        return m;
      },
    });
    expect(summary.match).toBe(4);
    expect(summary.agreement).toBe(1);
    expect(summary.gatePass).toBeTrue();
  });

  test("limit trims the sample", async () => {
    const { dir, refsPath } = makeDir();
    const summary = await runVerifyKey({
      targets: [dir],
      limit: 2,
      refsPath,
      analyze: async (paths) => {
        const m = new Map();
        for (const p of paths)
          m.set(p, { camelot: "9A", openkey: "", key: "" });
        return m;
      },
    });
    expect(summary.analyzed).toBe(2);
  });

  test("missing --refs file throws a usage error", async () => {
    await expect(
      runVerifyKey({
        targets: ["/nonexistent-target-for-vk-test"],
        limit: 2,
        refsPath: "/nonexistent/refs.json",
      }),
    ).rejects.toThrow("--refs");
  });

  test("no files → throws the no-targets error", async () => {
    const empty = t.dir();
    await expect(
      runVerifyKey({ targets: [empty], limit: 5, refsPath: null }),
    ).rejects.toThrow("no files to verify");
  });

  test("malformed refs JSON throws with the flag name", async () => {
    const dir = t.dir();
    writeFileSync(join(dir, "a.mp3"), "x");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    await expect(
      runVerifyKey({ targets: [dir], limit: 5, refsPath: bad }),
    ).rejects.toThrow("--refs invalid JSON");
  });
});
