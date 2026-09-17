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
import { groundTruth } from "../../fulltags/src/exports";
import type {
  ArchiveTagCensus,
  ArchiveTagCensusRow,
  ArchiveTrackTagCompare,
} from "../shared/archive-wire";
import type { ArchiveQuery } from "./archive_types";

/** Ledger freshness for the census (#174): MAX(analyzed_at) per analysis
 *  ledger — the same stamps the set-builder's poolFreshness reports. A
 *  census computed against week-old beats/mood rows must not read as
 *  current; null stamps = empty ledger (the honest gap, never an mtime). */
function censusFreshness(
  reader: ArchiveQuery,
): { beatsAt: string | null; moodAt: string | null } {
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

/** The rb-adopt mirror row for one track (newest first), parsed from its
 *  metadata_json snapshot. Corrupt mirror JSON → null (the DB row stays
 *  untouched; rb-adopt re-adopt rewrites it). */
function readRekordboxMirror(
  reader: ArchiveQuery,
  videoId: string,
): ArchiveTrackTagCompare["rekordbox"] {
  const rbMeta = reader.row<{ metadata_json: string }>(
    `SELECT metadata_json FROM rekordbox_content rc
     WHERE rc.video_id = ?
     ORDER BY rc.updated_at DESC, rc.content_id DESC LIMIT 1`,
    videoId,
  );
  if (!rbMeta || !rbMeta.metadata_json) return null;
  try {
    const m = JSON.parse(rbMeta.metadata_json) as Record<string, unknown>;
    const s = (k: string): string | null => {
      const v = m[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const bpmRaw = m["BPM"];
    const bpm =
      typeof bpmRaw === "number" && Number.isFinite(bpmRaw) && bpmRaw > 0
        ? bpmRaw / 100
        : null;
    const yearRaw = s("ReleaseYear");
    const year =
      yearRaw && yearRaw !== "0" && /^\d{4}$/.test(yearRaw) ? yearRaw : null;
    return {
      contentId: s("ID") ?? videoId,
      title: s("Title"),
      artist: s("ArtistName"),
      album: s("AlbumName"),
      genre: s("GenreName"),
      key: s("KeyName"),
      bpm,
      year,
      label: s("LabelName"),
      comment: s("Commnt"),
      metadata: m,
    };
  } catch {
    return null;
  }
}

/** LIVE ground truth — null on missing/unreadable, never a throw. */
function readFileTags(filePath: string | null): ArchiveTrackTagCompare["file"] {
  if (!filePath) return null;
  try {
    const g = groundTruth(filePath);
    return {
      readable: true,
      title: g.title,
      artist: g.artist,
      genre: g.genre,
      year: g.year,
      bpm: g.bpm,
      key: g.key,
      label: g.label,
      mixName: g.mixName,
      remixer: g.remixer,
      energy: g.energy,
      mood: g.mood,
      comment: g.comment,
      art: g.art,
    };
  } catch {
    return null; // unreadable file → the mirror views stand alone
  }
}

/** Headline difference check: push the field when the three-way values
 *  disagree (trim-equal strings are equal). */
function makeDifferFn(
  diffs: ArchiveTrackTagCompare["differences"],
): (field: string, vals: (string | number | null)[]) => void {
  return (field, vals) => {
    const present = vals.filter((v) => v !== null);
    const allSame =
      present.length < 2 ||
      present.every((v) =>
        typeof v === "string"
          ? (present[0] as string).trim().toLowerCase() ===
            (v as string).trim().toLowerCase()
          : v === present[0],
      );
    if (!allSame)
      diffs.push({
        field,
        file: vals[0] ?? null,
        archive: vals[1] ?? null,
        rekordbox: vals[2] ?? null,
      });
  };
}

/** The three-way comparison fields: [field name, file, archive, rb].
 *  The remixer value is special — the RB side keeps it in metadata, not
 *  a top-level mirror column — so it carries its own getter. Data-driven:
 *  the diff loop walks this table, so a new compared field is one row,
 *  not another hand-copied push line. */
type CompareTrio = [
  file: string | number | null,
  archive: string | number | null,
  rekordbox: string | number | null,
];

function compareFields(
  t: {
    title: string | null;
    artist: string | null;
    genre: string | null;
    archive_key: string | null;
    bpm_folded: number | null;
  },
  file: NonNullable<ArchiveTrackTagCompare["file"]> | null,
  rekordbox: NonNullable<ArchiveTrackTagCompare["rekordbox"]> | null,
): [string, CompareTrio][] {
  const rbRemixer =
    rekordbox === null
      ? null
      : ((rekordbox.metadata["RemixerName"] as string | null) ?? null);
  return [
    ["title", [file?.title ?? null, t.title, rekordbox?.title ?? null]],
    ["artist", [file?.artist ?? null, t.artist, rekordbox?.artist ?? null]],
    ["genre", [file?.genre ?? null, t.genre, rekordbox?.genre ?? null]],
    ["key", [file?.key ?? null, t.archive_key, rekordbox?.key ?? null]],
    ["bpm", [file?.bpm ?? null, t.bpm_folded, rekordbox?.bpm ?? null]],
    ["year", [file?.year ?? null, null, rekordbox?.year ?? null]],
    ["label", [file?.label ?? null, null, rekordbox?.label ?? null]],
    ["mix", [file?.mixName ?? null, null, null]],
    ["remixer", [file?.remixer ?? null, null, rbRemixer]],
  ];
}

/** Three-source read of ONE track. The file is read LIVE (ground truth:
 *  one ffprobe+mutagen read per request); mirrors come from the DBs. */
export function trackTagCompare(
  reader: ArchiveQuery,
  videoId: string,
): ArchiveTrackTagCompare {
  const base: ArchiveTrackTagCompare = {
    available: reader.available(),
    videoId,
    title: null,
    artist: null,
    album: null,
    file: null,
    pipeline: {
      genre: null,
      genreFlag: null,
      energy: null,
      bpmFolded: null,
      key: null,
      valence: null,
      arousal: null,
      analyzedAt: null,
    },
    rekordbox: null,
    differences: [],
  };
  if (!reader.available()) return base;

  const t = reader.row<{
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    genre_flag: string | null;
    energy: number | null;
    file_path: string | null;
    bpm_folded: number | null;
    archive_key: string | null;
    valence: number | null;
    arousal: number | null;
    analyzed_at: string | null;
  }>(
    `SELECT t.title, t.artist, t.album, t.genre, t.genre_flag, t.energy,
       t.file_path, b.bpm_folded, k.key AS archive_key,
       m.valence, m.arousal, m.analyzed_at
     FROM tracks t
     LEFT JOIN beats b ON b.video_id = t.video_id
     LEFT JOIN track_keys k ON k.video_id = t.video_id
     LEFT JOIN mood m ON m.video_id = t.video_id
     WHERE t.video_id = ?`,
    videoId,
  );
  if (!t) return base;

  const rekordbox = readRekordboxMirror(reader, videoId);
  const file = readFileTags(t.file_path);

  const pipeline = {
    genre: t.genre,
    genreFlag: t.genre_flag,
    energy: t.energy,
    bpmFolded: t.bpm_folded,
    key: t.archive_key,
    valence: t.valence,
    arousal: t.arousal,
    analyzedAt: t.analyzed_at,
  };

  // headline differences: three-way where possible (file wins truth;
  // file-vs-archive and file-vs-rb and archive-vs-rb are all checked
  // through the same trim-equal rule)
  const diffs: ArchiveTrackTagCompare["differences"] = [];
  const push = makeDifferFn(diffs);
  for (const [field, vals] of compareFields(t, file, rekordbox)) {
    push(field, vals);
  }

  return {
    available: true,
    videoId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    file,
    pipeline,
    rekordbox,
    differences: diffs,
  };
}
