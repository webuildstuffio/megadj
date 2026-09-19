// archive_tagcensus.test.ts — the FullTags ↔ rekordbox tag comparison
// reads. Fixtures build the real archive schema + a minimal rekordbox
// mirror (the lossless rb-adopt payload), so schema drift breaks here
// before it breaks the UI.
import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import { tempDir } from "./testutil";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  differ as _unusedDiffer,
  hasRekordboxMirror,
  tagCensus,
} from "../src/archive_tagcensus";
import { trackTagCompare } from "../src/archive_tagcompare";
import { ArchiveReader } from "../src/archive";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("cratedeck-tagcensus-").rippable();
const t2 = tempDir("cratedeck-tagcensus-norc-").rippable();
const t3 = tempDir("cratedeck-tagcensus-norc2-").rippable();
const t4 = tempDir("cratedeck-tagcensus-fresh-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
  t3.rippleAll();
  t4.rippleAll();
});

void _unusedDiffer; // differ is exercised through the public census reads

const dir = t.dir();
const dbPath = join(dir, "archive.db");
const seed = new Database(dbPath, { create: true });
seed.exec(`
  CREATE TABLE tracks (
    video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
    status TEXT NOT NULL DEFAULT 'pending', format_id TEXT,
    bitrate_kbps INTEGER, codec TEXT, file_path TEXT,
    file_size_bytes INTEGER, duration_s REAL,
    attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
    last_error TEXT, liked_position INTEGER,
    source TEXT NOT NULL DEFAULT 'liked', genre TEXT, energy INTEGER,
    artwork_status TEXT, year TEXT, genre_flag TEXT,
    first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE track_keys (
    video_id TEXT PRIMARY KEY, key TEXT NOT NULL,
    source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
  );
  CREATE TABLE beats (
    video_id TEXT PRIMARY KEY, bpm_raw REAL, bpm_folded REAL,
    beats_json TEXT NOT NULL, downbeats_json TEXT NOT NULL,
    model TEXT NOT NULL, source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
  );
  CREATE TABLE mood (
    video_id TEXT PRIMARY KEY, dance REAL NOT NULL,
    aggressive REAL NOT NULL, happy REAL NOT NULL,
    electronic REAL NOT NULL, party REAL NOT NULL,
    valence REAL NOT NULL, arousal REAL NOT NULL,
    source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL
  );
  CREATE TABLE rekordbox_content (
    content_id TEXT NOT NULL, video_id TEXT NOT NULL,
    source_db TEXT NOT NULL, folder_path TEXT NOT NULL,
    metadata_json TEXT NOT NULL, first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source_db, content_id)
  );
`);

const insT = seed.query(
  `INSERT INTO tracks (video_id, title, artist, status, genre, genre_flag,
     first_seen_at, updated_at)
   VALUES (?, ?, ?, 'downloaded', ?, ?, '2026-09-15', '2026-09-15')`,
);
const insRc = seed.query(
  `INSERT INTO rekordbox_content (content_id, video_id, source_db,
     folder_path, metadata_json, first_seen_at, updated_at)
   VALUES (?, ?, 'test', '/x', ?, '2026-09-15', '2026-09-15')`,
);
const insKey = seed.query(
  `INSERT INTO track_keys (video_id, key, source_path, analyzed_at)
   VALUES (?, ?, '/x', '2026-09-15')`,
);
const insBeats = seed.query(
  `INSERT INTO beats (video_id, bpm_folded, beats_json, downbeats_json,
     model, source_path, analyzed_at)
   VALUES (?, ?, '[]', '[]', 'test', '/x', '2026-09-15')`,
);

/** RB mirror payload — only the fields the census extracts. */
const rbMeta = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    ID: "1",
    Title: null,
    ArtistName: null,
    GenreName: null,
    KeyName: null,
    BPM: null,
    ReleaseYear: null,
    LabelName: null,
    Commnt: null,
    ...fields,
  });

const reader = new ArchiveReader(dbPath);

beforeEach(() => {
  seed.exec("DELETE FROM tracks; DELETE FROM rekordbox_content;");
});

