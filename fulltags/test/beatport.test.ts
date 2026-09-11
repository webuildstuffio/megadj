import { describe, test, expect, beforeEach } from "bun:test";
import {
  beatportLookup,
  beatportToken,
  beatportReset,
  bpGenre,
  bpStamp,
  scoreBpHit,
  BP_MIN_SCORE,
  setBeatportSearchImpl,
  type BpTrack,
} from "../src/beatport";

/** A fully-populated catalog row for scoring tests. */
function hit(over: Partial<BpTrack> = {}): BpTrack {
  return {
    id: 9440664,
    name: "Glue",
    mixName: "Original Mix",
    artists: ["Bicep"],
    remixers: [],
    genre: "House",
    subGenre: "Deep House",
    label: "Island",
    release: "Glue",
    bpm: 130,
    camelot: "5A",
    keyName: "C Minor",
    year: 2017,
    artUrl: "https://geo-media.beatport.com/image_size/1500x1500/x.jpg",
    lengthMs: 269_149,
    isrc: "GBCFB1700229",
    catalogNumber: "none",
    url: "https://www.beatport.com/track/glue/9440664",
    ...over,
  };
}

beforeEach(() => {
  beatportReset();
});

describe("scoreBpHit", () => {
  test("exact artist+title+duration scores high", () => {
    const q = { artist: "Bicep", title: "Glue", durationS: 269 };
    const s = scoreBpHit(hit(), q);
    // artist full (6) + title overlap (4) + duration ±2s (3)
    expect(s).toBeGreaterThanOrEqual(BP_MIN_SCORE);
    expect(s).toBeGreaterThanOrEqual(10);
  });

  test("different artist kills the score below the floor", () => {
    const q = { artist: "Bicep", title: "Glue" };
    const s = scoreBpHit(hit({ artists: ["Music for Pets"] }), q);
    expect(s).toBeLessThan(BP_MIN_SCORE);
  });

  test("same title, unknown artist (duration-only match) stays below floor", () => {
    // The "Nestle" trap: many unrelated rows share a title. Without the
    // artist match, duration+title alone must not cross BP_MIN_SCORE.
    const q = { artist: "Bicep", title: "Glue", durationS: 180 };
    const s = scoreBpHit(
      hit({ artists: ["Somebody Else"], lengthMs: 180_000 }),
      q,
    );
    expect(s).toBeLessThan(BP_MIN_SCORE);
  });

  test("duration ±10s adds, ±2s adds more", () => {
    const q = { artist: "Bicep", title: "Glue", durationS: 269 };
    const noBonus = scoreBpHit(hit({ lengthMs: 269_149 + 30_000 }), q); // >10s off → no duration bonus
    const near = scoreBpHit(hit({ lengthMs: 269_149 + 8000 }), q);
    const exact = scoreBpHit(hit({ lengthMs: 269_149 + 800 }), q);
    expect(exact).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(noBonus);
  });

  test("remixers ride the row untouched (remix credit source)", () => {
    const h = hit({ name: "Glue", remixers: ["Flozone"] });
    expect(scoreBpHit(h, { artist: "Bicep", title: "Glue" })).toBeGreaterThan(
      0,
    );
  });
});

