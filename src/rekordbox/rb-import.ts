/**
 * megadj rb-import — the sanctioned headless master-DB import (AGENTS.md:
 * "RB auto-writes are rb-import's job only"). Creates one playlist per
 * intake folder under a parent group and inserts DjmdContent rows for
 * every audio file in the folder.
 *
 * Safety gates (each is a hard failure, never a warning):
 *   1. rekordbox must be QUIT (pgrep) — it holds a live WAL
 *   2. dated DB backup (+ WAL/SHM) next to the master before any write
 *   3. dry-run by default; --apply --yes to write
 *   4. per-row transactions; one bad row never kills the batch
 *   5. whole-table post-verify: every row's FolderPath exists on disk,
 *      plus row-count check of exactly what we inserted
 *
 * File fields follow the proven Sep 11 one-off (docs/usb-sync-log.md):
 * SamplerGain float (empty string crashes the flush), FileNameL clipped
 * to 60 chars, FileType by extension, FolderPath as the FULL path.
 *
 * Split per concern (#203): hard gates + the rbImport sequencer stay
 * here; rb-import-probe.ts owns phase-2 prep (scan, payload, dupe gate),
 * rb-import-verify.ts the verify/apply arm (parsers, applyImport).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { rekordboxRunning } from "./guard.js";
import {
  applyConfirmationRefusal,
  makeFail,
  printResult,
  renderKitMarkers,
} from "./rb-command-kit.js";
import { commandLog } from "../progress";
import { errorText } from "../shared/error-text.js";
// AUDIO_EXTS re-exported for the __test sink below: discovery membership
// IS the #69 SSOT (issue #200) — the probe module imports the real set,
// rb-import keeps a test-visible handle on it.
import { AUDIO_EXTS } from "../shared/audio-exts";
import { masterDbPath } from "./master-path.js";
import { dupeGateScan, probePayloadFiles } from "./rb-import-probe";
import {
  applyImport,
  parseWriteOutput,
  parseVerifyOutput,
  verificationError,
  type ApplyCounters,
} from "./rb-import-verify";

export interface RbImportOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Absolute folder whose AUDIO FILES get imported. */
  folder: string;
  /** Playlist name for the batch (defaults to the folder basename). */
  playlist?: string | undefined;
  /** Parent playlist group name (nested folder in the RB sidebar). */
  group?: string | undefined;
  /** F11 dupe gate: import a file even when the collection already holds
   *  the same recording (path-key OR acoustic fingerprint match). The
   *  gate refuses by default and NAMES the match — a renamed-folder
   *  re-import is exactly the BUG-2 vector #1 this closes. */
  allowDupe?: boolean | undefined;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

export interface RbImportResult {
  command: "rb-import";
  db: string;
  folder: string;
  playlist: string;
  group: string | null;
  /** Audio files found in the folder. */
  found: number;
  /** Rows inserted (0 in dry-run). */
  inserted: number;
  /** Rows skipped because a content row already references the file. */
  already: number;
  /** F11 dupe gate: files refused because the collection already holds
   *  the same recording (fingerprint or NFC-casefold path match). */
  dupes: { file: string; matchedBy: "fingerprint" | "path"; rowId: string }[];
  /** Post-write verification: rows referencing our files (must equal
   *  found in apply mode). */
  verified: number;
  /** Whole-table check after write: rows (any) whose path is missing. */
  stillBroken: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  /** Playlist row ID (apply mode). */
  playlistId: string | null;
  errors: string[];
  ok: boolean;
  error?: string;
}

/** Gate 1–4 of rb-import (issue #181 phase split): the hard pre-flight
 *  refusals, in order — flags, DB present, folder present, rekordbox
 *  quit. Each is a failure with its own message; null = all clear. */
function importGateRefusal(
  opts: RbImportOptions,
  dbPath: string,
): string | null {
  // gate 1 — flags before any I/O
  const flagRefusal = applyConfirmationRefusal(opts);
  if (flagRefusal !== null) return flagRefusal;
  // gate 2 — DB present
  if (!existsSync(dbPath)) return `no master DB at ${dbPath}`;
  // gate 3 — folder present
  if (!existsSync(folderArg(opts))) return `no such folder: ${opts.folder}`;
  // gate 4 — rekordbox quit
  if (rekordboxRunning())
    return "rekordbox is running — quit it (live WAL) before rb-import";
  return null;
}

const folderArg = (opts: RbImportOptions): string =>
  opts.folder.replace(/\/+$/u, "");

