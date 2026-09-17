// archive_tagcensus.ts — the FullTags-vs-rekordbox tag comparison reads.
//
// Two endpoints, one seam:
//   tagCensus(limit)     — census over the playable archive joined with
//                          the rb-adopt mirror (rekordbox_content): which
//                          tracks' two mirrors disagree, on what. PURE DB
//                          — never touches files (a 3.5k-row ffprobe pass
//                          would be minutes; the DBs are the mirrors).
//   trackTagCompare(id)  — ONE track, three sources: the file's live
//                          ground-truth tags (readFullTag — the FILE is
//                          truth), the archive mirror columns, and the
//                          RB mirror row, plus the precomputed difference
//                          table the UI renders.
//
// The rb-adopt mirror is OPTIONAL: absent `rekordbox_content` (rb-adopt
// never ran) degrades to `rekordboxMirror: false`, not an error.
import type {
  ArchiveTagCensus,
  ArchiveTagCensusRow,
} from "../shared/archive-wire";
import type { ArchiveQuery } from "./archive_types";

/** Ledger freshness for the census (#174): MAX(analyzed_at) per analysis
 *  ledger — the same stamps the set-builder's poolFreshness reports. A
 *  census computed against week-old beats/mood rows must not read as
 *  current; null stamps = empty ledger (the honest gap, never an mtime). */
function censusFreshness(reader: ArchiveQuery): {
  beatsAt: string | null;
  moodAt: string | null;
} {
  const row = reader.row<{ beats_at: string | null; mood_at: string | null }>(
    `SELECT
       (SELECT MAX(analyzed_at) FROM beats) AS beats_at,
       (SELECT MAX(analyzed_at) FROM mood) AS mood_at`,
  );
  return {
    beatsAt: row?.beats_at ?? null,
    moodAt: row?.mood_at ?? null,
  };
}

interface RawCensusRow {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  archive_genre: string | null;
  archive_key: string | null;
  archive_bpm: number | null;
  genre_flag: string | null;
  rb_title: string | null;
  rb_artist: string | null;
  rb_genre: string | null;
  rb_key: string | null;
  rb_bpm: number | null;
  rb_year: string | null;
  rb_label: string | null;
}

interface MirrorProbe {
  present: number;
}

