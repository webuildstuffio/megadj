// archive_types.ts — the leaf under archive.ts: the ArchiveTrack row shape
// plus the tiny read seam the split-out modules (archive_similar.ts /
// archive_overview.ts) need from ArchiveReader.
//
// This server-only seam imports the browser-safe wire leaf, never the other
// way around. That keeps ArchiveTrack single-sourced without recreating the
// old shared → src back-edge.
export type { ArchiveTrack } from "../shared/archive-wire";

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
  available: () => boolean;
  /** Parameterised SELECT only — still read-only by construction. */
  rows: <T>(
    sql: string,
    ...params: (
      | string
      | number
      | bigint
      | boolean
      | null
      | Record<string, string | number | bigint | boolean | null>
    )[]
  ) => T[];
  /** rows(...)[0] — undefined when the query matched nothing. Kept on
   *  the leaf so single-row probes (freshness census) don't over-fetch
   *  or lean on noUncheckedIndexedAccess gymnastics. */
  row: <T>(
    sql: string,
    ...params: (
      | string
      | number
      | bigint
      | boolean
      | null
      | Record<string, string | number | bigint | boolean | null>
    )[]
  ) => T | undefined;
  /** Cached musical key (Camelot TKEY), valid for this exact source path.
   *  Null means read the actual file. */
  keyRecord: (
    videoId: string,
    sourcePath: string,
  ) => { key: string; analyzedAt: string } | null;
  /** Remember a live file read for this reader's lifetime only. */
  rememberKeyRecord: (rec: {
    videoId: string;
    key: string;
    sourcePath: string;
  }) => void;
  /** The ArchiveTrack column list shared by every full-row query. */
  trackCols: () => string;
}
