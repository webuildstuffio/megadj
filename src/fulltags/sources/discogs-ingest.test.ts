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
  });
});
