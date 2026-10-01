import { describe, expect, it, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tempDir } from "../../test-support/testutil";
import { bridgeVotesToEvidence } from "./vote-evidence-bridge";
import { loadEvidence } from "./evidence-store";
import type { GenreVote } from "../genre/genre-vote";

describe("bridgeVotesToEvidence", () => {
  const td = tempDir("megadj-vote-bridge-");
  afterAll(() => td.rippleAll());

  let db: Database;

  beforeEach(() => {
    const dir = td.dir();
    db = new Database(join(dir, "test.db"));
  });

  it("converts votes to evidence rows", () => {
    const votes: GenreVote[] = [
      { rung: "bp", genre: "Techno", weight: 0.6, detail: "bp:123" },
      { rung: "sc", genre: "House", weight: 0.35, detail: "sc:hit" },
    ];

    const count = bridgeVotesToEvidence(db, "track-1", votes);
    expect(count).toBe(2);

    const rows = loadEvidence(db, "track-1");
    expect(rows.length).toBe(2);

    const bpRow = rows.find((r) => r.annotatorId === "vote:bp");
    expect(bpRow).toBeDefined();
    expect(bpRow?.genreFamily.toLowerCase()).toBe("techno");
    expect(bpRow?.scope).toBe("exact_recording");
    expect(bpRow?.confidence).toBe(0.9);

    const scRow = rows.find((r) => r.annotatorId === "vote:sc");
    expect(scRow).toBeDefined();
    expect(scRow?.genreFamily.toLowerCase()).toBe("house");
    expect(scRow?.scope).toBe("artist");
  });

  it("upserts on repeated calls (idempotent)", () => {
    const votes: GenreVote[] = [{ rung: "bp", genre: "Techno", weight: 0.6 }];

    bridgeVotesToEvidence(db, "track-2", votes);
    bridgeVotesToEvidence(db, "track-2", votes);

    const rows = loadEvidence(db, "track-2");
    expect(rows.length).toBe(1);
  });

  it("returns 0 for empty votes", () => {
    expect(bridgeVotesToEvidence(db, "track-3", [])).toBe(0);
  });

  it("skips votes with unmappable genres", () => {
    const votes: GenreVote[] = [
      { rung: "sc", genre: "Not A Real Genre XYZZY", weight: 0.35 },
    ];
    const count = bridgeVotesToEvidence(db, "track-4", votes);
    expect(count).toBe(0);
  });

  it("stores subgenre when genre differs from family", () => {
    const votes: GenreVote[] = [
      { rung: "discogs", genre: "Acid House", weight: 0.55 },
    ];
    bridgeVotesToEvidence(db, "track-5", votes);
    const rows = loadEvidence(db, "track-5");
    const dg = rows.find((r) => r.annotatorId === "vote:discogs");
    expect(dg?.genreFamily.toLowerCase()).toBe("house");
    expect(dg?.genreSubgenre).toBe("Acid House");
  });

  it("sets null subgenre when genre equals family", () => {
    const votes: GenreVote[] = [{ rung: "bp", genre: "techno", weight: 0.6 }];
    bridgeVotesToEvidence(db, "track-6", votes);
    const rows = loadEvidence(db, "track-6");
    expect(rows[0]?.genreSubgenre).toBeNull();
  });

  it("maps all rung types to valid scopes", () => {
    const allRungs: GenreVote[] = [
      { rung: "bp", genre: "Techno", weight: 0.6 },
      { rung: "file", genre: "House", weight: 0.55 },
      { rung: "bc", genre: "Techno", weight: 0.5 },
      { rung: "ai", genre: "Techno", weight: 0.45 },
      { rung: "mb", genre: "House", weight: 0.4 },
      { rung: "sc", genre: "Techno", weight: 0.35 },
      { rung: "lastfm", genre: "House", weight: 0.3 },
      { rung: "discogs", genre: "Techno", weight: 0.55 },
    ];
    const count = bridgeVotesToEvidence(db, "track-7", allRungs);
    expect(count).toBeGreaterThan(0);
    const rows = loadEvidence(db, "track-7");
    for (const r of rows) {
      expect(
        [
          "exact_recording",
          "artist",
          "user",
          "label",
          "same_song_other_version",
          "remixer",
          "uploader",
        ].includes(r.scope),
      ).toBe(true);
    }
  });

  it("normalizes familyOf output to taxonomy-v3 family names", () => {
    const votes: GenreVote[] = [
      { rung: "bp", genre: "Hip-Hop", weight: 0.6 },
      { rung: "bp", genre: "EDM", weight: 0.6 },
      { rung: "sc", genre: "Funk", weight: 0.35 },
    ];
    bridgeVotesToEvidence(db, "track-norm", votes);
    const rows = loadEvidence(db, "track-norm");
    const families = rows.map((r) => r.genreFamily);
    expect(families).toContain("hip hop");
    expect(families).toContain("electro");
    expect(families).toContain("funk");
  });

  it("WeakSet cache prevents repeated migration", () => {
    // First call migrates
    bridgeVotesToEvidence(db, "track-8", [
      { rung: "bp", genre: "Techno", weight: 0.6 },
    ]);
    // Second call should not throw even though the table exists
    bridgeVotesToEvidence(db, "track-9", [
      { rung: "sc", genre: "House", weight: 0.35 },
    ]);
    const r8 = loadEvidence(db, "track-8");
    const r9 = loadEvidence(db, "track-9");
    expect(r8.length).toBe(1);
    expect(r9.length).toBe(1);
  });
});