export async function rbImport(opts: RbImportOptions): Promise<RbImportResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  // Issue #66 SSOT: masterDbPath owns the env override + every layout
  // form — rb-import was the last hand-rolled join, so MEGADJ_RB_MASTER
  // was honored by every rb-* caller except this one until now.
  const dbPath = masterDbPath(opts.mount);
  const folder = opts.folder.replace(/\/+$/u, "");
  const playlist = opts.playlist ?? basename(folder);
  const group = opts.group ?? null;

  const fail = makeFail((msg: string): RbImportResult => ({
    command: "rb-import",
    db: dbPath,
    folder,
    playlist,
    group,
    found: 0,
    inserted: 0,
    already: 0,
    dupes: [],
    verified: 0,
    stillBroken: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    playlistId: null,
    errors: [],
    ok: false,
    error: msg,
  }));

  // gates 1–4 (flags → DB → folder → rekordbox quit), extracted (#181)
  const gateRefusal = importGateRefusal(opts, dbPath);
  if (gateRefusal !== null) return fail(gateRefusal);

  // phase 2 — folder scan + ffprobe payload build (extracted, #181)
  const payloadFiles = probePayloadFiles(folder, log);
  if (payloadFiles.length === 0) return fail(`no audio files in ${folder}`);

  // phase 2.5 — the F11 dupe gate: same-recording rows already in the
  // collection refuse the import unless --allow-dupe. Path half is the
  // NFC+casefold key (pyPathKeyFn); acoustic half fingerprints the
  // duration-±2s candidates through the ONE fpcalc seam
  // (fingerprintFileLength — same judge rb-dedup uses). The verify leg
  // accounts for gated files by NOT expecting content rows for them.
  const dupeGate = dupeGateScan(dbPath, payloadFiles, opts.allowDupe);
  const gatedPaths = dupeGate.refused.map((d) => d.file);
  for (const d of dupeGate.refused)
    log(
      `rb-import: dupe-gated ${basename(d.file)} — same recording already imported (matched by ${d.matchedBy})`,
    );

  log(
    `rb-import: ${payloadFiles.length} audio files → playlist "${playlist}"${group ? ` in group "${group}"` : ""} on ${dbPath}`,
  );

  // phase 3 — the apply write (backup → pyrekordbox → XML twin → verify),
  // extracted (#181, rb-import-verify.ts #203). Counters thread partial
  // state back into the result envelope when a mid-apply error fires.
  const counters: ApplyCounters = {
    py: {
      inserted: 0,
      already: 0,
      gated: 0,
      linked: 0,
      playlistId: null,
      parentId: null,
      errors: [],
    },
    backedUpTo: null,
    verified: 0,
    stillBroken: 0,
  };
  if (opts.apply && opts.yes) {
    try {
      applyImport(
        {
          dbPath,
          folder,
          playlist,
          group,
          payloadFiles,
          gatedPaths,
          log,
        },
        counters,
      );
    } catch (error) {
      const message = errorText(error);
      const { py, backedUpTo, verified, stillBroken } = counters;
      return {
        ...fail(message),
        found: payloadFiles.length,
        inserted: py.inserted,
        already: py.already,
        verified,
        stillBroken,
        playlistId: py.playlistId,
        backedUpTo,
        errors: [
          ...py.errors.map(([file, detail]) => `${file}: ${detail}`),
          message,
        ],
      };
    }
  }

  return {
    command: "rb-import",
    db: dbPath,
    folder,
    playlist,
    group,
    found: payloadFiles.length,
    inserted: counters.py.inserted,
    already: counters.py.already,
    dupes: opts.allowDupe
      ? []
      : dupeGate.refused.map((d) => ({
          file: d.file,
          matchedBy: d.matchedBy,
          rowId: d.rowId,
        })),
    verified: counters.verified,
    stillBroken: counters.stillBroken,
    appliedMode: Boolean(opts.apply),
    backedUpTo: counters.backedUpTo,
    playlistId: counters.py.playlistId,
    errors: counters.py.errors.map(([f, e]) => `${f}: ${e}`),
    ok: true,
  };
}

export const __test = {
  writeScript: (): string =>
    renderKitMarkers(
      readFileSync(
        join(import.meta.dir, "rb-scripts", "import-write.kit.py"),
        "utf8",
      ),
    ),
  gateScanScript: (): string =>
    readFileSync(
      join(import.meta.dir, "rb-scripts", "import-gate-scan.py"),
      "utf8",
    ),
  parseWriteOutput,
  parseVerifyOutput,
  verificationError,
  /** Issue #200 acceptance: discovery membership IS the #69 SSOT —
   *  .alac (the drifted-out extension) must be member, never a private
   *  twin again. */
  AUDIO_EXTS,
};

export function printRbImportReport(
  r: RbImportResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    log(
      `${body.found} audio files · playlist "${body.playlist}"${body.group ? ` (in "${body.group}")` : ""} · ${body.inserted} inserted, ${body.already} already imported, ${body.dupes.length} dupe-gated, ${body.errors.length} errors`,
    );
    for (const d of body.dupes.slice(0, 10))
      log(
        `  ⛔ ${basename(d.file)} — same recording already in the collection (${d.matchedBy} match; re-run with --allow-dupe to force)`,
      );
    for (const e of body.errors.slice(0, 10)) log(`  ✗ ${e}`);
    if (body.appliedMode) {
      log(
        `post-verify: ${body.verified}/${body.found} files referenced · whole-table missing rows: ${body.stillBroken}`,
      );
    } else {
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to insert ${body.found} rows`,
      );
    }
  });
}
