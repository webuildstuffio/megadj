/**
 * sibling-collapse.test.ts — Tests for evidence sibling collapse (B3.5).
 */
import { describe, expect, test } from "bun:test";
import type { GenreEvidence } from "./evidence-store";
import {
  collapseEvidence,
  collapseEvidenceBatch,
  buildRemixerPrior,
} from "./sibling-collapse";

const now = "2026-09-29 00:00:00";

function ev(
  annotatorId: string,
  scope: GenreEvidence["scope"],
  family: string,
  confidence = 1.0,
): GenreEvidence {
  return {
    trackId: "t1",
    annotatorId,
    scope,
    genreFamily: family,
    genreSubgenre: null,
    confidence,
    verified: false,
    audioMatch: null,
    sourceUrl: null,
    evidence: null,
    createdAt: now,
  };
}

describe("collapseEvidence", () => {
  test("direct evidence passes through unchanged", () => {
    const rows = [
      ev("beatport:exact_recording", "exact_recording", "house"),
      ev("discogs:artist", "artist", "techno"),
    ];
    const result = collapseEvidence("t1", rows);
    expect(result.direct).toHaveLength(2);
    expect(result.collapsed).toHaveLength(0);
    expect(result.siblingRowsIn).toBe(0);
    expect(result.siblingRowsOut).toBe(0);
  });

  test("sibling evidence collapses by family — majority wins", () => {
    const rows = [
      ev(
        "beatport:same_song_other_version",
        "same_song_other_version",
        "house",
        0.8,
      ),
      ev(
        "traxsource:same_song_other_version",
        "same_song_other_version",
        "house",
        0.9,
      ),
      ev(
        "juno:same_song_other_version",
        "same_song_other_version",
        "house",
        0.7,
      ),
      ev(
        "itunes:same_song_other_version",
        "same_song_other_version",
        "techno",
        0.6,
      ),
      ev(
        "deezer:same_song_other_version",
        "same_song_other_version",
        "techno",
        0.5,
      ),
    ];
    const result = collapseEvidence("t1", rows);
    expect(result.direct).toHaveLength(0);
    expect(result.collapsed).toHaveLength(2); // one house, one techno
    expect(result.siblingRowsIn).toBe(5);
    expect(result.siblingRowsOut).toBe(2);

    const house = result.collapsed.find((r) => r.genreFamily === "house");
    expect(house).toBeDefined();
    expect(house!.confidence).toBe(0.9); // max of the 3 house sources
    expect(house!.evidence).toContain("3 sibling");
  });

  test("Taylor Swift fixture: 5 sibling votes collapse to 1", () => {
    // §4.4: "Five sources describing the Taylor Swift original = one fact"
    const rows = [
      ev("beatport:same_song_other_version", "same_song_other_version", "pop"),
      ev("itunes:same_song_other_version", "same_song_other_version", "pop"),
      ev("deezer:same_song_other_version", "same_song_other_version", "pop"),
      ev("lastfm:same_song_other_version", "same_song_other_version", "pop"),
      ev("discogs:same_song_other_version", "same_song_other_version", "pop"),
    ];
    const result = collapseEvidence("t1", rows);
    expect(result.collapsed).toHaveLength(1);
    expect(result.collapsed[0]!.genreFamily).toBe("pop");
    expect(result.siblingRowsIn).toBe(5);
    expect(result.siblingRowsOut).toBe(1);
  });

  test("mixed direct and sibling evidence both preserved", () => {
    const rows = [
      ev("beatport:exact_recording", "exact_recording", "house", 0.95),
      ev(
        "itunes:same_song_other_version",
        "same_song_other_version",
        "house",
        0.7,
      ),
      ev(
        "deezer:same_song_other_version",
        "same_song_other_version",
        "house",
        0.6,
      ),
      ev("discogs:artist", "artist", "techno", 0.5),
    ];
    const result = collapseEvidence("t1", rows);
    expect(result.direct).toHaveLength(2); // exact + artist
    expect(result.collapsed).toHaveLength(1); // collapsed siblings
    expect(result.siblingRowsIn).toBe(2);
  });

  test("empty input returns empty", () => {
    const result = collapseEvidence("t1", []);
    expect(result.direct).toHaveLength(0);
    expect(result.collapsed).toHaveLength(0);
    expect(result.siblingRowsIn).toBe(0);
    expect(result.siblingRowsOut).toBe(0);
  });
});

describe("collapseEvidenceBatch", () => {
  test("processes multiple tracks", () => {
    const byTrack = new Map<string, GenreEvidence[]>();
    byTrack.set("t1", [
      ev("bp:ssov", "same_song_other_version", "house"),
      ev("it:ssov", "same_song_other_version", "house"),
    ]);
    byTrack.set("t2", [ev("bp:exact", "exact_recording", "techno")]);

    const { rows, stats } = collapseEvidenceBatch(byTrack);
    expect(stats.tracksProcessed).toBe(2);
    expect(stats.siblingRowsIn).toBe(2);
    expect(stats.siblingRowsOut).toBe(1);
    // t1: 1 collapsed house; t2: 1 direct techno
    expect(rows).toHaveLength(2);
  });
});

describe("buildRemixerPrior", () => {
  test("builds prior for a remix with catalog genres", () => {
    const rows = buildRemixerPrior(
      "t1",
      "remix",
      ["Fred Again"],
      [
        { family: "house", confidence: 0.8 },
        { family: "uk bass", confidence: 0.5 },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.scope).toBe("remixer");
    expect(rows[0]!.annotatorId).toContain("fred again");
    expect(rows[0]!.genreFamily).toBe("house");
    expect(rows[1]!.genreFamily).toBe("uk bass");
  });

  test("returns empty for non-remix version types", () => {
    expect(
      buildRemixerPrior(
        "t1",
        "original",
        ["Artist"],
        [{ family: "house", confidence: 1 }],
      ),
    ).toHaveLength(0);
    expect(
      buildRemixerPrior(
        "t1",
        "extended",
        ["Artist"],
        [{ family: "house", confidence: 1 }],
      ),
    ).toHaveLength(0);
    expect(
      buildRemixerPrior(
        "t1",
        "live",
        ["Artist"],
        [{ family: "house", confidence: 1 }],
      ),
    ).toHaveLength(0);
  });

  test("returns empty when no version artists", () => {
    expect(
      buildRemixerPrior(
        "t1",
        "remix",
        [],
        [{ family: "house", confidence: 1 }],
      ),
    ).toHaveLength(0);
  });

  test("returns empty when no remixer genres available", () => {
    expect(buildRemixerPrior("t1", "remix", ["Fred Again"], [])).toHaveLength(
      0,
    );
  });

  test("handles all remixer version types", () => {
    for (const vt of ["remix", "edit", "bootleg", "flip", "vip", "rework"]) {
      const rows = buildRemixerPrior(
        "t1",
        vt,
        ["DJ"],
        [{ family: "techno", confidence: 0.7 }],
      );
      expect(rows).toHaveLength(1);
    }
  });
});
