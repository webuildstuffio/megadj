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
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, extname, join } from "node:path";
import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import { probeMediaSync } from "../fulltags/media-probe";
import { fingerprintFileLength } from "../fulltags/fingerprint";
import { rekordboxRunning } from "./guard.js";
import {
  applyConfirmationRefusal,
  isDecimalIdOrNull,
  isStringPair,
  lastJsonLine,
  makeFail,
  parseJsonBoundary,
  printResult,
  rbPythonFile,
  renderKitMarkers,
} from "./rb-command-kit.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";
import { commandLog } from "../progress";
import { errorText } from "../shared/error-text.js";
import { masterDbPath } from "./master-path.js";

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

const AUDIO_EXT = new Set([
  ".aiff",
  ".aif",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
]);

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

/** rb-import phase 2 (#181): scan the flat intake folder for audio files
 *  and probe each via the ffprobe seam so rows carry real duration/
 *  bitrate. Tag halves parse the archive convention
 *  "Artist · Album · Title" from the stem. Each row also carries its
 *  chromaprint fingerprint (the F11 dupe gate's acoustic half — the ONE
 *  fpcalc spawn+parse, `fingerprintFileLength`; null degrades the gate
 *  to the path key, never aborts the import). Returns the Python payload
 *  rows (full path first, fingerprint LAST). */
function probePayloadFiles(
  folder: string,
  log: (s: string) => void,
): (string | number | null)[][] {
  const files: [string, string][] = [];
  // single-level intake-folder listing (the gate above already failed on
  // a missing folder; a top-level readdir is the documented rb-import
  // shape — intake batches are flat) — not the recursive tree walk
  for (const e of readdirSync(folder)) {
    if (e.startsWith(".")) continue;
    const full = join(folder, e);
    let st: Stats;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && AUDIO_EXT.has(extname(e).toLowerCase()))
      files.push([full, e]);
  }
  if (files.length === 0) return [];

  // probe durations/bitrate via ffprobe so rows carry real values
  // (THE media seam, #80 — one spawn style, guarded JSON boundary)
  const payloadFiles: (string | number | null)[][] = [];
  let fingerprinted = 0;
  for (const [full, fname] of files) {
    const probe = probeMediaSync(full);
    const duration = probe?.durationS ?? 0;
    const bitrate = probe?.bitrateKbps ?? 0;
    // tags come from the archive DB conventions: parse "Artist · Album · Title"
    const stem = fname.replace(/\.[^.]+$/u, "");
    const parts = stem.split(" · ");
    const title = parts[2] ?? parts[1] ?? stem;
    const artist = parts.length >= 3 ? (parts[0] ?? null) : (parts[0] ?? null);
    const fp = fingerprintFileLength(full);
    if (fp !== null) fingerprinted++;
    payloadFiles.push([
      full,
      fname,
      title,
      artist,
      null,
      null,
      null,
      duration,
      bitrate,
      null,
      null,
      fp,
    ]);
  }
  log(
    `rb-import: probed ${payloadFiles.length} audio files (${fingerprinted} fingerprinted for the dupe gate)`,
  );
  return payloadFiles;
}

/** A dupe-gate refusal: the incoming file duplicates a recording already
 *  in the collection, proven by fingerprint or NFC-casefold path. */
export interface DupeRefusal {
  file: string;
  matchedBy: "fingerprint" | "path";
  rowId: string;
}

/** The F11 dupe-gate scan (read-only, ONE fresh spawn): Python emits the
 *  incoming files' path-key hits plus the duration-±2s candidate rows;
 *  TS judges fingerprint candidates through the ONE fpcalc seam — the
 *  rb-dedup shape (Python lists, TS fingerprints), never a second
 *  fpcalc spawn style. Duration prefilter first: a full-collection
 *  fpcalc pass would be minutes; candidates after ±2s are a handful. */
