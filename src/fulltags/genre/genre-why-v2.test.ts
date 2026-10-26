/**
 * genre-why-v2.test.ts — Tests for v2 genre-why output (B5.6).
 */
import { describe, expect, test } from "bun:test";
import {
  evidenceToAnnotations,
  formatGenreWhyV2,
  type GenreWhyEvidence,
  type GenreWhyV2Result,
} from "./genre-why-v2";

describe("evidenceToAnnotations", () => {
  test("converts evidence to annotations", () => {
    const evidence: GenreWhyEvidence[] = [
      {
        source: "beatport",
        scope: "exact_recording",
        rawGenre: "Deep House",
        family: "house",
        weight: 1,
        collapsed: false,
        audioMatch: null,
        verification: "unverified",
      },
      {
        source: "soundcloud",
        scope: "same_song_other_version",
        rawGenre: "Techno",
        family: "techno",
        weight: 0.5,
        collapsed: true,
        audioMatch: 0.85,
        verification: "verified",
      },
    ];
    const anns = evidenceToAnnotations("track1", evidence);
    expect(anns).toHaveLength(2);
    expect(anns[0]!.annotatorId).toBe("beatport:exact_recording");
    expect(anns[0]!.label).toBe("house");
    expect(anns[1]!.annotatorId).toBe("soundcloud:same_song_other_version");
  });

  test("filters out null family", () => {
    const evidence: GenreWhyEvidence[] = [
      {
        source: "itunes",
        scope: "exact_recording",
        rawGenre: "Electronic",
        family: null,
        weight: 1,
        collapsed: false,
        audioMatch: null,
        verification: "unverified",
      },
    ];
    const anns = evidenceToAnnotations("track1", evidence);
    expect(anns).toHaveLength(0);
  });
});

describe("formatGenreWhyV2", () => {
  test("formats full result with evidence and posterior", () => {
    const result: GenreWhyV2Result = {
      videoId: "abc123",
      title: "Test Track",
      artist: "Test Artist",
      dbGenre: "house",
      evidence: [
        {
          source: "beatport",
          scope: "exact_recording",
          rawGenre: "Deep House",
          family: "house",
          weight: 1,
          collapsed: false,
          audioMatch: null,
          verification: "verified",
        },
      ],
      posterior: {
        trackId: "abc123",
        family: "house",
        probability: 0.92,
        family2: "techno",
        probability2: 0.05,
        distribution: new Map([
          ["house", 0.92],
          ["techno", 0.05],
          ["trance", 0.03],
        ]),
      },
      l3Ranked: [{ subgenre: "deep house", family: "house", probability: 0.65, voteCount: 3 }],
      annotators: [
        { annotatorId: "beatport:exact_recording", confusion: new Map(), accuracy: 0.95 },
      ],
      versionType: null,
      posteriorMatchesDb: true,
      confidence: 0.92,
    };
    const lines = formatGenreWhyV2(result);
    expect(lines.join("\n")).toContain("Track: Test Track");
    expect(lines.join("\n")).toContain("Posterior: house (92.0%)");
    expect(lines.join("\n")).toContain("deep house (65.0%, 3 votes)");
    expect(lines.join("\n")).toContain("accuracy=95.0%");
  });

  test("shows drift when posterior disagrees with DB", () => {
    const result: GenreWhyV2Result = {
      videoId: "abc123",
      title: "Drifted Track",
      artist: "Some Artist",
      dbGenre: "techno",
      evidence: [],
      posterior: {
        trackId: "abc123",
        family: "house",
        probability: 0.85,
        family2: "techno",
        probability2: 0.1,
        distribution: new Map([
          ["house", 0.85],
          ["techno", 0.1],
        ]),
      },
      l3Ranked: [],
      annotators: [],
      versionType: "remix",
      posteriorMatchesDb: false,
      confidence: 0.85,
    };
    const lines = formatGenreWhyV2(result);
    expect(lines.join("\n")).toContain("DRIFT");
    expect(lines.join("\n")).toContain("Version: remix");
  });

  test("handles empty evidence gracefully", () => {
    const result: GenreWhyV2Result = {
      videoId: "abc123",
      title: "Empty Track",
      artist: "Unknown",
      dbGenre: null,
      evidence: [],
      posterior: null,
      l3Ranked: [],
      annotators: [],
      versionType: null,
      posteriorMatchesDb: true,
      confidence: 0,
    };
    const lines = formatGenreWhyV2(result);
    expect(lines.join("\n")).toContain("DB Genre: null");
    expect(lines.join("\n")).not.toContain("Posterior:");
  });
});
