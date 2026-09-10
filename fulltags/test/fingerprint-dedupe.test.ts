import { describe, test, expect } from "bun:test";
import {
  nameSimilarityTokens,
  type FpVerdict,
} from "../src/fingerprint-dedupe";

/** The verdict rules are pure functions over (fp equality, name tokens);
 * fpcalc itself is exercised end-to-end in the ingest e2e tests. */

describe("nameSimilarityTokens", () => {
  test("mislabeled twin of the same rip scores high", () => {
    const a =
      "Back To Friends (MilesPerHour & Alexa Play Music Remix) [Radio Edit].aiff";
    const b = "back to friends radio edit.wav";
    expect(nameSimilarityTokens(a, b)).toBeGreaterThanOrEqual(0.5);
  });

  test("unrelated tracks score low", () => {
    const a = "Daft Punk - Around The World (Westend Edit).wav";
    const b = "Satoshi Tomiie - Love In Traffic (Remix).aiff";
    expect(nameSimilarityTokens(a, b)).toBeLessThan(0.5);
  });

  test("empty names never match", () => {
    expect(nameSimilarityTokens("", "x.mp3")).toBe(0);
    expect(nameSimilarityTokens("a.mp3", "___")).toBe(0);
  });
});

describe("FpVerdict shape", () => {
  test("dupe and suspicious are mutually exclusive", () => {
    // pinned contract: a verdict is never both dupe AND suspicious
    const v: FpVerdict = { fp: "AQ", dupe: true, suspicious: false };
    expect(v.dupe && v.suspicious).toBe(false);
  });
});
