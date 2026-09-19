// intake-status.ts — `megadj intake-status` (#238, postmortem F5): ONE
// reconciled census over the archive music tree: files on disk ↔ archive.db
// rows, compared under NFC + casefold so the case-variant path class that
// ate 3 files in the unreferenced-strays incident can never read as a
// mismatch again (and a case-variant twin is reported as a COLLISION, not
// silently absorbed).
//
// One source printed for the user — this command is the count SSOT the
// stale-canvas failure mode (the "4,427" incident) was missing.
//
// Optional master-DB leg: when a drive mount is reachable, the census also
// counts rekordbox Content rows (path-bearing) via the rb-db-fixture
// reader seam and joins them case-insensitively. When the drive is absent
// the leg reports `available: false` — an honest gap, never a zero that
// reads as "no rows".
//
// Read-only: this command never moves, writes, or deletes anything.
// (`organize` remains the mover; its move-or-merge + row-update contract
// and the case-insensitive stray check live there and in intake paths.)
import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
// The #69 SSOT (subset check lives in the shared module) — never a
// hand-rolled twin (audio-ext-drift-census pins this).
import { isAudioFile } from "../shared/audio-exts";

import type { ArchiveState, TrackRow } from "../archive/state";
import { DumpLedger, type DumpCensus } from "../archive/dump-ledger";

/** NFC + casefold: the path identity for every compare in this census. */
export function pathKey(p: string): string {
  return p.normalize("NFC").toLowerCase();
}

export interface IntakeStatusOptions {
  state: ArchiveState;
  musicDir: string;
  /** Drive mount holding the rekordbox master DB (optional leg). */
  driveMount?: string | undefined;
  json: boolean;
  log: (message: string) => void;
}

export interface DiskFile {
  path: string;
  bytes: number;
}

export interface CaseCollision {
  key: string;
  paths: string[];
}

export interface DbRowMismatch {
  videoId: string;
  title: string | null;
  dbPath: string;
  reason: "missing-on-disk" | "outside-music-dir";
}

export interface IntakeStatusResult {
  ok: boolean;
  musicDir: string;
  filesOnDisk: number;
  diskBytes: number;
  dbRowsWithPaths: number;
  rowsMissingOnDisk: number;
  rowsOutsideMusicDir: number;
  filesWithoutDbRow: number;
  caseCollisions: CaseCollision[];
  mismatches: DbRowMismatch[];
  /** Dump ledger census (#20): every ingest batch as one unit, newest
   *  first. Read from the same archive DB — present even when empty. */
  dumps: DumpCensus;
  masterDb: {
    available: boolean;
    mount: string | undefined;
    contentRows: number;
    pathBearingRows: number;
    rowsMissingOnDisk: number;
    note: string;
  };
}

/** Walk the archive music tree for audio files (batch folders included;
 *  quarantine/staging dirs live at the shelf root, never under the
 *  music tree, so nothing to skip here by policy). */
export function walkAudioFiles(musicDir: string): DiskFile[] {
  const out: DiskFile[] = [];
  if (!existsSync(musicDir)) return out;
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st: Stats;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (isAudioFile(name)) out.push({ path: full, bytes: st.size });
    }
  };
  walk(musicDir);
  return out;
}

/** Case-variant path twins: DISTINCT paths sharing one normalized key.
 *  Identical entries are deduped first — a disk file and its exact db
 *  row are a match, not a twin. (Note: on a case-insensitive volume you
 *  cannot create two same-dir files differing only by case, so the
 *  detectable twin is two db rows — or a db row vs a differently-cased
 *  deeper path — folding to one key.) */
