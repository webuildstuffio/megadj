// archive_types.ts — the leaf under archive.ts: the ArchiveTrack row shape
// plus the tiny read seam the split-out modules (archive_similar.ts /
// archive_overview.ts) need from ArchiveReader.
//
// This file imports NOTHING. It exists so the split modules can type their
// `reader` parameter without a back-edge into archive.ts — a type-only
// import of ArchiveReader from archive.ts made `archive.ts →
// archive_similar.ts → archive.ts` a real cycle in madge (Sep 9 sweep;
// shared/types.ts additionally derives wire types from ArchiveReader, which
// pulled src/ into the loop through the leaf itself).

/** Rows of megadj's `tracks` table (src/state.ts) — the fields agents ask
 *  about. Kept structurally compatible, not imported: the archive DB may be
 *  older/newer than this build. */
export interface ArchiveTrack {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  bitrate_kbps: number | null;
  codec: string | null;
  file_path: string | null;
  duration_s: number | null;
  genre: string | null;
  energy: number | null;
  source: string;
  liked_position: number | null;
  first_seen_at: string;
  updated_at: string;
}

/** The read seam ArchiveReader exposes to the split-out modules:
 *  availability probe, parameterised SELECT (read-only by construction in
 *  archive.ts), and the shared ArchiveTrack column list. Split modules
 *  accept this — not the concrete class — so the import graph stays a
 *  DAG (`ArchiveReader implements ArchiveQuery` in archive.ts).
 *
 *  This file imports NOTHING, including bun-types — the binding union is
 *  restated structurally (it's the shape bun's Statement.all accepts), so
 *  the leaf stays dependency-free and `implements` verifies equality. */
export interface ArchiveQuery {
  /** Public "is the archive DB present" probe. */
  available(): boolean;
  /** Parameterised SELECT only — still read-only by construction. */
  rows<T>(
    sql: string,
    ...params: (
      | string
      | number
      | bigint
      | boolean
      | null
      | { [k: string]: string | number | bigint | boolean | null }
    )[]
  ): T[];
  /** The ArchiveTrack column list shared by every full-row query. */
  trackCols(): string;
}
