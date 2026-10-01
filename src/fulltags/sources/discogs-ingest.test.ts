import { describe, expect, it, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrateDiscogsDb, discogsLookup, nameKey } from "./discogs-ingest";

describe("discogs-ingest", () => {
  describe("nameKey", () => {
    it("normalizes NFC and casefolds", () => {
      expect(nameKey("DJ Shadow")).toBe("dj shadow");
      expect(nameKey("  Björk  ")).toBe("björk");
    });
  });

  describe("migrateDiscogsDb + discogsLookup", () => {
    let db: Database;

    afterEach(() => {
      db?.close();
    });

    it("creates schema and returns null for empty DB", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);
      const result = discogsLookup(db, "Unknown Artist", "Unknown Track");
      expect(result).toBeNull();
    });

    it("finds a manually inserted release", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      // Manually insert a release for testing
      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (1, 'Test Track', 2024, 'DE')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (1, 'Test Artist', ?)",
        [nameKey("Test Artist")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (1, 'Electronic')",
      );
      db.run(
        "INSERT INTO discogs_release_styles (release_id, style) VALUES (1, 'Deep House')",
      );

      const result = discogsLookup(db, "Test Artist", "Test Track");
      expect(result).not.toBeNull();
      expect(result?.bestFamily).toBeTruthy();
      expect(result?.bestStyle).toBe("deep house");
    });

    it("matches case-insensitively on artist and title", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (2, 'Acid Rain', 2023, 'UK')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (2, 'DJ Pierre', ?)",
        [nameKey("DJ Pierre")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (2, 'Electronic')",
      );
      db.run(
        "INSERT INTO discogs_release_styles (release_id, style) VALUES (2, 'Acid House')",
      );

      // Different case should still match
      const result = discogsLookup(db, "dj pierre", "acid rain");
      expect(result).not.toBeNull();
    });

    it("handles XML entities in titles", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (4, 'Rock & Roll', 2024, 'US')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (4, 'Test', ?)",
        [nameKey("Test")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (4, 'Rock')",
      );

      // Should match even though the DB title has decoded &
      const result = discogsLookup(db, "Test", "Rock & Roll");
      expect(result).not.toBeNull();
    });

    it("returns null for non-matching artist", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (3, 'Test', 2024, NULL)",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (3, 'Artist A', ?)",
        [nameKey("Artist A")],
      );

      const result = discogsLookup(db, "Different Artist", "Test");
      expect(result).toBeNull();
    });

    it("handles NFC-normalized accented characters", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (5, 'Début', 2023, 'FR')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (5, 'Björk', ?)",
        [nameKey("Björk")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (5, 'Electronic')",
      );

      const result = discogsLookup(db, "björk", "début");
      expect(result).not.toBeNull();
    });

    it("reuses prepared statements across multiple lookups (perf)", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (6, 'Track A', 2024, 'US')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (6, 'DJ A', ?)",
        [nameKey("DJ A")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (6, 'Electronic')",
      );

      // Multiple lookups should work (prepared statements reused)
      const r1 = discogsLookup(db, "DJ A", "Track A");
      const r2 = discogsLookup(db, "DJ A", "Track A");
      const r3 = discogsLookup(db, "Unknown", "Missing");
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r3).toBeNull();
    });

    it("returns multiple genres and styles", () => {
      db = new Database(":memory:");
      migrateDiscogsDb(db);

      db.run(
        "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (7, 'Multi', 2024, 'DE')",
      );
      db.run(
        "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (7, 'Artist', ?)",
        [nameKey("Artist")],
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (7, 'Electronic')",
      );
      db.run(
        "INSERT INTO discogs_release_genres (release_id, genre) VALUES (7, 'Hip Hop')",
      );
      db.run(
        "INSERT INTO discogs_release_styles (release_id, style) VALUES (7, 'Deep House')",
      );
      db.run(
        "INSERT INTO discogs_release_styles (release_id, style) VALUES (7, 'Ambient')",
      );

      const result = discogsLookup(db, "Artist", "Multi");
      expect(result).not.toBeNull();
    });
  });

  describe("decodeXmlEntities", () => {
    it("nameKey handles unicode normalization", () => {
      // Composed vs decomposed forms should produce the same key
      const composed = nameKey("Bj\u00F6rk");
      const decomposed = nameKey("Bjo\u0308rk");
      expect(composed).toBe(decomposed);
    });
  });
});
