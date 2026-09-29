/**
 * metadata-backfill.ts — fill missing album/year/artist via MusicBrainz
 * recording lookups + Beatport identity enrichment.
 *
 * Usage: bun tools/metadata-backfill.ts [--limit N] [--dry-run] [--json]
 *        [--field album|year|artist]
 */
import { Database } from "bun:sqlite";
import { mbRecording } from "../src/fulltags/sources/mb-lookup";
import { beatportLookup } from "../src/fulltags/sources/beatport";

import { nonEmptyEnv } from "../src/shared/leaf/guards";

const DB_PATH =
  nonEmptyEnv("MEGADJ_DB") ??
  `${process.env.HOME}/.local/state/megadj/archive.db`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonOut = args.includes("--json");
const limitIdx = args.indexOf("--limit");
const limitRaw = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;
const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
const fieldIdx = args.indexOf("--field");
const fieldFilter = fieldIdx !== -1 ? args[fieldIdx + 1] : undefined;

const db = new Database(DB_PATH);
const log = jsonOut ? () => {} : console.log;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TrackRow {
  video_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  year: string | null;
  file_path: string;
}

// Build WHERE clause based on what's missing
const conditions: string[] = [];
if (!fieldFilter || fieldFilter === "album")
  conditions.push("(album IS NULL OR album = '' OR album = 'UnknownAlbum')");
if (!fieldFilter || fieldFilter === "year")
  conditions.push("(year IS NULL OR year = '' OR year = '0')");
if (!fieldFilter || fieldFilter === "artist")
  conditions.push(
    "(artist IS NULL OR artist = '' OR artist = 'UnknownArtist')",
  );

const whereClause =
  conditions.length > 0 ? `AND (${conditions.join(" OR ")})` : "";

const rows = db
  .query(
    `SELECT video_id, title, artist, album, year, file_path FROM tracks
     WHERE status='downloaded' AND file_path IS NOT NULL
       ${whereClause}
       AND artist IS NOT NULL AND artist != '' AND artist != 'UnknownArtist'
       AND title IS NOT NULL AND title != ''
     ORDER BY artist, title
     ${limit !== undefined ? `LIMIT ${limit}` : ""}`,
  )
  .all() as TrackRow[];

log(
  `metadata-backfill: ${rows.length} tracks need enrichment${dryRun ? " [DRY RUN]" : ""}`,
);

let albumFilled = 0;
let yearFilled = 0;
const artistFilled = 0;
let missed = 0;
const seen = new Set<string>();

for (let i = 0; i < rows.length; i++) {
  const row = rows[i]!;
  const artist = row.artist ?? "";
  let title = row.title;
  const label = `[${i + 1}/${rows.length}]`;

  // Clean title for better lookup
  title = title
    .replace(/\s*\[archive(?:\s+\d+)?\]\s*$/i, "")
    .replace(/\s*\[BACKUP\d*\]\s*$/i, "")
    .replace(/\s*\[bangers\]\s*$/i, "")
    .replace(/\s*\[WRONG\.\]\s*$/i, "")
    .replace(/\s*\(feat\.[^)]*\)\s*/i, " ")
    .replace(/\s*ft\.\s+.+$/i, "")
    .trim();

  // Skip duplicates (same artist+title already looked up)
  const key = `${artist.toLowerCase()}::${title.toLowerCase()}`;
  if (seen.has(key)) {
    // But propagate results from the original
    const orig = db
      .query(
        `SELECT album, year FROM tracks
         WHERE artist = ? AND title LIKE ? AND status='downloaded'
           AND (album IS NOT NULL AND album != '' AND album != 'UnknownAlbum'
                OR year IS NOT NULL AND year != '' AND year != '0')
         LIMIT 1`,
      )
      .get(row.artist, `${row.title}%`) as
      { album: string | null; year: string | null } | undefined;
    if (orig && !dryRun) {
      const updates: string[] = [];
      const vals: (string | null)[] = [];
      if (orig.album && (!row.album || row.album === "UnknownAlbum")) {
        updates.push("album = ?");
        vals.push(orig.album);
        albumFilled++;
      }
      if (orig.year && (!row.year || row.year === "0")) {
        updates.push("year = ?");
        vals.push(orig.year);
        yearFilled++;
      }
      if (updates.length > 0) {
        vals.push(row.video_id);
        db.query(
          `UPDATE tracks SET ${updates.join(", ")} WHERE video_id = ?`,
        ).run(...vals);
      }
    }
    continue;
  }
  seen.add(key);

  const needAlbum =
    !row.album || row.album === "" || row.album === "UnknownAlbum";
  const needYear = !row.year || row.year === "" || row.year === "0";

  if (!needAlbum && !needYear) continue;

  let foundAlbum: string | null = null;
  let foundYear: string | null = null;
  let source = "";

  // ---- MusicBrainz recording lookup ----
  try {
    const mb = await mbRecording(artist, title);
    if (mb.album && needAlbum) {
      foundAlbum = mb.album;
      source = "mb";
    }
    if (mb.date && needYear) {
      const y = mb.date.split("-")[0];
      const yn = Number(y);
      if (y && y.length === 4 && Number.isFinite(yn) && yn > 1900) {
        foundYear = y;
        source = source ? `${source}+mb` : "mb";
      }
    }
  } catch {
    /* degrade */
  }

  // ---- Beatport lookup (fills year from release date) ----
  if (!foundYear && needYear) {
    try {
      const bp = await beatportLookup({
        artist,
        title,
        durationS: undefined,
      });
      if (bp?.year) {
        foundYear = String(bp.year);
        source = source ? `${source}+bp` : "bp";
      }
    } catch {
      /* degrade */
    }
  }

  if (!foundAlbum && !foundYear) {
    if (i % 50 === 0) log(`  ${label} ✗ ${artist} - ${title.slice(0, 40)}`);
    missed++;
    await sleep(150);
    continue;
  }

  const parts: string[] = [];
  if (foundAlbum) parts.push(`album:${foundAlbum.slice(0, 30)}`);
  if (foundYear) parts.push(`year:${foundYear}`);
  log(
    `  ${label} ✓ ${parts.join(", ")} (${source}) — ${artist} - ${title.slice(0, 35)}`,
  );

  if (!dryRun) {
    const updates: string[] = [];
    const vals: (string | null)[] = [];
    if (foundAlbum && needAlbum) {
      updates.push("album = ?");
      vals.push(foundAlbum);
      albumFilled++;
    }
    if (foundYear && needYear) {
      updates.push("year = ?");
      vals.push(foundYear);
      yearFilled++;
    }
    if (updates.length > 0) {
      vals.push(row.video_id);
      db.query(
        `UPDATE tracks SET ${updates.join(", ")} WHERE video_id = ?`,
      ).run(...vals);
    }
  }

  await sleep(150);
}