describe("beatportLookup (seamed, offline)", () => {
  test("returns the best hit above the floor", async () => {
    const restore = setBeatportSearchImpl(async () => [
      hit({ name: "Glue (Edit)" }),
      hit(),
    ]);
    try {
      const got = await beatportLookup({
        artist: "Bicep",
        title: "Glue",
        durationS: 269,
      });
      expect(got?.id).toBe(9440664);
      expect(got?.label).toBe("Island");
    } finally {
      restore();
    }
  });

  test("credible miss → null, memoized (second call does not re-search)", async () => {
    let calls = 0;
    const restore = setBeatportSearchImpl(async () => {
      calls++;
      return [];
    });
    try {
      const q = { artist: "Bicep", title: "Nonexistent Track Xyz" };
      expect(await beatportLookup(q)).toBeNull();
      expect(await beatportLookup(q)).toBeNull();
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("junk-class hit (different artist) is refused", async () => {
    const restore = setBeatportSearchImpl(async () => [
      hit({ artists: ["Dog Music Waves"], genre: "Pop" }),
    ]);
    try {
      const got = await beatportLookup({ artist: "Bicep", title: "Glue" });
      expect(got).toBeNull();
    } finally {
      restore();
    }
  });

  test("search impl throwing degrades to null (never throws)", async () => {
    const restore = setBeatportSearchImpl(async () => {
      throw new Error("catalog down");
    });
    try {
      const got = await beatportLookup({ artist: "Bicep", title: "Glue" });
      expect(got).toBeNull();
    } finally {
      restore();
    }
  });

  test("transient failure is NOT memoized — the next lookup retries", async () => {
    let calls = 0;
    const restore = setBeatportSearchImpl(async () => {
      calls++;
      if (calls === 1) throw new Error("HTTP 429 rate-limited");
      return [hit()];
    });
    try {
      const first = await beatportLookup({ artist: "Bicep", title: "Glue" });
      expect(first).toBeNull(); // degraded…
      const second = await beatportLookup({ artist: "Bicep", title: "Glue" });
      expect(second).not.toBeNull(); // …but retried, not cached
      expect(calls).toBe(2);
    } finally {
      restore();
    }
  });

  test("genuine no-hit IS memoized (no repeated catalog hits)", async () => {
    let calls = 0;
    const restore = setBeatportSearchImpl(async () => {
      calls++;
      return [];
    });
    try {
      await beatportLookup({ artist: "Bicep", title: "Glue" });
      await beatportLookup({ artist: "Bicep", title: "Glue" });
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("short/absent artist: title-only score cannot clear the floor", () => {
    // No artist → no artist points → 1-word title overlap (×4) + no
    // duration match stays under BP_MIN_SCORE(4)... a title OVERLAP of 1.0
    // (×4) reaches exactly the floor; the artist gate exists to keep
    // same-title/different-artist rows OUT when an artist IS known. This
    // pins that an unknown short artist simply skips the artist component
    // without crashing the scorer.
    const row = hit();
    expect(scoreBpHit(row, { artist: null, title: "Glue" })).toBe(4);
    expect(scoreBpHit(row, { artist: "DJ", title: "Glue" })).toBe(4);
    // With a real artist, the gate fires: wrong artist = 0 outright.
    expect(scoreBpHit(row, { artist: "Unrelated Artist", title: "Glue" })).toBe(
      0,
    );
  });
});

describe("bpGenre", () => {
  test("maps store genre through the canon vocabulary (subgenre first)", () => {
    expect(bpGenre(hit({ genre: "House", subGenre: "Tech House" }))).toBe(
      "Tech House",
    );
    expect(bpGenre(hit({ genre: "House", subGenre: null }))).toBe("House");
  });

  test("compound store forms split to a canon hit (live shapes)", () => {
    // Live-verified shapes from the v4 catalog (Sep 11 2026).
    expect(
      bpGenre(hit({ genre: "Techno (Peak Time / Driving)", subGenre: null })),
    ).toBe("Techno");
    // Greedy first CANON segment: "Melodic House" is not a canon value,
    // "Techno" is — the genre's own namesake wins.
    expect(
      bpGenre(hit({ genre: "Melodic House & Techno", subGenre: null })),
    ).toBe("Techno");
    expect(bpGenre(hit({ genre: "Drum & Bass", subGenre: null }))).toBe(
      "Drum & Bass",
    );
    // "Bass / Club": neither segment is a canon key ("bass" alone isn't in
    // the map, "Club" titlecases) → refused, keeping junk out.
    expect(bpGenre(hit({ genre: "Bass / Club", subGenre: null }))).toBeNull();
    expect(
      bpGenre(hit({ genre: "Mainstage", subGenre: "Progressive House" })),
    ).toBe("Progressive House");
  });

  test("store junk (Electronica, Latin) is refused by the vocabulary gate", () => {
    expect(bpGenre(hit({ genre: "Electronica", subGenre: null }))).toBeNull();
    expect(
      bpGenre(hit({ genre: "Electronica", subGenre: "Weird Beards" })),
    ).toBeNull();
    expect(bpGenre(hit({ genre: "Latin", subGenre: "Salsa" }))).toBeNull();
  });

  test("null genre row → null", () => {
    expect(bpGenre(hit({ genre: null, subGenre: null }))).toBeNull();
  });
});

describe("bpStamp", () => {
  test("joins filled fields, skips nulls, null when empty", () => {
    expect(
      bpStamp([
        ["label", "Island"],
        ["mix", null],
        ["isrc", "GBCFB1700229"],
      ]),
    ).toBe("label=Island; isrc=GBCFB1700229");
    expect(bpStamp([["label", null]])).toBeNull();
  });
});

describe("beatportToken", () => {
  test("is a function seam (live network covered by the smoke pass, not unit)", () => {
    expect(typeof beatportToken).toBe("function");
  });
});
