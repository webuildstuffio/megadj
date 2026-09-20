// rb-adopt-apply.ts — the archive-side apply arm of rb-adopt (#232
// split, the rb-dedup/rb-import pattern): the identity-resolution plan
// (buildPlan + loadIdentityIndexes + resolveVideoId), the ledger
// mutation (reconcileRekordboxRows — the transactional mirror), and the
// archive snapshot backup. rb-adopt.ts keeps the option/result shapes,
// the pyrekordbox read seam, the gates, and the rbAdopt sequencer.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ArchiveState } from "../archive/state";
import { nameKey } from "../shared/name-key";
import { backupStamp } from "./guard.js";

export interface PlanRow {
  row: RekordboxContentRowRef;
  videoId: string;
  createsTrack: boolean;
  fileExists: boolean;
}

/** Minimal structural view of a content row for the plan/apply arm (the
 *  full shape is declared on the read side in rb-adopt.ts). */
export interface RekordboxContentRowRef {
  contentId: string;
  folderPath: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationS: number | null;
  bitrateKbps: number | null;
  fileSizeBytes: number | null;
  year: string | null;
  metadata: Record<string, unknown>;
}

/** Rekordbox FileType → ffprobe codec_name, decoded from pyrekordbox's own
 *  FileType enum (db6/tables.py: MP3=1, M4A=4, FLAC=5, WAV=11, AIFF/AIF=12)
 *  — no hand-guessed container detection. WAV/AIFF need BitDepth for the
 *  exact pcm_* codec the rest of the ledger stores (probed vocabulary);
 *  a missing depth stays null (honest gap), never a guess. Filled the
 *  Codecs card's 3,133 "unknown" (the whole rb-adopt mirror cohort never
 *  wrote codec — Sep 19). */
const RB_FILETYPE_CODEC: Record<number, string> = {
  1: "mp3",
  4: "aac",
  5: "flac",
};

const RB_PCM_CODEC: Record<string, string> = {
  "11/16": "pcm_s16le",
  "11/24": "pcm_s24le",
  "11/32": "pcm_s32le",
  "12/16": "pcm_s16be",
  "12/24": "pcm_s24be",
};

/** Derive the archive `codec` column from a Content row's own metadata. */
export function rekordboxCodec(
  metadata: Record<string, unknown>,
): string | null {
  const fileType = metadata["FileType"];
  const depth = metadata["BitDepth"];
  const ft = typeof fileType === "number" ? fileType : NaN;
  const d = typeof depth === "number" ? depth : NaN;
  if (Number.isFinite(ft) && Number.isFinite(d)) {
    const pcm = RB_PCM_CODEC[`${ft}/${d}`];
    if (pcm !== undefined) return pcm;
  }
  return RB_FILETYPE_CODEC[ft] ?? null;
}

interface TrackIdentityRow {
  video_id: string;
  file_path: string | null;
  source: string;
  status: string;
  first_seen_at: string;
}

interface ExistingLinkRow {
  content_id: string;
  video_id: string;
}

function normPath(path: string): string {
  return nameKey(path);
}

