import { describe, expect, test } from "bun:test";
import { cueKindResult } from "./doctor-state";

describe("doctor cue-kind health", () => {
  test("protects legitimate memory cues when no incident rows remain", () => {
    const result = cueKindResult({
      ran: true,
      kindZero: 12,
      incidentKindZero: 0,
      kinds: { "0": 12, "1": 24 },
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("12 legitimate memory cue(s) protected");
    expect(result.fix).toBeUndefined();
  });

  test("fails only for provenance-matching broken intake cues", () => {
    const result = cueKindResult({
      ran: true,
      kindZero: 12,
      incidentKindZero: 2,
      kinds: { "0": 12, "1": 24 },
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("2 Sep 12 intake cue(s)");
    expect(result.fix).toContain("--restamp --apply --yes");
  });
});