function dupeGateScan(
  dbPath: string,
  payloadFiles: (string | number | null)[][],
  opts: RbImportOptions,
): { refused: DupeRefusal[] } {
  if (opts.allowDupe) return { refused: [] };

  // incoming fingerprints (already computed in phase 2, index 11)
  const incoming = payloadFiles.flatMap((f) => {
    const path = f[0];
    const fp = f[11];
    return typeof path === "string" && typeof fp === "string" && fp
      ? [{ path, fp }]
      : [];
  });

  const scan = rbPythonFile({
    file: "import-gate-scan.py",
    args: [
      dbPath,
      JSON.stringify({
        files: payloadFiles.map((f) => [
          f[0],
          typeof f[7] === "number" ? f[7] : 0,
        ]),
      }),
    ],
    timeoutMs: 120_000,
  });
  const raw = parseJsonBoundary(lastJsonLine(scan.stdout), "dupe gate scan");
  if (!isRecord(raw) || !isUnknownArray(raw.candidates)) {
    throw new Error("dupe gate scan returned an invalid payload");
  }
  const candidates = raw.candidates.flatMap((c) => {
    if (!isRecord(c)) return [];
    const rowId = typeof c.rowId === "string" ? c.rowId : null;
    const path = typeof c.path === "string" ? c.path : null;
    const duration =
      typeof c.duration === "number" && Number.isFinite(c.duration)
        ? c.duration
        : null;
    const targets = isUnknownArray(c.targets) ? c.targets : [];
    if (rowId === null || path === null || !existsSync(path)) return [];
    return [{ rowId, path, duration, targets }];
  });

  const refused = new Map<string, DupeRefusal>();
  // path half — NFC+casefold full-path hits (Python already judged)
  for (const c of candidates) {
    for (const t of c.targets) {
      const target = String(t);
      if (!refused.has(target)) {
        refused.set(target, {
          file: target,
          matchedBy: "path",
          rowId: c.rowId,
        });
      }
    }
  }
  // acoustic half — fingerprint the duration candidates (the ONE seam)
  const fpCandidates = candidates.filter(
    (c) => !c.targets.length && c.duration !== null,
  );
  const fpByPath = new Map<string, string | null>();
  const incomingByFp = new Map<string, string>();
  for (const f of incoming) {
    if (f.fp) incomingByFp.set(f.fp, f.path);
  }
  for (const c of fpCandidates) {
    let fp = fpByPath.get(c.path);
    if (fp === undefined) {
      fp = fingerprintFileLength(c.path);
      fpByPath.set(c.path, fp);
    }
    if (fp === null) continue;
    const hit = incomingByFp.get(fp);
    if (hit && !refused.has(hit))
      refused.set(hit, { file: hit, matchedBy: "fingerprint", rowId: c.rowId });
  }
  return { refused: [...refused.values()] };
}

interface PyOut {
  inserted: number;
  already: number;
  gated: number;
  linked: number;
  playlistId: string | null;
  parentId: string | null;
  errors: [string, string][];
}

interface VerifyOut {
  hit: number;
  broken: number;
  total: number;
  playlistRows: number;
  contiguous: boolean;
  playlistExists: boolean;
}

function parseWriteOutput(raw: string): PyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox write");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.inserted) ||
    !isNonNegativeInteger(value.already) ||
    !isNonNegativeInteger(value.linked) ||
    !isNonNegativeInteger(value.gated) ||
    !isDecimalIdOrNull(value.playlistId) ||
    !isDecimalIdOrNull(value.parentId) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(isStringPair)
  ) {
    throw new Error("pyrekordbox write returned an invalid result payload");
  }
  return {
    inserted: value.inserted,
    already: value.already,
    linked: value.linked,
    gated: value.gated,
    playlistId: value.playlistId,
    parentId: value.parentId,
    errors: value.errors,
  };
}

function parseVerifyOutput(raw: string): VerifyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox post-verify");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.hit) ||
    !isNonNegativeInteger(value.broken) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.playlistRows) ||
    typeof value.contiguous !== "boolean" ||
    typeof value.playlistExists !== "boolean"
  ) {
    throw new Error("pyrekordbox post-verify returned invalid counters");
  }
  return {
    hit: value.hit,
    broken: value.broken,
    total: value.total,
    playlistRows: value.playlistRows,
    contiguous: value.contiguous,
    playlistExists: value.playlistExists,
  };
}