export function findCaseCollisions(paths: string[]): CaseCollision[] {
  const byKey = new Map<string, string[]>();
  for (const p of new Set(paths)) {
    const k = pathKey(p);
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  return [...byKey.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([key, twinPaths]) => ({ key, paths: twinPaths }));
}

export function intakeStatus(opts: IntakeStatusOptions): IntakeStatusResult {
  const { state, musicDir } = opts;
  const files = walkAudioFiles(musicDir);
  const diskBytes = files.reduce((a, f) => a + f.bytes, 0);

  const downloaded: TrackRow[] = state
    .allTracks()
    .filter((t) => t.status === "downloaded" && t.file_path);

  const diskByPath = new Map(files.map((f) => [pathKey(f.path), f]));
  const mismatches: DbRowMismatch[] = [];
  let outside = 0;

  for (const t of downloaded) {
    const p = t.file_path as string;
    if (!diskByPath.has(pathKey(p))) {
      if (!p.startsWith(`${musicDir}/`) && p !== musicDir) {
        outside++;
        mismatches.push({
          videoId: t.video_id,
          title: t.title,
          dbPath: p,
          reason: "outside-music-dir",
        });
      } else {
        mismatches.push({
          videoId: t.video_id,
          title: t.title,
          dbPath: p,
          reason: "missing-on-disk",
        });
      }
    }
  }

  // Disk files with NO db row: case-insensitive join, so a row whose
  // stored path differs only by case still claims its file (the F5
  // bug class — the old raw-string compare swept such files as strays).
  const dbPathKeys = new Set(downloaded.map((t) => pathKey(t.file_path!)));
  const orphanFiles = files.filter((f) => !dbPathKeys.has(pathKey(f.path)));

  const caseCollisions = findCaseCollisions([
    ...files.map((f) => f.path),
    ...downloaded.map((t) => t.file_path as string),
  ]);

  // Optional master-DB leg: degrade honestly when the drive is absent.
  const masterDb: IntakeStatusResult["masterDb"] = {
    available: false,
    mount: opts.driveMount,
    contentRows: 0,
    pathBearingRows: 0,
    rowsMissingOnDisk: 0,
    note: opts.driveMount
      ? `no master.db found under ${opts.driveMount} (pass the drive mount when the drive is plugged in)`
      : "drive not mounted — pass [drive] to include the rekordbox leg",
  };

  const result: IntakeStatusResult = {
    ok: true,
    musicDir,
    filesOnDisk: files.length,
    diskBytes,
    dbRowsWithPaths: downloaded.length,
    rowsMissingOnDisk: mismatches.filter((m) => m.reason === "missing-on-disk")
      .length,
    rowsOutsideMusicDir: outside,
    filesWithoutDbRow: orphanFiles.length,
    caseCollisions,
    mismatches,
    dumps: new DumpLedger(state.db).census(),
    masterDb,
  };
  return result;
}

export function printIntakeStatus(
  r: IntakeStatusResult,
  log: (message: string) => void,
): void {
  log("megadj intake-status — archive census (files ↔ archive.db)");
  log(`  music dir:            ${r.musicDir}`);
  log(
    `  files on disk:        ${r.filesOnDisk}  (${(r.diskBytes / 1e9).toFixed(2)} GB)`,
  );
  log(`  db rows w/ paths:     ${r.dbRowsWithPaths}`);
  log(`  rows missing on disk: ${r.rowsMissingOnDisk}`);
  log(`  rows outside dir:     ${r.rowsOutsideMusicDir}`);
  log(`  files w/o db row:     ${r.filesWithoutDbRow}`);
  if (r.caseCollisions.length > 0) {
    log(`  case-variant twins:   ${r.caseCollisions.length}`);
    for (const c of r.caseCollisions.slice(0, 10)) {
      log(`    ${c.paths.join("  ↔  ")}`);
    }
  }
  log(`  master.db leg:        ${r.masterDb.note}`);
  if (r.dumps.counts.total > 0) {
    const c = r.dumps.counts;
    log(
      `  dumps:                ${c.total} (${c.done} done, ${c.partial} partial, ${c.pending} file(s) pending)`,
    );
    for (const d of r.dumps.dumps.slice(0, 5))
      log(
        `    ${d.folder} — ${d.status}, ${d.ingested} in, ${d.pending} pending`,
      );
  }
  const reconciled =
    r.rowsMissingOnDisk === 0 &&
    r.filesWithoutDbRow === 0 &&
    r.caseCollisions.length === 0;
  log(`  verdict: ${reconciled ? "RECONCILED" : "DRIFT (see buckets above)"}`);
}
