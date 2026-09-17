/**
 * Mirror Rekordbox's collection census into archive.db without confusing
 * Rekordbox Content IDs with archive source/video IDs.
 *
 * `rekordbox_content` is the lossless cross-reference: one row per master
 * Content row, the exact Content ID, the chosen archive track ID, and the
 * complete pyrekordbox scalar payload. `tracks` remains one row per physical
 * file, so duplicate Rekordbox rows do not make FullTags analyze a file twice.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ArchiveState } from "../archive/state";
import { nameKey } from "../shared/name-key";
import { backupStamp } from "./guard.js";
import {
  applyConfirmationRefusal,
  lastJsonLine,
  makeFail,
  rbPythonFile,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";

export interface RekordboxContentRow {
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
  /** Every scalar djmdContent column plus resolved relationship names. */
  metadata: Record<string, unknown>;
}

export interface ReconcileRekordboxOptions {
  state: ArchiveState;
  sourceDb: string;
  rows: RekordboxContentRow[];
  apply: boolean;
}

export interface ReconcileRekordboxResult {
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

export interface RbAdoptOptions {
  state: ArchiveState;
  archiveDb: string;
  mount: string;
  apply?: boolean;
  yes?: boolean;
  log?: (message: string) => void;
  /** Test seam; production always uses the pyrekordbox reader. */
  readContent?: (dbPath: string) => RekordboxContentRow[];
}

export interface RbAdoptResult extends ReconcileRekordboxResult {
  backedUpTo: string | null;
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

interface PlanRow {
  row: RekordboxContentRow;
  videoId: string;
  createsTrack: boolean;
  fileExists: boolean;
}

function normPath(path: string): string {
  return nameKey(path);
}

function identityPathKey(row: RekordboxContentRow): string {
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

function buildPlan(
  state: ArchiveState,
  sourceDb: string,
  rows: RekordboxContentRow[],
): { plan: PlanRow[]; matchedExisting: number; uniqueFiles: number } {
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
  const selectedByPath = new Map<string, string>();
  const reservedIds = new Set(byId.keys());
  const plan: PlanRow[] = [];
  let matchedExisting = 0;

  const ordered = rows.toSorted((a, b) => {
    const pathOrder = identityPathKey(a).localeCompare(identityPathKey(b));
    return pathOrder !== 0
      ? pathOrder
      : a.contentId.localeCompare(b.contentId, undefined, { numeric: true });
  });
  for (const row of ordered) {
    const pathKey = identityPathKey(row);
    const linked = linkByContent.get(row.contentId);
    const existingAtPath = byPath.get(pathKey)?.[0]?.video_id;
    const selected = selectedByPath.get(pathKey);
    let videoId =
      selected ??
      (linked && byId.has(linked) ? linked : undefined) ??
      existingAtPath ??
      undefined;
    let createsTrack = false;
    if (videoId === undefined) {
      const direct = `rb-${row.contentId}`;
      videoId = reservedIds.has(direct)
        ? generatedId(row.contentId, row.folderPath)
        : direct;
      while (reservedIds.has(videoId)) videoId = `${videoId}-x`;
      reservedIds.add(videoId);
      createsTrack = true;
    } else if (existingAtPath !== undefined || linked !== undefined) {
      matchedExisting += 1;
    }
    selectedByPath.set(pathKey, videoId);
    plan.push({
      row,
      videoId,
      createsTrack,
      fileExists: existsSync(row.folderPath),
    });
  }
  return { plan, matchedExisting, uniqueFiles: selectedByPath.size };
}

export function reconcileRekordboxRows(
  opts: ReconcileRekordboxOptions,
): ReconcileRekordboxResult {
  const failure = makeFail((error: string): ReconcileRekordboxResult => ({
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
    error,
  }));

  if (opts.rows.length === 0)
    return failure("master Content census is empty; refusing to prune");
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of opts.rows) {
    if (!row.contentId) {
      return failure("master contains a Content row with an empty ID");
    }
    if (seenIds.has(row.contentId)) duplicateIds.add(row.contentId);
    seenIds.add(row.contentId);
  }
  if (duplicateIds.size > 0)
    return failure(
      `master contains duplicate Content IDs: ${[...duplicateIds].slice(0, 5).join(", ")}`,
    );

  const { plan, matchedExisting, uniqueFiles } = buildPlan(
    opts.state,
    opts.sourceDb,
    opts.rows,
  );
  const creates = new Set(
    plan.filter((item) => item.createsTrack).map((item) => item.videoId),
  );
  const base: ReconcileRekordboxResult = {
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
               genre, year, first_seen_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rekordbox', ?, ?, ?, ?)`,
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

function insertedCount(plan: PlanRow[]): number {
  return new Set(
    plan.filter((item) => item.createsTrack).map((item) => item.videoId),
  ).size;
}

function backupName(dbPath: string): string {
  const ext = extname(dbPath) || ".db";
  const stem = basename(dbPath, ext);
  return join(dirname(dbPath), `${stem}_bak_${backupStamp()}${ext}`);
}

function snapshotArchive(state: ArchiveState, dbPath: string): string {
  state.db.exec("PRAGMA wal_checkpoint(FULL)");
  const target = backupName(dbPath);
  const quoted = target.replaceAll("'", "''");
  state.db.exec(`VACUUM INTO '${quoted}'`);
  return target;
}

export function rbAdopt(opts: RbAdoptOptions): RbAdoptResult {
  const apply = Boolean(opts.apply);
  const sourceDb = masterDbPath(opts.mount);
  const fail = makeFail((error: string): RbAdoptResult => ({
    command: "rb-adopt",
    sourceDb,
    total: 0,
    uniqueFiles: 0,
    matchedExisting: 0,
    wouldCreate: 0,
    duplicateContentPaths: 0,
    missingFiles: 0,
    linked: 0,
    created: 0,
    applied: 0,
    staleLinksRemoved: 0,
    appliedMode: apply,
    ok: false,
    error,
    backedUpTo: null,
  }));
  if (applyConfirmationRefusal(opts) !== null)
    return fail(applyConfirmationRefusal(opts) ?? "unreachable");
  if (!existsSync(sourceDb)) return fail(`no master DB at ${sourceDb}`);

  opts.log?.(`rb-adopt: reading every Content row from ${sourceDb}`);
  let rows: RekordboxContentRow[];
  try {
    rows = (opts.readContent ?? readRekordboxContent)(sourceDb);
  } catch (error) {
    return fail(errorText(error));
  }
  opts.log?.(`rb-adopt: ${rows.length} master Content row(s)`);

  let backedUpTo: string | null = null;
  if (apply) {
    try {
      backedUpTo = snapshotArchive(opts.state, opts.archiveDb);
      opts.log?.(`rb-adopt: archive backed up to ${backedUpTo}`);
    } catch (error) {
      return fail(`archive backup failed: ${errorText(error)}`);
    }
  }

  let result: ReconcileRekordboxResult;
  try {
    result = reconcileRekordboxRows({
      state: opts.state,
      sourceDb,
      rows,
      apply,
    });
  } catch (error) {
    return {
      ...fail(`archive reconciliation failed: ${errorText(error)}`),
      backedUpTo,
    };
  }
  if (apply && result.ok) {
    const verification = opts.state.db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN t.video_id IS NULL THEN 1 ELSE 0 END) AS broken
         FROM rekordbox_content r
         LEFT JOIN tracks t ON t.video_id = r.video_id
         WHERE r.source_db = ?`,
      )
      .get(sourceDb) as { total: number; broken: number | null };
    if (verification.total !== rows.length || (verification.broken ?? 0) > 0) {
      result = {
        ...result,
        ok: false,
        error: `post-apply verification failed: ${verification.total}/${rows.length} mirrored, ${verification.broken ?? 0} broken track link(s)`,
      };
    }
  }
  return { ...result, backedUpTo };
}

export function printRbAdoptReport(
  result: RbAdoptResult,
  out: (line: string) => void,
): void {
  if (!result.ok) {
    out(`rb-adopt: FAILED — ${result.error ?? "unknown error"}`);
    if (result.backedUpTo) out(`  archive backup: ${result.backedUpTo}`);
    return;
  }
  out(
    `rb-adopt: ${result.total} master rows → ${result.uniqueFiles} unique files; ${result.matchedExisting} matched archive rows, ${result.wouldCreate} new archive rows`,
  );
  out(
    `  ${result.missingFiles} missing file(s); ${result.duplicateContentPaths} duplicate Content path(s)`,
  );
  if (result.appliedMode) {
    out(
      `  applied ${result.applied} exact Content-ID link(s); created ${result.created} track(s); pruned ${result.staleLinksRemoved} stale link(s)`,
    );
    if (result.backedUpTo) out(`  archive backup: ${result.backedUpTo}`);
  } else {
    out("  dry-run — archive.db was not changed; rerun with --apply --yes");
  }
}

export function readRekordboxContent(dbPath: string): RekordboxContentRow[] {
  const result = rbPythonFile({
    file: "adopt-read-content.py",
    args: [dbPath],
    timeoutMs: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `pyrekordbox read failed (exit ${String(result.status)}): ${result.stderr.slice(0, 500)}`,
    );
  }
  const line = lastJsonLine(result.stdout);
  if (!line) throw new Error("pyrekordbox returned no Content rows payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`pyrekordbox returned invalid JSON: ${errorText(error)}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed))
    throw new Error("pyrekordbox Content payload is not an array");
  return parsed as RekordboxContentRow[];
}
