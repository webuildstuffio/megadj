/**
 * gold-set tests — GA-00/GA-00b pure math + schema guards + loader.
 * The plan's Part 0: "the highest-leverage thing in this document" —
 * so the schema, split, and metric math are pinned before any
 * annotations exist.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateScores,
  GOLD_SCHEMA_VERSION,
  goldDir,
  goldSchemaError,
  loadGoldSet,
  parseGoldAnnotation,
  scoreGoldTrack,
  splitGoldSet,
  type GoldAnnotation,
} from "../src/gold";

const valid: GoldAnnotation = {
  hash: "a".repeat(64),
  version: GOLD_SCHEMA_VERSION,
  branch: "house",
  firstDownbeatMs: 352,
  bpm: 124.005,
  phraseBars: [1, 33, 65, 97],
  hotCuesMs: [352, 15600, 31200],
};

describe("goldSchemaError", () => {
  test("accepts a valid annotation", () => {
    expect(goldSchemaError(valid)).toBeNull();
  });

  test("rejects non-object and bad hash", () => {
    expect(goldSchemaError(5)).toMatch(/object/u);
    expect(goldSchemaError({ ...valid, hash: "xyz" })).toMatch(/blake2b/u);
  });

  test("rejects wrong or missing version", () => {
    expect(goldSchemaError({ ...valid, version: 2 })).toMatch(/version/u);
    const { version: _drop, ...rest } = valid;
    expect(goldSchemaError(rest)).toMatch(/version/u);
  });

  test("rejects unknown branch", () => {
    expect(goldSchemaError({ ...valid, branch: "dubstep" })).toMatch(/branch/u);
  });

  test("rejects non-finite bpm and out-of-range values", () => {
    expect(goldSchemaError({ ...valid, bpm: -1 })).toMatch(/bpm/u);
    expect(goldSchemaError({ ...valid, bpm: 401 })).toMatch(/400/u);
    expect(goldSchemaError({ ...valid, firstDownbeatMs: -5 })).toMatch(
      /firstDownbeat/u,
    );
  });

  test("phraseBars must be increasing 1-based integers", () => {
    expect(goldSchemaError({ ...valid, phraseBars: [33, 1] })).toMatch(
      /increasing/u,
    );
    expect(goldSchemaError({ ...valid, phraseBars: [0, 33] })).toMatch(
      /bar integers/u,
    );
    expect(goldSchemaError({ ...valid, phraseBars: [1.5] })).toMatch(
      /bar integers/u,
    );
  });

  test("hotCuesMs: ≤ 8, finite, strictly increasing", () => {
    expect(
      goldSchemaError({ ...valid, hotCuesMs: Array(9).fill(100) }),
    ).toMatch(/≤ 8/u);
    expect(goldSchemaError({ ...valid, hotCuesMs: [200, 100] })).toMatch(
      /increasing/u,
    );
    expect(goldSchemaError({ ...valid, hotCuesMs: [-1] })).toMatch(/≥ 0/u);
  });

  test("parseGoldAnnotation throws with file name on bad JSON", () => {
    expect(() => parseGoldAnnotation("{nope", "x.json")).toThrow(
      /x\.json.*JSON/u,
    );
    expect(() => parseGoldAnnotation("{}", "y.json")).toThrow(/y\.json.*hash/u);
  });
});

describe("loadGoldSet", () => {
  const dir = mkdtempSync("/tmp/megadj-gold-");

  test("missing dir → empty set, no throw", () => {
    const s = loadGoldSet("/tmp/does-not-exist-gold");
    expect(s.annotations).toHaveLength(0);
    expect(s.issues).toHaveLength(0);
  });

  test("valid files load sorted; corrupt file lands in issues (visible)", () => {
    writeFileSync(
      join(dir, "b.json"),
      JSON.stringify({ ...valid, hash: "b".repeat(64) }),
    );
    writeFileSync(join(dir, "a.json"), "not json at all");
    writeFileSync(
      join(dir, "c.json"),
      JSON.stringify({ ...valid, hash: "c".repeat(64), bpm: 401 }),
    );
    const s = loadGoldSet(dir);
    expect(s.annotations.map((a) => a.hash[0])).toEqual(["b"]);
    expect(s.issues).toHaveLength(2);
    expect(s.issues.map((i) => i.file).sort()).toEqual(["a.json", "c.json"]);
    expect(s.issues[0]!.error).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  test("goldDir honors MEGADJ_GOLD_DIR override", () => {
    const prev = process.env.MEGADJ_GOLD_DIR;
    process.env.MEGADJ_GOLD_DIR = "/tmp/custom-gold";
    expect(goldDir("/music")).toBe("/tmp/custom-gold");
    delete process.env.MEGADJ_GOLD_DIR;
    expect(goldDir("/music")).toBe(join("/music", "_gold"));
    if (prev !== undefined) process.env.MEGADJ_GOLD_DIR = prev;
  });
});

describe("splitGoldSet (measurement discipline)", () => {
  test("deterministic 2/3–1/3 by hash order", () => {
    const anns: GoldAnnotation[] = ["d", "a", "c", "b", "e", "f"].map((c) => ({
      ...valid,
      hash: c.repeat(64),
    }));
    const s = splitGoldSet({
      annotations: anns,
      issues: [],
      dir: "/x",
    });
    // 6 tracks → 4 dev / 2 holdout; hash order a..f
    expect(s.dev.map((a) => a.hash[0])).toEqual(["a", "b", "c", "d"]);
    expect(s.holdout.map((a) => a.hash[0])).toEqual(["e", "f"]);
  });

  test("empty set splits empty", () => {
    expect(splitGoldSet({ annotations: [], issues: [], dir: "/x" })).toEqual({
      dev: [],
      holdout: [],
    });
  });
});

describe("scoreGoldTrack", () => {
  test("perfect prediction scores 100% on every axis", () => {
    const s = scoreGoldTrack(valid, {
      firstDownbeatS: 0.352,
      bpm: 124.005,
      phraseBars: [1, 33, 65, 97],
      cueTimesMs: [352, 15600, 31200],
    });
    expect(s.anchorDeltaMs).toBe(0);
    expect(s.bpmDelta).toBe(0);
    expect(s.bpmRatio).toBe(1);
    expect(s.phraseAligned).toBe(1);
    expect(s.cueAccepted).toBe(1);
  });

  test("anchor inside/outside the 10 ms window", () => {
    const near = scoreGoldTrack(valid, {
      firstDownbeatS: 0.3525, // +0.5 ms
      bpm: valid.bpm,
      phraseBars: [],
      cueTimesMs: [],
    });
    expect(near.anchorDeltaMs).toBe(0.5);
    const far = scoreGoldTrack(valid, {
      firstDownbeatS: 0.4, // +48 ms
      bpm: valid.bpm,
      phraseBars: [],
      cueTimesMs: [],
    });
    expect(far.anchorDeltaMs).toBe(48);
  });

  test("ratio errors counted separately: 2× lock is not a 0.05 miss", () => {
    const s = scoreGoldTrack(valid, {
      firstDownbeatS: 0.352,
      bpm: 62.0, // half the truth — classic half-time lock
      phraseBars: [],
      cueTimesMs: [],
    });
    expect(s.bpmDelta).toBe(-62.0);
    expect(s.bpmRatio).toBeCloseTo(0.5, 2);
    expect(aggregateScores([s]).octaveOff).toBe(1);
    expect(aggregateScores([s]).bpmPct).toBe(0);
  });

  test("phrase alignment: within-1-bar window, fraction of truth bars", () => {
    const s = scoreGoldTrack(valid, {
      firstDownbeatS: 0.352,
      bpm: valid.bpm,
      phraseBars: [1, 32, 66, 130], // 32→hit, 66→hit, 130→miss
      cueTimesMs: [],
    });
    expect(s.phraseAligned).toBeCloseTo(0.75, 3);
  });

  test("cue acceptance: 50 ms window fraction of user cues", () => {
    const s = scoreGoldTrack(valid, {
      firstDownbeatS: 0.352,
      bpm: valid.bpm,
      phraseBars: [],
      cueTimesMs: [352, 15620, 99999], // 3rd is a miss
    });
    expect(s.cueAccepted).toBeCloseTo(2 / 3, 3);
  });

  test("no ledger grid → null anchor (a miss, never a fake pass)", () => {
    const s = scoreGoldTrack(valid, {
      firstDownbeatS: null,
      bpm: null,
      phraseBars: [],
      cueTimesMs: [],
    });
    expect(s.anchorDeltaMs).toBeNull();
    expect(s.bpmDelta).toBeNull();
    const agg = aggregateScores([s]);
    expect(agg.anchorScored).toBe(0);
    expect(agg.anchorPct).toBeNull();
  });

  test("user marked no hot cues → cueAccepted null (not zero)", () => {
    const s = scoreGoldTrack(
      { ...valid, hotCuesMs: [] },
      {
        firstDownbeatS: 0.352,
        bpm: valid.bpm,
        phraseBars: [],
        cueTimesMs: [],
      },
    );
    expect(s.cueAccepted).toBeNull();
  });
});

describe("aggregateScores", () => {
  test("percentages over scored tracks only", () => {
    const mk = (
      anchor: number | null,
      bpm: number | null,
      ratio: number | null,
    ) => ({
      hash: "a".repeat(64),
      branch: "house" as const,
      anchorDeltaMs: anchor,
      bpmDelta: bpm,
      bpmRatio: ratio,
      phraseAligned: null,
      cueAccepted: null,
    });
    const m = aggregateScores([
      mk(2, 0.01, 1.0), // anchor ok, bpm ok
      mk(50, 0.01, 1.0), // anchor miss
      mk(null, null, null), // unscored
    ]);
    expect(m.tracks).toBe(3);
    expect(m.anchorScored).toBe(2);
    expect(m.anchorPct).toBe(50);
    expect(m.bpmScored).toBe(2);
    expect(m.bpmPct).toBe(100);
    expect(m.octaveOff).toBe(0);
    expect(m.phrasePct).toBeNull();
  });

  test("all-miss axes report null, never NaN or 100%", () => {
    const m = aggregateScores([]);
    expect(m.anchorPct).toBeNull();
    expect(m.bpmPct).toBeNull();
    expect(m.tracks).toBe(0);
  });
});

describe("loader round-trip with mkdir", () => {
  test("a fresh _gold dir integrates with the loader", () => {
    const dir = join(mkdtempSync("/tmp/megadj-goldint-"), "_gold");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "one.json"), JSON.stringify(valid));
    const s = loadGoldSet(dir);
    expect(s.annotations).toHaveLength(1);
    expect(s.issues).toHaveLength(0);
    expect(s.annotations[0]!.phraseBars).toEqual([1, 33, 65, 97]);
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });
});