// Final propagation: copy album/year from same-artist+title tracks to their copies
if (!dryRun) {
  const propAlbum = db
    .query(
      `UPDATE tracks SET album = (
        SELECT t2.album FROM tracks t2
        WHERE t2.album IS NOT NULL AND t2.album != '' AND t2.album != 'UnknownAlbum'
          AND t2.artist = tracks.artist AND t2.title = tracks.title
          AND t2.video_id != tracks.video_id
        LIMIT 1
      ) WHERE status='downloaded' AND file_path IS NOT NULL
        AND (album IS NULL OR album = '' OR album = 'UnknownAlbum')
        AND artist IS NOT NULL AND artist != ''`,
    )
    .run();
  const propYear = db
    .query(
      `UPDATE tracks SET year = (
        SELECT t2.year FROM tracks t2
        WHERE t2.year IS NOT NULL AND t2.year != '' AND t2.year != '0'
          AND t2.artist = tracks.artist AND t2.title = tracks.title
          AND t2.video_id != tracks.video_id
        LIMIT 1
      ) WHERE status='downloaded' AND file_path IS NOT NULL
        AND (year IS NULL OR year = '' OR year = '0')
        AND artist IS NOT NULL AND artist != ''`,
    )
    .run();
  log(`\npropagation: album ${propAlbum.changes}, year ${propYear.changes}`);
  albumFilled += propAlbum.changes;
  yearFilled += propYear.changes;
}

const final = db
  .query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN artist IS NOT NULL AND artist != '' AND artist != 'UnknownArtist' THEN 1 ELSE 0 END) AS artist,
       SUM(CASE WHEN album IS NOT NULL AND album != '' AND album != 'UnknownAlbum' THEN 1 ELSE 0 END) AS album,
       SUM(CASE WHEN year IS NOT NULL AND year != '' AND year != '0' THEN 1 ELSE 0 END) AS year
     FROM tracks WHERE status='downloaded' AND file_path IS NOT NULL`,
  )
  .get() as { total: number; artist: number; album: number; year: number };

const summary = {
  command: "metadata-backfill",
  albumFilled,
  yearFilled,
  artistFilled,
  missed,
  dryRun,
  final: {
    total: final.total,
    artist: `${final.artist}/${final.total} (${((final.artist / final.total) * 100).toFixed(1)}%)`,
    album: `${final.album}/${final.total} (${((final.album / final.total) * 100).toFixed(1)}%)`,
    year: `${final.year}/${final.total} (${((final.year / final.total) * 100).toFixed(1)}%)`,
  },
};

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} else {
  log(
    `\n=== FINAL ===\n  artist: ${summary.final.artist}\n  album:  ${summary.final.album}\n  year:   ${summary.final.year}`,
  );
}

db.close();
