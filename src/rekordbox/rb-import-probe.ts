// rb-import-probe.ts — rb-import phase 2 (#203 split, the rb-dedup
// pattern): the folder scan + ffprobe payload build and the F11 dupe-
// gate scan. Pure preparation — reads the intake folder, spawns the ONE
// read-only gate scan, fingerprints candidates through the ONE fpcalc
// seam — and never touches the master DB. rb-import.ts keeps the hard
// gates + the rbImport sequencer; rb-import-verify.ts owns the write.
import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { extname, join, relative } from "node:path";
import { isRecord, isUnknownArray } from "../shared/leaf/guards";
import { probeMediaSync } from "../fulltags/media-probe";
import { fingerprintFileLength } from "../fulltags/analysis/fingerprint";
import { rbPythonFile } from "./rb-python-file.js";
import { lastJsonLine, parseJsonBoundary } from "./rb-command-kit.js";
// AUDIO_EXTS: the #69 SSOT — the private set that lived in rb-import.ts
// missed .alac, so an ALAC rip reaching intake was invisible to
// discovery (issue #200: the #69 drift class, regrown).
import { AUDIO_EXTS } from "../shared/audio-exts";

/** Sep 19 path policy: when the same file also exists under the mount's
 *  Contents/ (shelf-sync's copy), the row's FolderPath prefers the SHELF
 *  path — the master DB must stay valid when the drive travels to other
 *  machines (the local Mac path is an accident of where the import ran).
 *  The rel path under the archive maps 1:1 under Contents/ because
 *  shelf-sync copies batch folders whole. Null when no shelf twin. */
function shelfPathFor(
  mount: string,
  archiveDir: string,
  full: string,
): string | null {
  const rel = relative(archiveDir, full);
  if (rel.startsWith("..") || rel === "") return null;
  const candidate = join(mount, "Contents", rel);
  return existsSync(candidate) ? candidate : null;
}

/** rb-import phase 2 (#181): scan the flat intake folder for audio files
 *  and probe each via the ffprobe seam so rows carry real duration/
 *  bitrate. Tag halves parse the archive convention
 *  "Artist · Album · Title" from the stem. Each row also carries its
 *  chromaprint fingerprint (the F11 dupe gate's acoustic half — the ONE
 *  fpcalc spawn+parse, `fingerprintFileLength`; null degrades the gate
 *  to the path key, never aborts the import). Returns the Python payload
 *  rows (full path first, fingerprint LAST). */
export function probePayloadFiles(
  folder: string,
  log: (s: string) => void,
  /** Mount root + archive dir — when given, a file with a shelf twin
   *  under `<mount>/Contents/` imports with the SHELF path (Sep 19 path
   *  policy: rows must survive the drive traveling). */
  shelf?: { mount: string; archiveDir: string },
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
    if (st.isFile() && AUDIO_EXTS.has(extname(e).toLowerCase()))
      files.push([full, e]);
  }
  if (files.length === 0) return [];

  // probe durations/bitrate via ffprobe so rows carry real values
  // (THE media seam, #80 — one spawn style, guarded JSON boundary)
  const payloadFiles: (string | number | null)[][] = [];
  let fingerprinted = 0;
  let shelfPrefer = 0;
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
    // Sep 19 path policy: prefer the shelf twin's path when it exists —
    // the master DB travels with the drive; a Mac-local path would 404
    // on any other machine (and breaks the export leg).
    const rowPath =
      shelf?.mount !== undefined
        ? (shelfPathFor(shelf.mount, shelf.archiveDir, full) ?? full)
        : full;
    if (rowPath !== full) shelfPrefer++;
    payloadFiles.push([
      rowPath,
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
    `rb-import: probed ${payloadFiles.length} audio files (${fingerprinted} fingerprinted for the dupe gate)${shelfPrefer > 0 ? `, ${shelfPrefer} using shelf paths` : ""}`,
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
export function dupeGateScan(
  dbPath: string,
  payloadFiles: (string | number | null)[][],
  allowDupe: boolean | undefined,
): { refused: DupeRefusal[] } {
  if (allowDupe) return { refused: [] };

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