function verificationError(
  found: number,
  py: PyOut,
  verified: VerifyOut,
): string | null {
  // F11: gated files are accounted for but get NO content row and NO
  // playlist row — the verify expectations use the row-bearing count.
  const rows = py.inserted + py.already;
  if (py.errors.length > 0)
    return `pyrekordbox write reported ${py.errors.length} row error(s)`;
  if (rows + py.gated !== found)
    return `pyrekordbox write accounted for ${rows + py.gated}/${found} imported files`;
  if (verified.total < verified.hit)
    return `post-verify returned impossible counters (${verified.hit} hits across ${verified.total} rows)`;
  if (verified.hit !== rows)
    return `post-verify referenced ${verified.hit}/${rows} imported files`;
  if (verified.broken !== 0)
    return `post-verify found ${verified.broken} missing file path(s) in the collection`;
  if (!verified.playlistExists)
    return "post-verify could not re-read the playlist row";
  if (!verified.contiguous)
    return "post-verify found a non-contiguous playlist TrackNo sequence";
  if (verified.playlistRows !== rows)
    return `post-verify found ${verified.playlistRows}/${rows} playlist member rows`;
  return null;
}

/** The success counters + error bookkeeping the apply phase threads
 *  through (mutation + verify callbacks write into these). */
interface ApplyCounters {
  py: PyOut;
  backedUpTo: string | null;
  verified: number;
  stillBroken: number;
}

/** rb-import phase 3 (#181): the ONE sanctioned master-DB write — dated
 *  backup via the twin seam, pyrekordbox write, XML twin nodes, delayed
 *  fresh-process post-verify. Throws only for the caller's failure
 *  envelope; all counters are kept in `counters` so a mid-apply error
 *  still reports partial state. `gatedPaths` are F11 dupe-gated files —
 *  imported never, and excluded from post-verify's expected row count. */
function applyImport(
  ctx: {
    dbPath: string;
    folder: string;
    playlist: string;
    group: string | null;
    payloadFiles: (string | number | null)[][];
    gatedPaths: string[];
    log: (s: string) => void;
  },
  counters: ApplyCounters,
): void {
  const { dbPath, playlist, group, payloadFiles, gatedPaths } = ctx;
  const mutation = applyPlaylistTwinMutation({
    dbPath,
    what: "rb-import",
    log: ctx.log,
    onBackup: ({ db }) => {
      counters.backedUpTo = db;
    },
    mutateDb: () => {
      const result = rbPythonFile({
        file: "import-write.kit.py",
        args: [
          dbPath,
          JSON.stringify({
            files: payloadFiles,
            playlist,
            group,
            gated: gatedPaths.map((p) => [p]),
          }),
        ],
        timeoutMs: 300_000,
      });
      const value = parseWriteOutput(lastJsonLine(result.stdout));
      if (value.playlistId === null || value.errors.length > 0)
        throw new Error(
          value.errors[0]?.join(": ") ??
            "pyrekordbox write returned no playlist id",
        );
      return value;
    },
    nodes: (value) => {
      if (value.playlistId === null)
        throw new Error("playlist mutation returned no playlist id");
      const parentId = value.parentId ?? "0";
      return [
        ...(group && value.parentId
          ? [
              {
                id: value.parentId,
                name: group,
                parentId: "0",
                attribute: 1,
              },
            ]
          : []),
        {
          id: value.playlistId,
          name: playlist,
          parentId,
          attribute: 0,
        },
      ];
    },
    verifyDb: (value) => {
      if (value.playlistId === null)
        throw new Error("playlist mutation returned no playlist id");
      const result = rbPythonFile({
        file: "import-verify.py",
        args: [
          dbPath,
          JSON.stringify(payloadFiles.map((file) => file[0])),
          value.playlistId,
        ],
        timeoutMs: 120_000,
      });
      const verify = parseVerifyOutput(lastJsonLine(result.stdout));
      counters.verified = verify.hit;
      counters.stillBroken = verify.broken;
      const failure = verificationError(payloadFiles.length, value, verify);
      if (failure) throw new Error(failure);
    },
  });
  counters.py = mutation.value;
  counters.backedUpTo = mutation.backedUpTo;
}

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
  const dupeGate = dupeGateScan(dbPath, payloadFiles, opts);
  const gatedPaths = dupeGate.refused.map((d) => d.file);
  for (const d of dupeGate.refused)
    log(
      `rb-import: dupe-gated ${basename(d.file)} — same recording already imported (matched by ${d.matchedBy})`,
    );

  log(
    `rb-import: ${payloadFiles.length} audio files → playlist "${playlist}"${group ? ` in group "${group}"` : ""} on ${dbPath}`,
  );

  // phase 3 — the apply write (backup → pyrekordbox → XML twin → verify),
  // extracted (#181). Counters thread partial state back into the result
  // envelope when a mid-apply error fires.
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
