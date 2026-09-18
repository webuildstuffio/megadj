/**
 * Mirror Rekordbox's collection census into archive.db without confusing
 * Rekordbox Content IDs with archive source/video IDs.
 *
 * `rekordbox_content` is the lossless cross-reference: one row per master
 * Content row, the exact Content ID, the chosen archive track ID, and the
 * complete pyrekordbox scalar payload. `tracks` remains one row per physical
 * file, so duplicate Rekordbox rows do not make FullTags analyze a file twice.
 *
 * Split per concern (#232, the rb-dedup/rb-import pattern): the option/
 * result shapes, the pyrekordbox read seam, the gates, and the rbAdopt
 * sequencer live here; the apply arm (identity plan, ledger mutation,
 * archive snapshot) lives in rb-adopt-apply.ts.
 */
import { existsSync } from "node:fs";
import type { ArchiveState } from "../archive/state";
import {
  applyConfirmationRefusal,
  lastJsonLine,
  makeFail,
  rbPythonFile,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";
import {
  reconcileRekordboxRows,
  snapshotArchive,
  type ReconcileRekordboxResultShape,
} from "./rb-adopt-apply";

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

export type ReconcileRekordboxResult = ReconcileRekordboxResultShape;

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
