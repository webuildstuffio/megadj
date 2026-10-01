import {
  describe,
  expect,
  it,
  afterAll,
  afterEach,
  beforeEach,
} from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tempDir } from "../../test-support/testutil";
import { migrateDiscogsDb, nameKey } from "./discogs-ingest";
import { discogsGenreVote, discogsDbClose } from "./discogs-vote";
import { GENRE_VOTE_WEIGHTS } from "../genre/genre-vote";

describe("discogsGenreVote", () => {
  const td = tempDir("megadj-discogs-vote-");
  afterAll(() => td.rippleAll());

  let dbPath: string;

  beforeEach(() => {
    const dir = td.dir();
    dbPath = join(dir, "test-discogs.db");
    const db = new Database(dbPath);
    migrateDiscogsDb(db);

    db.run(
      "INSERT INTO discogs_releases (release_id, title, year, country) VALUES (42, 'Acid Trax', 1987, 'US')",
    );
    db.run(
      "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (42, 'Phuture', ?)",
      [nameKey("Phuture")],
    );
    db.run(
      "INSERT INTO discogs_release_genres (release_id, genre) VALUES (42, 'Electronic')",
    );
    db.run(
      "INSERT INTO discogs_release_styles (release_id, style) VALUES (42, 'Acid House')",
    );
    db.close();

    process.env["MEGADJ_DISCOGS_DB"] = dbPath;
  });

  afterEach(() => {
    discogsDbClose();
    delete process.env["MEGADJ_DISCOGS_DB"];
  });

  it("returns a vote for a matching release", () => {
    const vote = discogsGenreVote("Phuture", "Acid Trax");
    expect(vote).not.toBeNull();
    expect(vote?.rung).toBe("discogs");
    expect(vote?.weight).toBe(GENRE_VOTE_WEIGHTS.discogs);
    expect(vote?.genre).toBeTruthy();
    expect(vote?.detail).toContain("discogs:42");
  });

  it("returns null for non-matching artist+title", () => {
    const vote = discogsGenreVote("Unknown Artist", "Unknown Track");
    expect(vote).toBeNull();
  });

  it("returns null when MEGADJ_DISCOGS_DB is unset", () => {
    discogsDbClose();
    delete process.env["MEGADJ_DISCOGS_DB"];
    const vote = discogsGenreVote("Phuture", "Acid Trax");
    expect(vote).toBeNull();
  });

  it("returns null when DB path does not exist", () => {
    discogsDbClose();
    process.env["MEGADJ_DISCOGS_DB"] = "/tmp/nonexistent-db-path.db";
    const vote = discogsGenreVote("Phuture", "Acid Trax");
    expect(vote).toBeNull();
  });

  it("caches the DB handle — repeated calls reuse the same DB", () => {
    const v1 = discogsGenreVote("Phuture", "Acid Trax");
    const v2 = discogsGenreVote("Phuture", "Acid Trax");
    expect(v1?.genre).toBe(v2?.genre);
  });

  it("vote detail includes release ID and style", () => {
    const vote = discogsGenreVote("Phuture", "Acid Trax");
    expect(vote?.detail).toContain("discogs:42");
    expect(vote?.detail).toContain("style:");
  });
});
