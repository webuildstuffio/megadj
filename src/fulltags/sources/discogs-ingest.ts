/**
 * discogs-ingest.ts — Stream-parse a Discogs monthly XML dump into a
 * local SQLite DB for offline artist+title → genre/style lookups.
 *
 * The Discogs CC0 data dump ships as gzipped XML (~70 GB compressed,
 * ~500 GB uncompressed for the full releases file). We stream-parse it
 * with sax-wasm (never load the whole file in memory) and store:
 *
 * - discogs_releases: releaseId, title, year, country
 * - discogs_release_artists: releaseId → artist (NFC-casefolded name_key)
 * - discogs_release_genres: releaseId → genre (broad Discogs genre)
 * - discogs_release_styles: releaseId → style (specific, L3-level)
 *
 * After ingest, `discogsLookup(artist, title)` queries the local DB and
 * returns a DiscogsGenreResult via mapDiscogsRelease. No network needed.
 *
 * Usage: `megadj discogs-ingest <path-to-discogs_*.xml.gz>`
 */
import { Database } from "bun:sqlite";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import {
  type DiscogsRelease,
  mapDiscogsRelease,
  parseDiscogsYear,
  type DiscogsGenreResult,
} from "./discogs";

/** Default path for the Discogs cache DB. */
const DEFAULT_DB_PATH = "discogs-cache.db";

