/**
 * bandcamp.test.ts — pins the Bandcamp source (bandcamp.ts): query-term
 * building, the search-result gating (scoreBcHits: overlap floor + hard
 * artist gate), page parsing (tags/label/date/duration from a captured
 * real page's shapes), and the art URL size upgrade. Offline: no network
 * in tests — the fetch legs were verified live against bandcamp.com on
 * Sep 15 (autocomplete_elastic POST + track/album page payloads).
 */
import { describe, expect, test } from "bun:test";
import {
  artUrlLarge,
  bcQueryTerm,
  isoFromBcDate,
  parseIsoDuration,
  scoreBcHits,
  type BcTrack,
} from "../../bandcamp";

const hit = (over: Partial<BcTrack>): BcTrack => ({
  id: 1,
  name: "Depths of Consciousness (Mix)",
  bandName: "Unusual Cosmic Process",
  artist: null,
  albumName: null,
  url: "https://unusualcosmicprocess2.bandcamp.com/track/depths-of-consciousness-mix",
  artUrl: null,
  score: 0,
  ...over,
});

describe("bandcamp: bcQueryTerm", () => {
  test("primary artist (lowercased) + title as given, ≤8 tokens", () => {
    expect(
      bcQueryTerm({
        artist: "Tvardovsky, Aleksei",
        title: "Depths of Consciousness",
      }),
    ).toBe("tvardovsky Depths of Consciousness");
  });

  test("keeps bracket content (Bandcamp titles use it)", () => {
    expect(
      bcQueryTerm({ artist: "HI-LO", title: "REESE (Original Mix)" }),
    ).toBe("hi-lo REESE (Original Mix)");
  });
});

describe("bandcamp: scoreBcHits (relevance + hard artist gate)", () => {
  const q = {
    artist: "Unusual Cosmic Process",
    title: "Depths of Consciousness",
  };

  test("matching band passes and gains gate points", () => {
    const kept = scoreBcHits([hit({})], q);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.score).toBeGreaterThanOrEqual(6);
  });

  test("wrong-band same-title hit is DROPPED (the Taylor Swift class)", () => {
    const kept = scoreBcHits(
      [hit({ bandName: "Totally Unrelated Label", artist: null })],
      q,
    );
    expect(kept).toHaveLength(0);
  });

  test("credited track artist counts as a gate candidate", () => {
    const kept = scoreBcHits(
      [
        hit({
          name: "REESE (Original Mix)",
          bandName: "Drumcode",
          artist: "HI-LO",
        }),
      ],
      { artist: "HI-LO", title: "REESE" },
    );
    expect(kept).toHaveLength(1);
  });

  test("sub-floor title overlap is dropped even with the right artist", () => {
    const kept = scoreBcHits([hit({ name: "Completely Different Song" })], q);
    expect(kept).toHaveLength(0);
  });
});

describe("bandcamp: page payload parsing", () => {
  test("isoFromBcDate parses Bandcamp's GMT date strings", () => {
    expect(isoFromBcDate("19 Dec 2021 14:25:14 GMT")).toBe("2021-12-19");
    expect(isoFromBcDate("10 Oct 2025 00:00:00 GMT")).toBe("2025-10-10");
    expect(isoFromBcDate("not a date")).toBeNull();
  });

  test("parseIsoDuration reads PnDTnHnMnS", () => {
    expect(parseIsoDuration("P01H14M09S")).toBe(4449);
    expect(parseIsoDuration("PT3M17S")).toBe(197);
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration("garbage")).toBeNull();
  });

  test("artUrlLarge rewrites the size id to original", () => {
    expect(artUrlLarge("https://f4.bcbits.com/img/0182486429_3.jpg")).toBe(
      "https://f4.bcbits.com/img/0182486429_10.jpg",
    );
    expect(artUrlLarge(null)).toBeNull();
  });
});