afterAll(() => {
  reader.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("hasRekordboxMirror", () => {
  it("false when the mirror table is absent", () => {
    const altDir = t2.dir();
    const alt = new ArchiveReader(join(altDir, "archive.db"));
    try {
      expect(hasRekordboxMirror(alt)).toBe(false);
    } finally {
      alt.close();
      rmSync(altDir, { recursive: true, force: true });
    }
  });

  it("true when rb-adopt has run", () => {
    expect(hasRekordboxMirror(reader)).toBe(true);
  });
});

describe("tagCensus", () => {
  it("degrades to rekordboxMirror:false on a mirror-less DB", () => {
    const altDir = t3.dir();
    const alt = new ArchiveReader(join(altDir, "archive.db"));
    try {
      const c = tagCensus(alt);
      expect(c.available).toBe(false);
      expect(c.rekordboxMirror).toBe(false);
    } finally {
      alt.close();
      rmSync(altDir, { recursive: true, force: true });
    }
  });

  it("counts field disagreements and sorts worst-first", () => {
    insT.run("a", "Track A", "Artist", "House", null);
    insKey.run("a", "8A");
    insRc.run("1", "a", rbMeta({ GenreName: "House", KeyName: "8A" }));

    insT.run("b", "Track B", "Artist", "EDM", "disputed");
    insRc.run(
      "2",
      "b",
      rbMeta({ GenreName: "Tech House", Title: "Track B (Remix)" }),
    );

    const c = tagCensus(reader);
    expect(c.available).toBe(true);
    expect(c.matched).toBe(2);
    expect(c.differing).toBe(1);
    expect(c.unmatched).toBe(0);
    // worst first: the differing row leads
    expect(c.rows[0]!.videoId).toBe("b");
    expect(c.rows[0]!.differs).toContain("genre");
    expect(c.rows[0]!.differs).toContain("title");
    expect(c.rows[0]!.genreFlag).toBe("disputed");
    expect(c.rows[1]!.differs).toEqual([]);
    // per-field counts: genre disagrees once, title once
    const genre = c.fieldCounts.find((f) => f.field === "genre");
    expect(genre?.count).toBe(1);
  });

  it("treats case/trim variants as agreement, null-vs-set as difference", () => {
    insT.run("c", " Track C ", "Artist", "house", null);
    insRc.run("3", "c", rbMeta({ GenreName: "House" }));
    const c = tagCensus(reader);
    expect(c.differing).toBe(0);
    expect(c.rows[0]!.differs).toEqual([]);
  });

  it("counts tracks with no mirror row as unmatched", () => {
    insT.run("d", "Track D", "Artist", "House", null);
    insT.run("e", "Track E", "Artist", "House", null);
    insRc.run("4", "d", rbMeta({ GenreName: "House" }));
    const c = tagCensus(reader);
    expect(c.matched).toBe(1);
    expect(c.unmatched).toBe(1);
  });

  it("prefers the newest mirror row per track (duplicate Content rows)", () => {
    insT.run("f", "Track F", "Artist", "House", null);
    insRc.run("10", "f", rbMeta({ GenreName: "House", updatedHint: 1 }));
    insRc.run("11", "f", rbMeta({ GenreName: "Drum & Bass" }));
    const c = tagCensus(reader);
    expect(c.matched).toBe(1);
    expect(c.rows[0]!.rekordboxGenre).toBe("Drum & Bass");
  });

  it("ignores invalid mirror JSON (row counts as no-genre, not a crash)", () => {
    insT.run("g", "Track G", "Artist", "House", null);
    insRc.run("5", "g", "not json{{{");
    const c = tagCensus(reader);
    expect(c.rows[0]!.rekordboxGenre).toBeNull();
    // corrupt JSON = no claim from the RB side → NOT a disagreement
    // (null-vs-set is absence of evidence, per the differ contract)
    expect(c.differing).toBe(0);
  });
});

describe("trackTagCompare", () => {
  it("assembles the three-source view with differences", () => {
    insT.run("h", "Track H", "Artist H", "EDM", "disputed");
    insKey.run("h", "8A");
    insBeats.run("h", 128.4);
    insRc.run(
      "6",
      "h",
      rbMeta({
        Title: "Track H",
        GenreName: "House",
        KeyName: "9A",
        BPM: 12800,
        LabelName: "Test Label",
        Commnt: "8A · E9 · Dance+Party",
      }),
    );
    const cmp = trackTagCompare(reader, "h");
    expect(cmp.available).toBe(true);
    expect(cmp.file).toBeNull(); // no physical file in the fixture
    expect(cmp.pipeline.genre).toBe("EDM");
    expect(cmp.pipeline.genreFlag).toBe("disputed");
    expect(cmp.pipeline.bpmFolded).toBe(128.4);
    expect(cmp.rekordbox?.genre).toBe("House");
    expect(cmp.rekordbox?.bpm).toBe(128);
    expect(cmp.rekordbox?.comment).toBe("8A · E9 · Dance+Party");
    const fields = cmp.differences.map((d) => d.field);
    expect(fields).toContain("genre"); // EDM vs House
    expect(fields).toContain("key"); // 8A vs 9A
    expect(fields).not.toContain("title"); // both "Track H"
    expect(fields).not.toContain("label"); // only RB set it — no conflict
  });

  it("returns an honest no-RB-row shape for unlinked tracks", () => {
    insT.run("i", "Track I", "Artist I", "House", null);
    const cmp = trackTagCompare(reader, "i");
    expect(cmp.rekordbox).toBeNull();
    expect(cmp.pipeline.genre).toBe("House");
    expect(cmp.differences).toEqual([]);
  });

  it("unknown video_id → available:false (route maps to 404/503 upstream)", () => {
    const cmp = trackTagCompare(reader, "missing");
    expect(cmp.available).toBe(true); // DB present
    expect(cmp.title).toBeNull();
    expect(cmp.differences).toEqual([]);
  });
});

describe("tagCensus freshness (#174)", () => {
  it("surfaces ledger stamps from MAX(analyzed_at), never mtimes", () => {
    insBeats.run("a", 128.0);
    const c = tagCensus(reader);
    // the fixture's analyzed_at is '2026-09-15' — the census must carry
    // it so the UI can band the census's age (green/amber/red)
    expect(c.freshness.beatsAt).toBe("2026-09-15");
    expect(c.freshness.moodAt).toBeNull();
  });

  it("degrades to null stamps on a mirror-less DB (no throw)", () => {
    const altDir = t4.dir();
    const alt = new ArchiveReader(join(altDir, "archive.db"));
    try {
      const c = tagCensus(alt);
      expect(c.freshness.beatsAt).toBeNull();
      expect(c.freshness.moodAt).toBeNull();
    } finally {
      alt.close();
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});
