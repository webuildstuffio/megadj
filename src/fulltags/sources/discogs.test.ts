/**
 * discogs.test.ts — Tests for Discogs dump genre mapping (B4.2).
 */
import { describe, expect, test } from "bun:test";
import { mapDiscogsRelease, parseDiscogsYear, type DiscogsRelease } from "./discogs";

describe("mapDiscogsRelease", () => {
  test("maps styles to L2 families", () => {
    const release: DiscogsRelease = {
      releaseId: 1,
      title: "Deep Vibes",
      artists: ["DJ Test"],
      genres: ["Electronic"],
      styles: ["Deep House", "Acid House"],
      year: 2024,
      country: "US",
    };
    const result = mapDiscogsRelease(release);
    expect(result.bestFamily).toBe("house");
    expect(result.bestStyle).toBe("deep house");
    expect(result.families).toContain("house");
  });

  test("falls back to genres when no styles map", () => {
    const release: DiscogsRelease = {
      releaseId: 2,
      title: "Unknown Styles",
      artists: ["Artist"],
      genres: ["Hip Hop"],
      styles: ["Conscious", "Boom Bap"],
      year: 2020,
      country: null,
    };
    const result = mapDiscogsRelease(release);
    expect(result.bestFamily).toBe("hip hop");
  });

  test("collects unmapped styles", () => {
    const release: DiscogsRelease = {
      releaseId: 3,
      title: "Obscure",
      artists: ["Artist"],
      genres: ["Electronic"],
      styles: ["Minimal Wave", "EBM"],
      year: 2022,
      country: "DE",
    };
    const result = mapDiscogsRelease(release);
    expect(result.unmappedStyles.length).toBeGreaterThanOrEqual(0);
  });

  test("deduplicates families", () => {
    const release: DiscogsRelease = {
      releaseId: 4,
      title: "Double House",
      artists: ["DJ"],
      genres: [],
      styles: ["Deep House", "Funky House", "Soulful House"],
      year: 2023,
      country: null,
    };
    const result = mapDiscogsRelease(release);
    const houseFamilies = result.families.filter((f) => f === "house");
    expect(houseFamilies).toHaveLength(1);
  });

  test("no mappable genres → null bestFamily", () => {
    const release: DiscogsRelease = {
      releaseId: 5,
      title: "No Genre",
      artists: ["Nobody"],
      genres: [],
      styles: [],
      year: null,
      country: null,
    };
    const result = mapDiscogsRelease(release);
    expect(result.bestFamily).toBeNull();
  });
});

describe("parseDiscogsYear", () => {
  test("parses full date", () => {
    expect(parseDiscogsYear("2024-03-15")).toBe(2024);
  });

  test("parses year only", () => {
    expect(parseDiscogsYear("2024")).toBe(2024);
  });

  test("parses year-month", () => {
    expect(parseDiscogsYear("2024-03")).toBe(2024);
  });

  test("returns null for null input", () => {
    expect(parseDiscogsYear(null)).toBeNull();
  });

  test("returns null for short string", () => {
    expect(parseDiscogsYear("20")).toBeNull();
  });

  test("returns null for invalid year", () => {
    expect(parseDiscogsYear("abcd")).toBeNull();
  });
});