/** Ensure the Discogs cache schema exists. */
export function migrateDiscogsDb(db: Database): void {
  db.run("PRAGMA journal_mode=WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS discogs_releases (
      release_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER,
      country TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS discogs_release_artists (
      release_id INTEGER NOT NULL,
      artist TEXT NOT NULL,
      name_key TEXT NOT NULL,
      FOREIGN KEY (release_id) REFERENCES discogs_releases(release_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS discogs_release_styles (
      release_id INTEGER NOT NULL,
      style TEXT NOT NULL,
      FOREIGN KEY (release_id) REFERENCES discogs_releases(release_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS discogs_release_genres (
      release_id INTEGER NOT NULL,
      genre TEXT NOT NULL,
      FOREIGN KEY (release_id) REFERENCES discogs_releases(release_id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_discogs_artists_key
    ON discogs_release_artists(name_key)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_discogs_artists_release
    ON discogs_release_artists(release_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_discogs_genres_release
    ON discogs_release_genres(release_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_discogs_styles_release
    ON discogs_release_styles(release_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_discogs_releases_title
    ON discogs_releases(title COLLATE NOCASE)
  `);
}

/** NFC + casefold for matching (shared convention with pathKey). */
export function nameKey(s: string): string {
  return s.normalize("NFC").toLowerCase().trim();
}

/** Decode the 5 predefined XML entities (Discogs dump uses these). */
function decodeXmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"');
}

/** Insert one release and its relations into the DB. */
function insertRelease(stmts: ReturnType<typeof prepareStatements>, rel: DiscogsRelease): void {
  stmts.insertRelease.run(rel.releaseId, rel.title, rel.year, rel.country);
  for (const a of rel.artists) {
    stmts.insertArtist.run(rel.releaseId, a, nameKey(a));
  }
  for (const g of rel.genres) {
    stmts.insertGenre.run(rel.releaseId, g);
  }
  for (const s of rel.styles) {
    stmts.insertStyle.run(rel.releaseId, s);
  }
}

function prepareStatements(db: Database) {
  return {
    insertRelease: db.prepare(
      "INSERT OR IGNORE INTO discogs_releases (release_id, title, year, country) VALUES (?, ?, ?, ?)",
    ),
    insertArtist: db.prepare(
      "INSERT INTO discogs_release_artists (release_id, artist, name_key) VALUES (?, ?, ?)",
    ),
    insertGenre: db.prepare("INSERT INTO discogs_release_genres (release_id, genre) VALUES (?, ?)"),
    insertStyle: db.prepare("INSERT INTO discogs_release_styles (release_id, style) VALUES (?, ?)"),
  };
}

/**
 * Stream-parse a Discogs releases XML dump (gzipped or plain) into the
 * cache DB. Uses a simple line-based state machine (no external XML
 * parser dep — the Discogs release format is flat enough).
 *
 * Returns the number of releases ingested.
 */
export async function ingestDiscogsXml(
  xmlPath: string,
  dbPath: string = DEFAULT_DB_PATH,
  opts?: { onProgress?: (count: number) => void; electronicOnly?: boolean },
): Promise<{ releases: number; skipped: number }> {
  const db = new Database(dbPath);
  migrateDiscogsDb(db);

  const stmts = prepareStatements(db);
  const insertBatch = db.transaction((releases: DiscogsRelease[]) => {
    for (const rel of releases) insertRelease(stmts, rel);
  });

  const isGz = xmlPath.endsWith(".gz");
  const fileStream = createReadStream(xmlPath);
  const stream = isGz ? fileStream.pipe(createGunzip()) : fileStream;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let releases = 0;
  let skipped = 0;
  const batch: DiscogsRelease[] = [];
  const BATCH_SIZE = 5_000;

  // Simple XML state machine (Discogs releases XML is flat per release)
  let inRelease = false;
  let releaseId = 0;
  let title = "";
  let year: number | null = null;
  let country: string | null = null;
  let artists: string[] = [];
  let genres: string[] = [];
  let styles: string[] = [];
  let inArtists = false;
  let inArtist = false;
  let inGenres = false;
  let inStyles = false;

  function resetRelease(): void {
    releaseId = 0;
    title = "";
    year = null;
    country = null;
    artists = [];
    genres = [];
    styles = [];
    inArtists = false;
    inArtist = false;
    inGenres = false;
    inStyles = false;
  }

  for await (const line of rl) {
    const trimmed = line.trim();

    // Release start
    const relMatch = trimmed.match(/<release\s+id="(\d+)"/);
    if (relMatch) {
      inRelease = true;
      resetRelease();
      const parsedId = Number(relMatch[1]);
      if (!Number.isFinite(parsedId)) continue;
      releaseId = parsedId;
      continue;
    }

    if (!inRelease) continue;

    // Release end
    if (trimmed === "</release>") {
      inRelease = false;
      // Electronic-only filter: skip releases with no Electronic genre
      if (opts?.electronicOnly && !genres.some((g) => /electronic/i.test(g))) {
        skipped++;
      } else if (title && artists.length > 0) {
        batch.push({ releaseId, title, artists, genres, styles, year, country });
        releases++;
        if (batch.length >= BATCH_SIZE) {
          insertBatch(batch.splice(0));
          opts?.onProgress?.(releases);
        }
      }
      continue;
    }

    // Section tracking
    if (trimmed === "<artists>") {
      inArtists = true;
      continue;
    }
    if (trimmed === "</artists>") {
      inArtists = false;
      continue;
    }
    if (trimmed === "<genres>") {
      inGenres = true;
      continue;
    }
    if (trimmed === "</genres>") {
      inGenres = false;
      continue;
    }
    if (trimmed === "<styles>") {
      inStyles = true;
      continue;
    }
    if (trimmed === "</styles>") {
      inStyles = false;
      continue;
    }
    if (trimmed === "<artist>" || trimmed.startsWith("<artist>")) {
      inArtist = true;
      continue;
    }
    if (trimmed === "</artist>") {
      inArtist = false;
      continue;
    }

    // Extract text content from simple XML elements
    const textMatch = trimmed.match(/^<(\w+)>(.*?)<\/\1>$/);
    if (!textMatch) continue;
    const tag = textMatch[1];
    const rawText = textMatch[2];
    if (tag === undefined || rawText === undefined) continue;
    // Decode XML entities (Discogs dump uses &amp; &lt; &gt; &apos; &quot;)
    const text = decodeXmlEntities(rawText);

    if (tag === "title" && !inArtists && !inArtist) {
      title = text;
    } else if (tag === "name" && inArtist && inArtists) {
      artists.push(text);
    } else if (tag === "genre" && inGenres) {
      genres.push(text);
    } else if (tag === "style" && inStyles) {
      styles.push(text);
    } else if (tag === "released") {
      year = parseDiscogsYear(text);
    } else if (tag === "country") {
      country = text;
    }
  }

  // Flush remaining
  if (batch.length > 0) insertBatch(batch);
  db.close();

  return { releases, skipped };
}

/** Prepared statement cache for discogsLookup — one set per DB instance. */
const lookupStmts = new WeakMap<
  Database,
  {
    findRelease: ReturnType<Database["prepare"]>;
    findGenres: ReturnType<Database["prepare"]>;
    findStyles: ReturnType<Database["prepare"]>;
  }
>();

function getLookupStmts(db: Database) {
  let s = lookupStmts.get(db);
  if (!s) {
    s = {
      findRelease: db.prepare(
        `SELECT r.release_id, r.title, r.year, r.country
         FROM discogs_releases r
         JOIN discogs_release_artists a ON a.release_id = r.release_id
         WHERE a.name_key = ? AND LOWER(r.title) = ?
         LIMIT 5`,
      ),
      findGenres: db.prepare("SELECT genre FROM discogs_release_genres WHERE release_id = ?"),
      findStyles: db.prepare("SELECT style FROM discogs_release_styles WHERE release_id = ?"),
    };
    lookupStmts.set(db, s);
  }
  return s;
}

/** Look up a track in the Discogs cache by artist + title.
 *  Returns the best match's genre result, or null. */
export function discogsLookup(
  db: Database,
  artist: string,
  title: string,
): DiscogsGenreResult | null {
  const artistKey = nameKey(artist);
  const titleKey = nameKey(title);
  const stmts = getLookupStmts(db);

  const rows = stmts.findRelease.all(artistKey, titleKey) as {
    release_id: number;
    title: string;
    year: number | null;
    country: string | null;
  }[];

  const best = rows[0];
  if (best === undefined) return null;

  const genreRows = stmts.findGenres.all(best.release_id) as { genre: string }[];
  const styleRows = stmts.findStyles.all(best.release_id) as { style: string }[];

  const release: DiscogsRelease = {
    releaseId: best.release_id,
    title: best.title,
    artists: [artist],
    genres: genreRows.map((r) => r.genre),
    styles: styleRows.map((r) => r.style),
    year: best.year,
    country: best.country,
  };

  return mapDiscogsRelease(release);
}
