import { describe, expect, test } from "bun:test";
import {
  HOT_CUE_KIND,
  LOOP_CUE_KIND,
  MAX_HOT_CUES,
  restampScript,
} from "./rb-cues.js";

describe("rb-cues constants (F4-pinned semantics)", () => {
  test("HOT_CUE_KIND is 1 — DB-side truth from the Sep 13 F4 spike", () => {
    // RB7-written rows: Kind=1 x2081, Kind=2 x6, Kind=0 x0. A regression
    // here would re-create the invisible-pad bug.
    expect(HOT_CUE_KIND).toBe(1);
    expect(LOOP_CUE_KIND).toBe(2);
  });

  test("MAX_HOT_CUES matches the 8-pad hardware contract", () => {
    expect(MAX_HOT_CUES).toBe(8);
  });

  test("restamp script contains the hard gates (never bare writes)", () => {
    const s = restampScript();
    expect(s).toContain("Kind == 0"); // only touches Kind=0 rows
    expect(s).toContain("r.Kind = 1"); // pinned constant value
    expect(s).toContain("rollback"); // per-row safety
    expect(s).not.toContain("Kind = 0"); // never writes 0
  });
});