function identityPathKey(row: RekordboxContentRowRef): string {
  return row.folderPath ? normPath(row.folderPath) : `\0${row.contentId}`;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function tableExists(state: ArchiveState, name: string): boolean {
  return (
    state.db
      .query(
        "SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null
  );
}

function identityRank(row: TrackIdentityRow): string {
  const generated = row.video_id.startsWith("rb-") ? "2" : "0";
  const downloaded = row.status === "downloaded" ? "0" : "1";
  return `${generated}:${downloaded}:${row.first_seen_at}:${row.video_id}`;
}

function generatedId(contentId: string, folderPath: string): string {
  const suffix = createHash("sha256")
    .update(folderPath.normalize("NFC"))
    .digest("hex")
    .slice(0, 8);
  return `rb-${contentId}-${suffix}`;
}

function createSchema(state: ArchiveState): void {
  state.db.exec(`
    CREATE TABLE IF NOT EXISTS rekordbox_content (
      content_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      source_db TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_db, content_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rekordbox_content_video
      ON rekordbox_content(video_id);
    CREATE INDEX IF NOT EXISTS idx_rekordbox_content_path
      ON rekordbox_content(folder_path);
  `);
}

/** Identity indexes over the archive ledger + this source DB's links
 *  (#199): loading them is pure reads, separate from plan decisions. */
function loadIdentityIndexes(
  state: ArchiveState,
  sourceDb: string,
): {
  byId: Map<string, TrackIdentityRow>;
  byPath: Map<string, TrackIdentityRow[]>;
  linkByContent: Map<string, string>;
} {
  const tracks = state.db
    .query(
      `SELECT video_id, file_path, source, status, first_seen_at
       FROM tracks`,
    )
    .all() as TrackIdentityRow[];
  const byId = new Map(tracks.map((row) => [row.video_id, row]));
  const byPath = new Map<string, TrackIdentityRow[]>();
  for (const track of tracks) {
    if (!track.file_path) continue;
    const key = normPath(track.file_path);
    byPath.set(key, [...(byPath.get(key) ?? []), track]);
  }
  for (const candidates of byPath.values())
    candidates.sort((a, b) => identityRank(a).localeCompare(identityRank(b)));

  const existingLinks = tableExists(state, "rekordbox_content")
    ? (state.db
        .query(
          `SELECT content_id, video_id FROM rekordbox_content
           WHERE source_db = ?`,
        )
        .all(sourceDb) as ExistingLinkRow[])
    : [];
  const linkByContent = new Map(
    existingLinks.map((row) => [row.content_id, row.video_id]),
  );
  return { byId, byPath, linkByContent };
}

/** Resolve (and reserve, when creating) the video id for one content row:
 *  prior selection wins, then the ledger link, then the same-path track;
 *  otherwise mint a fresh id and mark the row as a create. */
function resolveVideoId(
  row: RekordboxContentRowRef,
  indexes: {
    byId: Map<string, TrackIdentityRow>;
    byPath: Map<string, TrackIdentityRow[]>;
    linkByContent: Map<string, string>;
  },
  selectedByPath: Map<string, string>,
  reservedIds: Set<string>,
): { videoId: string; createsTrack: boolean; matchedExisting: boolean } {
  const pathKey = identityPathKey(row);
  const linked = indexes.linkByContent.get(row.contentId);
  const existingAtPath = indexes.byPath.get(pathKey)?.[0]?.video_id;
  const selected = selectedByPath.get(pathKey);
  let videoId =
    selected ??
    (linked && indexes.byId.has(linked) ? linked : undefined) ??
    existingAtPath ??
    undefined;
  let createsTrack = false;
  let matchedExisting = false;
  if (videoId === undefined) {
    const direct = `rb-${row.contentId}`;
    videoId = reservedIds.has(direct)
      ? generatedId(row.contentId, row.folderPath)
      : direct;
    while (reservedIds.has(videoId)) videoId = `${videoId}-x`;
    reservedIds.add(videoId);
    createsTrack = true;
  } else if (existingAtPath !== undefined || linked !== undefined) {
    matchedExisting = true;
  }
  selectedByPath.set(pathKey, videoId);
  return { videoId, createsTrack, matchedExisting };
}

export function buildPlan(
  state: ArchiveState,
  sourceDb: string,
  rows: RekordboxContentRowRef[],
): { plan: PlanRow[]; matchedExisting: number; uniqueFiles: number } {
  const indexes = loadIdentityIndexes(state, sourceDb);
  const selectedByPath = new Map<string, string>();
  const reservedIds = new Set(indexes.byId.keys());
  const plan: PlanRow[] = [];
  let matchedExisting = 0;

  const ordered = rows.toSorted((a, b) => {
    const pathOrder = identityPathKey(a).localeCompare(identityPathKey(b));
    return pathOrder !== 0
      ? pathOrder
      : a.contentId.localeCompare(b.contentId, undefined, { numeric: true });
  });
  for (const row of ordered) {
    const resolved = resolveVideoId(row, indexes, selectedByPath, reservedIds);
    if (resolved.matchedExisting) matchedExisting += 1;
    plan.push({
      row,
      videoId: resolved.videoId,
      createsTrack: resolved.createsTrack,
      fileExists: existsSync(row.folderPath),
    });
  }
  return { plan, matchedExisting, uniqueFiles: selectedByPath.size };
}

export interface ReconcileRekordboxResultShape {
  command: "rb-adopt";
  sourceDb: string;
  total: number;
  uniqueFiles: number;
  matchedExisting: number;
  wouldCreate: number;
  duplicateContentPaths: number;
  missingFiles: number;
  linked: number;
  created: number;
  applied: number;
  staleLinksRemoved: number;
  appliedMode: boolean;
  ok: boolean;
  error?: string;
}

export function insertedCount(plan: PlanRow[]): number {
  return new Set(
    plan.filter((item) => item.createsTrack).map((item) => item.videoId),
  ).size;
}

/** Option shape for reconcileRekordboxRows. */
export interface ReconcileOptionsShape {
  state: ArchiveState;
  sourceDb: string;
  rows: RekordboxContentRowRef[];
  apply: boolean;
}

/** Reconcile the read content rows INTO archive.db (transactional): the
 *  one archive-ledger mutation rb-adopt owns. Dry-run returns the base
 *  shape without touching the ledger. */
export function reconcileRekordboxRows(
  opts: ReconcileOptionsShape,
): ReconcileRekordboxResultShape {
  if (opts.rows.length === 0)
    return {
      command: "rb-adopt",
      sourceDb: opts.sourceDb,
      total: opts.rows.length,
      uniqueFiles: 0,
      matchedExisting: 0,
      wouldCreate: 0,
      duplicateContentPaths: 0,
      missingFiles: 0,
      linked: 0,
      created: 0,
      applied: 0,
      staleLinksRemoved: 0,
      appliedMode: opts.apply,
      ok: false,
      error: "master Content census is empty; refusing to prune",
    };
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of opts.rows) {
    if (!row.contentId) {
      return {
        command: "rb-adopt",
        sourceDb: opts.sourceDb,
        total: opts.rows.length,
        uniqueFiles: 0,
        matchedExisting: 0,
        wouldCreate: 0,
        duplicateContentPaths: 0,
        missingFiles: 0,
        linked: 0,
        created: 0,
        applied: 0,
        staleLinksRemoved: 0,
        appliedMode: opts.apply,
        ok: false,
        error: "master contains a Content row with an empty ID",
      };
    }
    if (seenIds.has(row.contentId)) duplicateIds.add(row.contentId);
    seenIds.add(row.contentId);
  }
  if (duplicateIds.size > 0)
    return {
      command: "rb-adopt",
      sourceDb: opts.sourceDb,
      total: opts.rows.length,
      uniqueFiles: 0,
      matchedExisting: 0,
      wouldCreate: 0,
      duplicateContentPaths: 0,
      missingFiles: 0,
      linked: 0,
      created: 0,
      applied: 0,
      staleLinksRemoved: 0,
      appliedMode: opts.apply,
      ok: false,
      error: `master contains duplicate Content IDs: ${[...duplicateIds].slice(0, 5).join(", ")}`,
    };

  const { plan, matchedExisting, uniqueFiles } = buildPlan(
    opts.state,
    opts.sourceDb,
    opts.rows,
  );
  const creates = new Set(
    plan.filter((item) => item.createsTrack).map((item) => item.videoId),
  );
  const base: ReconcileRekordboxResultShape = {
    command: "rb-adopt",
    sourceDb: opts.sourceDb,
    total: opts.rows.length,
    uniqueFiles,
    matchedExisting,
    wouldCreate: creates.size,
    duplicateContentPaths: opts.rows.length - uniqueFiles,
    missingFiles: plan.filter((item) => !item.fileExists).length,
    linked: 0,
    created: 0,
    applied: 0,
    staleLinksRemoved: 0,
    appliedMode: opts.apply,
    ok: true,
  };
  if (!opts.apply) return base;

  let staleLinksRemoved = 0;
  const apply = opts.state.db.transaction(() => {
    createSchema(opts.state);
    const now = opts.state.now();
    const inserted = new Set<string>();
    opts.state.db.exec(`
      DROP TABLE IF EXISTS temp.rb_adopt_seen;
      CREATE TEMP TABLE rb_adopt_seen (
        content_id TEXT PRIMARY KEY
      );
    `);
    for (const item of plan) {
      opts.state.db
        .query("INSERT INTO rb_adopt_seen (content_id) VALUES (?)")
        .run(item.row.contentId);
      if (item.createsTrack && !inserted.has(item.videoId)) {
        opts.state.db
          .query(
            `INSERT INTO tracks (
               video_id, title, artist, album, status, bitrate_kbps,
               file_path, file_size_bytes, duration_s, last_error, source,
               genre, year, codec, first_seen_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rekordbox', ?, ?, ?, ?, ?)`,
          )
          .run(
            item.videoId,
            item.row.title,
            item.row.artist,
            item.row.album,
            item.fileExists ? "downloaded" : "failed",
            finiteOrNull(item.row.bitrateKbps),
            item.row.folderPath,
            finiteOrNull(item.row.fileSizeBytes),
            finiteOrNull(item.row.durationS),
            item.fileExists ? null : "Rekordbox Content path is missing",
            item.row.genre,
            item.row.year,
            rekordboxCodec(item.row.metadata),
            now,
            now,
          );
        inserted.add(item.videoId);
      } else if (item.fileExists) {
        opts.state.db
          .query(
            `UPDATE tracks SET
               file_path = ?, status = 'downloaded', last_error = NULL,
               title = COALESCE(title, ?), artist = COALESCE(artist, ?),
               album = COALESCE(album, ?), genre = COALESCE(genre, ?),
               year = COALESCE(year, ?), duration_s = COALESCE(duration_s, ?),
               file_size_bytes = COALESCE(file_size_bytes, ?),
               bitrate_kbps = COALESCE(bitrate_kbps, ?), updated_at = ?
             WHERE video_id = ?`,
          )
          .run(
            item.row.folderPath,
            item.row.title,
            item.row.artist,
            item.row.album,
            item.row.genre,
            item.row.year,
            finiteOrNull(item.row.durationS),
            finiteOrNull(item.row.fileSizeBytes),
            finiteOrNull(item.row.bitrateKbps),
            now,
            item.videoId,
          );
        // Codec backfill (Sep 19): the mirror cohort predates codec writes,
        // so the Codecs card showed 3,133 "unknown". Derive from the Content
        // row's own FileType/BitDepth — never the filename extension.
        if (rekordboxCodec(item.row.metadata) !== null) {
          opts.state.db
            .query(
              `UPDATE tracks SET codec = COALESCE(codec, ?)
               WHERE video_id = ?`,
            )
            .run(rekordboxCodec(item.row.metadata), item.videoId);
        }
      }
      opts.state.db
        .query(
          `INSERT INTO rekordbox_content (
             content_id, video_id, source_db, folder_path, metadata_json,
             first_seen_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_db, content_id) DO UPDATE SET
             video_id = excluded.video_id,
             folder_path = excluded.folder_path,
             metadata_json = excluded.metadata_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          item.row.contentId,
          item.videoId,
          opts.sourceDb,
          item.row.folderPath,
          JSON.stringify(item.row.metadata),
          now,
          now,
        );
    }
    const removed = opts.state.db
      .query(
        `DELETE FROM rekordbox_content
         WHERE source_db = ?
           AND content_id NOT IN (SELECT content_id FROM rb_adopt_seen)`,
      )
      .run(opts.sourceDb);
    staleLinksRemoved = removed.changes;
    opts.state.db.exec("DROP TABLE temp.rb_adopt_seen");
  });
  apply();
  return {
    ...base,
    linked: plan.length,
    created: insertedCount(plan),
    applied: plan.length,
    staleLinksRemoved,
  };
}

function backupName(dbPath: string): string {
  const ext = extname(dbPath) || ".db";
  const stem = basename(dbPath, ext);
  return join(dirname(dbPath), `${stem}_bak_${backupStamp()}${ext}`);
}

/** Dated VACUUM-INTO snapshot of archive.db before the mirror applies. */
export function snapshotArchive(state: ArchiveState, dbPath: string): string {
  state.db.exec("PRAGMA wal_checkpoint(FULL)");
  const target = backupName(dbPath);
  const quoted = target.replaceAll("'", "''");
  state.db.exec(`VACUUM INTO '${quoted}'`);
  return target;
}