/** Does the DB carry the rb-adopt mirror? */
export function hasRekordboxMirror(reader: ArchiveQuery): boolean {
  return (
    reader.row<MirrorProbe>(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = 'rekordbox_content'`,
    )?.present === 1
  );
}

/** null-safe bpm: mirrors store ×100 ints; non-positive is "not set". */
const normBpm = (v: number | null): number | null =>
  v !== null && Number.isFinite(v) && v > 0 ? v : null;

/** The mirror-level comparison fields (file tags are NOT read here).
 *  Title/artist/genre/key/bpm — year/label have no archive-side mirror
 *  column (tracks.year is this file's version, no label column exists),
 *  so a one-sided census difference there would be constant noise; the
 *  per-track compare view covers them with real file truth. */
const COMPARE_FIELDS = ["title", "artist", "genre", "key", "bpm"] as const;

/** Mirror-field difference check: null means "this mirror carries no
 *  claim" — absence of evidence, NOT a disagreement (thousands of
 *  rb-adopt rows leave Title/ArtistName unset while the archive mirror
 *  holds the value; counting those as conflicts buries the real ones —
 *  a census that cries wolf is a census nobody reads). A difference is
 *  two PRESENT values that disagree: strings trim+case-insensitive,
 *  numbers exactly. Exported for the census tests. */
export function differ(
  a: string | number | null,
  b: string | number | null,
): boolean {
  if (a === null || b === null) return false;
  if (typeof a === "string" && typeof b === "string")
    return a.trim().toLowerCase() !== b.trim().toLowerCase();
  return a !== b;
}

export function tagCensus(reader: ArchiveQuery, limit = 200): ArchiveTagCensus {
  const empty: ArchiveTagCensus = {
    available: reader.available(),
    returned: 0,
    matched: 0,
    differing: 0,
    unmatched: 0,
    fieldCounts: [],
    rows: [],
    rekordboxMirror: false,
    freshness: { beatsAt: null, moodAt: null },
  };
  if (!reader.available()) return empty;
  const mirror = hasRekordboxMirror(reader);
  if (!mirror) return empty;
  const freshness = censusFreshness(reader);

  // ONE row per track: newest RB mirror row wins (same rule the
  // set-builder pool uses — rb-adopt can carry duplicate Content rows).
  // Beats BPM is the archive-side BPM (the ledger), mirror key/bpm come
  // from the rb payload; tracks.genre_flag rides along for the UI.
  const rows = reader.rows<RawCensusRow>(
    `SELECT t.video_id,
       t.title, t.artist, t.album,
       t.genre AS archive_genre,
       k.key AS archive_key,
       b.bpm_folded AS archive_bpm,
       t.genre_flag,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.Title') END AS rb_title,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.ArtistName') END AS rb_artist,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.GenreName') END AS rb_genre,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.KeyName') END AS rb_key,
       CASE WHEN json_valid(rc.metadata_json)
         THEN CAST(json_extract(rc.metadata_json, '$.BPM') AS REAL) / 100.0
         END AS rb_bpm,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.ReleaseYear') END AS rb_year,
       CASE WHEN json_valid(rc.metadata_json)
         THEN json_extract(rc.metadata_json, '$.LabelName') END AS rb_label
     FROM tracks t
     LEFT JOIN track_keys k ON k.video_id = t.video_id
     LEFT JOIN beats b ON b.video_id = t.video_id
     JOIN rekordbox_content rc ON rc.rowid = (
       SELECT rc2.rowid FROM rekordbox_content rc2
       WHERE rc2.video_id = t.video_id
       ORDER BY rc2.updated_at DESC, rc2.content_id DESC LIMIT 1
     )
     WHERE t.status = 'downloaded'
     ORDER BY t.title`,
  );

  const unmatchedRow = reader.row<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tracks t
     WHERE t.status = 'downloaded' AND NOT EXISTS (
       SELECT 1 FROM rekordbox_content rc WHERE rc.video_id = t.video_id
     )`,
  );

  const censusRows: ArchiveTagCensusRow[] = [];
  const fieldCounts = new Map<string, number>();
  let differing = 0;
  for (const r of rows) {
    // Archive-side year/label: the tracks table carries no label column,
    // and `year` is this file's version (the RB ReleaseYear can be the
    // album year) — a census mismatch on those two is EXPECTED, so the
    // census compares them only where a mirror value exists on BOTH
    // sides. Omitted here: the per-track compare view has the full
    // three-source truth (the file's own year/label).
    const pairs: Record<
      string,
      [string | number | null, string | number | null]
    > = {
      title: [r.title, r.rb_title],
      artist: [r.artist, r.rb_artist],
      genre: [r.archive_genre, r.rb_genre],
      key: [r.archive_key, r.rb_key],
      bpm: [normBpm(r.archive_bpm), normBpm(r.rb_bpm)],
    };
    const differs: string[] = [];
    for (const f of COMPARE_FIELDS) {
      const [a, b] = pairs[f]!;
      if (differ(a, b)) {
        differs.push(f);
        fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
      }
    }
    if (differs.length > 0) differing++;
    censusRows.push({
      videoId: r.video_id,
      title: r.title,
      artist: r.artist,
      album: r.album,
      archiveGenre: r.archive_genre,
      rekordboxGenre: r.rb_genre,
      archiveKey: r.archive_key,
      rekordboxKey: r.rb_key,
      archiveBpm: normBpm(r.archive_bpm),
      rekordboxBpm: normBpm(r.rb_bpm),
      genreFlag: r.genre_flag,
      differs,
      hasRekordboxRow: true,
    });
  }

  censusRows.sort((a, b) => {
    const d = b.differs.length - a.differs.length;
    if (d !== 0) return d;
    return (a.title ?? a.videoId).localeCompare(b.title ?? b.videoId);
  });

  return {
    available: true,
    returned: Math.min(censusRows.length, Math.max(limit, 1)),
    matched: rows.length,
    differing,
    unmatched: unmatchedRow?.n ?? 0,
    fieldCounts: [...fieldCounts.entries()]
      .map(([field, count]) => ({ field, count }))
      .toSorted((a, b) => b.count - a.count),
    rows: censusRows.slice(0, Math.max(limit, 1)),
    rekordboxMirror: true,
    freshness,
  };
}
