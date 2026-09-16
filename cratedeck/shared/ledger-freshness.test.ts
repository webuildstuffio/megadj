import { describe, expect, test } from "bun:test";
import { formatAge, ledgerFreshness, worstBand } from "./ledger-freshness";

const NOW = new Date("2026-09-15T20:00:00Z");
const hoursAgo = (h: number): string =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("ledgerFreshness (#161 SSOT)", () => {
  test("bands are the AGENTS thresholds: green <24h, amber <7d, red ≥7d", () => {
    expect(ledgerFreshness(hoursAgo(1), NOW).band).toBe("green");
    expect(ledgerFreshness(hoursAgo(23), NOW).band).toBe("green");
    expect(ledgerFreshness(hoursAgo(25), NOW).band).toBe("amber");
    expect(ledgerFreshness(hoursAgo(24 * 7 - 1), NOW).band).toBe("amber");
    expect(ledgerFreshness(hoursAgo(24 * 7 + 1), NOW).band).toBe("red");
  });

  test("empty ledger → none; corrupt stamp → red (never crashes the surface)", () => {
    expect(ledgerFreshness(null, NOW)).toEqual({
      newestAt: null,
      ageHours: null,
      band: "none",
    });
    const corrupt = ledgerFreshness("not-a-date", NOW);
    expect(corrupt.band).toBe("red");
    expect(corrupt.newestAt).toBe("not-a-date");
  });

  test("future stamp clamps to 0h (clock skew can't go negative)", () => {
    expect(ledgerFreshness(hoursAgo(-3), NOW).ageHours).toBe(0);
  });

  test("formatAge: hours <48h, then days; never for empty", () => {
    expect(formatAge(ledgerFreshness(hoursAgo(3), NOW))).toBe("3h ago");
    expect(formatAge(ledgerFreshness(hoursAgo(47), NOW))).toBe("47h ago");
    expect(formatAge(ledgerFreshness(hoursAgo(72), NOW))).toBe("3d ago");
    expect(formatAge(ledgerFreshness(null, NOW))).toBe("never");
  });

  test("worstBand rollup: any red → red; none+green → green", () => {
    expect(worstBand(["green", "red"])).toBe("red");
    expect(worstBand(["green", "amber"])).toBe("amber");
    expect(worstBand(["none", "green"])).toBe("green");
    expect(worstBand([])).toBe("none");
  });
});
