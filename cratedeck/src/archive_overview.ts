// cueStats + libraryOverview — the FullTags-read-side halves of the archive
// surface. Split from archive.ts for the file-length guard; ArchiveReader
// delegates so the call sites (`archive.cueStats(...)`) are unchanged.
import type { ArchiveQuery, ArchiveTrack } from "./archive_types";

/**
 * STRUCTURE CUES ledger (roadmap "structure cues" slice): DJ phrase
 * markers (every 8 bars) derived from the beats ledger's downbeats by
 * `megadj cues`. DB-side only — rekordbox memory-cue writes are a
 * separate gated surface, so this read describes the ledger as-is.
 * Degrades to available:false on pre-cues DBs (no `cues` table).
 */
export function cueStats(
  reader: ArchiveQuery,
  limit = 40,
): {
  available: boolean;
  analyzed: number;
  avg_cues: number;
  total_cues: number;
  tracks: {
    video_id: string;
    title: string | null;
    artist: string | null;
    cue_count: number;
    first_cue_at: number;
    model: string;
  }[];
} {
  const empty = {
    available: reader.available(),
    analyzed: 0,
    avg_cues: 0,
    total_cues: 0,
    tracks: [],
  };
  const hasCues = reader.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cues'`,
  );
  if (!hasCues.length) return empty;
  const n = Math.min(Math.max(limit, 1), 200);
  const rows = reader.rows<{
    video_id: string;
    title: string | null;
    artist: string | null;
    cues_json: string;
    model: string;
  }>(
    `SELECT c.video_id, t.title, t.artist, c.cues_json, c.model
     FROM cues c JOIN tracks t ON t.video_id = c.video_id
     WHERE t.status = 'downloaded'
     ORDER BY t.updated_at DESC LIMIT ?`,
    n,
  );
  const tracks = rows.flatMap((r) => {
    // corrupt JSON row = absent ledger entry, not a crash (the pass that
    // owns the ledger treats it the same way)
    let cues: Array<{ index: number; position: number; bar: number }> = [];
    try {
      cues = JSON.parse(r.cues_json) as typeof cues;
    } catch {
      return [];
    }
    return [
      {
        video_id: r.video_id,
        title: r.title,
        artist: r.artist,
        cue_count: cues.length,
        first_cue_at: cues[0]?.position ?? 0,
        model: r.model,
      },
    ];
  });
  const total = tracks.reduce((s, t) => s + t.cue_count, 0);
  return {
    available: reader.available(),
    analyzed: tracks.length,
    avg_cues: tracks.length ? Math.round((total / tracks.length) * 10) / 10 : 0,
    total_cues: total,
    tracks,
  };
}

/**
 * LIBRARY OVERVIEW (FullTags read side): what the enrichment engine has
 * actually stamped across the playable archive — genre distribution,
 * year coverage, energy stamps, artwork provenance, codec/size profile,
 * and the freshest updates. All from the archive DB's own columns (the
 * mirror of the file tags fulltags writes); read-only as always.
 */
export function libraryOverview(
  reader: ArchiveQuery,
  recentLimit = 60,
): {
  available: boolean;
  tracks: number;
  artwork: { embedded: number; missing: number; queued: number };
  genres: { name: string; count: number }[];
  years: {
    known: number;
    unknown: number;
    min: string | null;
    max: string | null;
  };
  energy: { stamped: number };
  codecs: { codec: string; count: number }[];
  sizes: { files: number; total_bytes: number };
  recent: (ArchiveTrack & {
    year: string | null;
    artwork_status: string | null;
    file_size_bytes: number | null;
  })[];
} {
  const empty = {
    available: reader.available(),
    tracks: 0,
    artwork: { embedded: 0, missing: 0, queued: 0 },
    genres: [],
    years: { known: 0, unknown: 0, min: null, max: null },
    energy: { stamped: 0 },
    codecs: [],
    sizes: { files: 0, total_bytes: 0 },
    recent: [],
  };
  const n = Math.min(Math.max(recentLimit, 1), 100);
  const base = {
    available: reader.available(),
  };
  // Pre-enrichment archive DBs lack the year/artwork_status/energy columns
  // (megadj adds them by migration) — detect once per handle and degrade
  // those sections to zeros instead of SQLiteError-ing every call.
  const cols = reader
    .rows<{ name: string }>(`SELECT name FROM pragma_table_info('tracks')`)
    .map((c) => c.name);
  const has = (name: string) => cols.includes(name);
  const hasYear = has("year");
  const hasArt = has("artwork_status");
  const hasEnergy = has("energy");
  const count = (sql: string): number =>
    reader.rows<{ n: number }>(sql)[0]?.n ?? 0;
  const tracks = count(
    `SELECT COUNT(*) n FROM tracks WHERE status = 'downloaded'`,
  );
  if (!tracks) return { ...empty, ...base };
  const embedded = hasArt
    ? count(
        `SELECT COUNT(*) n FROM tracks
         WHERE status = 'downloaded' AND artwork_status LIKE 'embedded:%'`,
      )
    : 0;
  const queued = hasArt
    ? count(
        `SELECT COUNT(*) n FROM tracks
         WHERE status = 'downloaded' AND artwork_status = 'queued'`,
      )
    : 0;
  const genres = reader.rows<{ name: string; count: number }>(
    `SELECT genre name, COUNT(*) count FROM tracks
     WHERE status = 'downloaded' AND genre IS NOT NULL AND genre != ''
     GROUP BY genre ORDER BY count DESC, name LIMIT 24`,
  );
  const years = hasYear
    ? reader.rows<{ known: number; min: string | null; max: string | null }>(
        `SELECT COUNT(*) known, MIN(year) min, MAX(year) max FROM tracks
         WHERE status = 'downloaded' AND year IS NOT NULL AND year != ''`,
      )[0]
    : undefined;
  const codecs = reader.rows<{ codec: string; count: number }>(
    `SELECT COALESCE(codec, 'unknown') codec, COUNT(*) count FROM tracks
     WHERE status = 'downloaded' GROUP BY 1 ORDER BY count DESC LIMIT 10`,
  );
  const sizes = reader.rows<{ files: number; total_bytes: number }>(
    `SELECT COUNT(*) files, COALESCE(SUM(file_size_bytes), 0) total_bytes
     FROM tracks WHERE status = 'downloaded' AND file_size_bytes IS NOT NULL`,
  )[0];
  const recent = reader.rows<
    ArchiveTrack & {
      year: string | null;
      artwork_status: string | null;
      file_size_bytes: number | null;
    }
  >(
    `SELECT ${reader.trackCols()}${hasYear ? ", year" : ", NULL AS year"}${
      hasArt ? ", artwork_status" : ", NULL AS artwork_status"
    }${has("file_size_bytes") ? ", file_size_bytes" : ", NULL AS file_size_bytes"}
     FROM tracks WHERE status = 'downloaded'
     ORDER BY updated_at DESC LIMIT ?`,
    n,
  );
  return {
    ...base,
    tracks,
    artwork: { embedded, missing: tracks - embedded - queued, queued },
    genres,
    years: {
      known: years?.known ?? 0,
      unknown: tracks - (years?.known ?? 0),
      min: years?.min ?? null,
      max: years?.max ?? null,
    },
    energy: {
      stamped: hasEnergy
        ? count(
            `SELECT COUNT(*) n FROM tracks
             WHERE status = 'downloaded' AND energy IS NOT NULL`,
          )
        : 0,
    },
    codecs,
    sizes: {
      files: sizes?.files ?? 0,
      total_bytes: sizes?.total_bytes ?? 0,
    },
    recent,
  };
}
