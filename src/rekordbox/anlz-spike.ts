/**
 * megadj rb-anlz-spike — GA-07, the week-1 write-path spike harness.
 *
 * The spike is four experiments run BY HAND in rekordbox (the plan is
 * explicit: five sacrificial tracks, full backup, four questions); this
 * command is the MEASUREMENT half that makes the answers factual instead
 * of eyeballed:
 *
 *   snapshot <mount> --tag A   record per-track ANLZ hashes + sizes +
 *                              section inventories into a dated JSON
 *                              baseline (scratch dir, never the drive)
 *   compare   <mount> --tag A  re-measure and diff against the baseline:
 *                              which tracks' sidecars changed, which
 *                              fields (PQTZ bytes = grid, PWAV bytes =
 *                              waveform), DB-side Analysed flags
 *
 * Q1 (re-export stability)  = snapshot → re-export → compare: all-identical
 *                             means byte-hashing is a valid triage base.
 * Q2 (hand grid nudge)      = snapshot → nudge in rekordbox → compare:
 *                             the diff lists exactly which files/sections
 *                             changed — the true storage of grids.
 *
 * Read-only on the drive; the baseline JSON lives in the scratch dir.
 * The comparison is INVENTORY-level (which sections changed and by how
 * many bytes) plus whole-file hashes — decoding the PQTZ delta into
 * beats is rb-grid-triage's job, not the spike's.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { makeFail, printResult } from "./rb-command-kit.js";
import { commandLog } from "../shared/progress";
import { errMessage as errorText } from "../shared/leaf/fmt";
import { nonEmptyEnv } from "../shared/leaf/guards";
import {
  join,
  basename,
  dirname,
  relative,
  resolve as resolvePath,
} from "node:path";
import { createHash } from "node:crypto";
import {
  parseAnlzGrid,
  parseAnlzInventory,
  rewriteAnlzGrid,
  type AnlzBeat,
} from "../fulltags/anlz";

export type AnlzSpikeMode = "snapshot" | "compare" | "set-grid";

export type { AnlzBeat } from "../fulltags/anlz";

export interface SpikeOptions {
  mount: string;
  tag: string;
  /** "snapshot" writes the baseline; "compare" diffs against it;
   * "set-grid" rewrites one sidecar's PQTZ (Q4 armament). */
  mode: AnlzSpikeMode;
  /** Override the persistent baseline directory (tests and isolated probes). */
  spikeDir?: string;
  /** set-grid only: the sidecar to rewrite (relative key as compare
   * prints it, e.g. "usb/P001/001AB2C3/ANLZ0000.DAT" — or an absolute
   * path inside the mount). */
  file?: string;
  /** set-grid only: beats written as the new PQTZ. */
  beats?: AnlzBeat[];
  /** set-grid only: with --apply --yes, actually write (default dry-run). */
  apply?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

/** One tracked sidecar: hash, size, and its section inventory. */
interface SidecarRec {
  file: string;
  sha256: string;
  bytes: number;
  sections: { tag: string; bytes: number }[];
}

export interface SpikeSnapshot {
  command: "rb-anlz-spike";
  mode: AnlzSpikeMode;
  mount: string;
  tag: string;
  /** When the snapshot was taken (epoch ms) — compare reads it back. */
  takenAt?: number;
  scanned: number;
  tracked: number;
  undecodable: number;
  /** compare mode only. */
  identical?: number;
  /** set-grid only: the sidecar that was rewritten + its pre-edit hash. */
  edited?: string;
  backupPath?: string;
  wasHash?: string;
  changed?: {
    file: string;
    was: string;
    now: string;
    sections: { tag: string; was: number; now: number }[];
  }[];
  added?: string[];
  removed?: string[];
  baselinePath?: string;
  ok: boolean;
  error?: string;
}

const sha256 = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

/** Baseline JSON lives in persistent local state so snapshot and compare may
 * happen across sessions. Tests and isolated probes inject a temporary root;
 * the drive is never written. */
function baselinePath(mount: string, tag: string, spikeDir?: string): string {
  const root =
    spikeDir ??
    nonEmptyEnv("MEGADJ_SPIKE_DIR") ??
    join(process.env.HOME ?? "/tmp", ".local", "state", "megadj", "spike");
  mkdirSync(root, { recursive: true });
  return join(
    root,
    `${basename(mount)}-${tag.replace(/[^A-Za-z0-9_-]/gu, "_")}.json`,
  );
}

/** Walk every ANLZ*.DAT under both possible sidecar roots. RECURSIVE
 * (bounded): the shelf's share/ANLZ is flat, but sticks nest sidecars
 * per track at PIONEER/USBANLZ/<PXXX>/<HHHHHHHH>/ANLZ0000.DAT (the same
 * hash-dir layout anlz_paths.py + rb-grid-triage join by) — a flat
 * readdir saw zero sidecars on any real stick (super-sure fix, Sep 10).
 * Returns keys of the form `<rootName>/<rel>` where rootName is
 * "collection" (share/ANLZ) or "usb" (USBANLZ): every hash dir names its
 * sidecar ANLZ0000.DAT, so basename keying would false-join distinct
 * tracks' files into phantom "changed" rows, and the two roots can
 * themselves hold same-named relative paths. Resolve with
 * `resolveSidecar`. */
const SPIKE_ROOTS: { name: string; sub: string[] }[] = [
  { name: "collection", sub: ["PIONEER", "Master", "share", "ANLZ"] },
  { name: "usb", sub: ["PIONEER", "USBANLZ"] },
];

/** Map a recorded sidecar key back to its absolute path. */
function resolveSidecar(mount: string, key: string): string {
  const [rootName, ...rest] = key.split("/");
  const root = SPIKE_ROOTS.find((r) => r.name === rootName);
  return join(mount, ...(root ? root.sub : []), ...rest);
}

function sidecarKeys(mount: string): string[] {
  const out: string[] = [];
  const MAX_DEPTH = 4; // root/PXXX/HHHHHHHH/file — generous
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // unreadable dir is a console-visible miss, not a crash — vs the
      // baseline it reads as "removed", which is true on disk
      console.error(
        `rb-anlz-spike: unreadable dir ${rel || "."}: ${errorText(e)}`,
      );
      return;
    }
    for (const ent of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(join(dir, ent.name), childRel, depth + 1);
      } else if (/^ANLZ.*\.DAT$/u.test(ent.name)) {
        out.push(childRel);
      }
    }
  };
  for (const root of SPIKE_ROOTS) {
    const abs = join(mount, ...root.sub);
    if (!existsSync(abs)) continue;
    walk(abs, root.name, 0);
  }
  return out;
}

function measure(mount: string): {
  recs: SidecarRec[];
  scanned: number;
  undecodable: number;
} {
  const recs: SidecarRec[] = [];
  let scanned = 0;
  let undecodable = 0;
  for (const key of sidecarKeys(mount)) {
    scanned++;
    const bytes = new Uint8Array(readFileSync(resolveSidecar(mount, key)));
    const inv = parseAnlzInventory(bytes);
    if (!inv) {
      undecodable++;
      continue; // tracked by hash anyway when it reappears
    }
    recs.push({
      file: key,
      sha256: sha256(bytes),
      bytes: bytes.length,
      sections: inv.sections,
    });
  }
  return { recs, scanned, undecodable };
}

export function anlzSpike(opts: SpikeOptions): SpikeSnapshot {
  const log = opts.log ?? commandLog({ json: opts.json });
  const mount = opts.mount.replace(/\/+$/u, "");
  const fail = makeFail((msg: string): SpikeSnapshot => ({
    command: "rb-anlz-spike",
    mode: opts.mode,
    mount,
    tag: opts.tag,
    scanned: 0,
    tracked: 0,
    undecodable: 0,
    ok: false,
    error: msg,
  }));
  if (!existsSync(mount)) return fail(`not mounted: ${mount}`);
  if (!opts.tag.trim()) return fail("--tag is required");

  if (opts.mode === "set-grid") {
    return setGrid(mount, opts, log, fail);
  }

  if (opts.mode === "snapshot") {
    const { recs, scanned, undecodable } = measure(mount);
    const snap: SpikeSnapshot = {
      command: "rb-anlz-spike",
      mode: "snapshot",
      mount,
      tag: opts.tag,
      takenAt: Date.now(),
      scanned,
      tracked: recs.length,
      undecodable,
      baselinePath: baselinePath(mount, opts.tag, opts.spikeDir),
      ok: true,
    };
    writeFileSync(snap.baselinePath!, JSON.stringify({ ...snap, recs }));
    log(
      `snapshot: ${recs.length} sidecars hashed (${scanned} scanned, ${undecodable} undecodable) → ${snap.baselinePath}`,
    );
    return snap;
  }

  // compare
  const bp = baselinePath(mount, opts.tag, opts.spikeDir);
  if (!existsSync(bp))
    return fail(`no baseline for tag "${opts.tag}" — run snapshot first`);
  let base: SpikeSnapshot & { recs: SidecarRec[] };
  try {
    base = JSON.parse(readFileSync(bp, "utf8")) as SpikeSnapshot & {
      recs: SidecarRec[];
    };
  } catch (e) {
    return fail(`baseline unreadable (${errorText(e)}) — re-snapshot`);
  }
  const { recs, scanned, undecodable } = measure(mount);
  const before = new Map(base.recs.map((r) => [r.file, r]));
  const after = new Map(recs.map((r) => [r.file, r]));

  const changed: NonNullable<SpikeSnapshot["changed"]> = [];
  let identical = 0;
  for (const [file, now] of after) {
    const was = before.get(file);
    if (!was) continue;
    if (was.sha256 === now.sha256) {
      identical++;
      continue;
    }
    const tags = new Map(now.sections.map((s) => [s.tag, s.bytes] as const));
    const wasTags = new Map(was.sections.map((s) => [s.tag, s.bytes] as const));
    const allTags = new Set([...tags.keys(), ...wasTags.keys()]);
    changed.push({
      file,
      was: was.sha256.slice(0, 12),
      now: now.sha256.slice(0, 12),
      sections: [...allTags].map((t) => ({
        tag: t,
        was: wasTags.get(t) ?? 0,
        now: tags.get(t) ?? 0,
      })),
    });
  }
  const added = [...after.keys()].filter((f) => !before.has(f));
  const removed = [...before.keys()].filter((f) => !after.has(f));

  const snap: SpikeSnapshot = {
    command: "rb-anlz-spike",
    mode: "compare",
    mount,
    tag: opts.tag,
    scanned,
    tracked: recs.length,
    undecodable,
    identical,
    changed,
    added,
    removed,
    baselinePath: bp,
    ok: true,
  };
  log(
    `compare vs "${opts.tag}" (${new Date(base.takenAt ?? 0).toISOString()}): ${identical} identical · ${changed.length} changed · ${added.length} added · ${removed.length} removed`,
  );
  logChangedRows(changed, log);
  return snap;
}

/** The `CHANGED <file>: <tag> <was>→<now>B` log rows — written once,
 *  shared by the compare runner and the human report. */
function logChangedRows(
  changed: NonNullable<SpikeSnapshot["changed"]>,
  log: (s: string) => void,
): void {
  for (const c of changed) {
    const secs = c.sections
      .map((s) => `${s.tag} ${s.was}→${s.now}B`)
      .join(", ");
    log(`  CHANGED ${c.file}: ${secs}`);
  }
}

/** Neither the entry nor its ancestors may redirect a grid/backup write. */
function containedGridPath(mount: string, path: string): boolean {
  const realMount = realpathSync(mount);
  const expected = resolvePath(realMount, relative(resolvePath(mount), path));
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) return false;
  const actual = entry
    ? realpathSync(path)
    : join(realpathSync(dirname(path)), basename(path));
  return actual === expected && actual.startsWith(`${realMount}/`);
}

/** Rewrite one in-mount sidecar with a pre-edit backup and whole-file verification. */
function setGrid(
  mount: string,
  opts: SpikeOptions & { file?: string; beats?: AnlzBeat[] },
  log: (s: string) => void,
  fail: (msg: string) => SpikeSnapshot,
): SpikeSnapshot {
  const done = (over: Partial<SpikeSnapshot>): SpikeSnapshot => ({
    command: "rb-anlz-spike",
    mode: "set-grid",
    mount,
    tag: opts.tag,
    scanned: 1,
    tracked: 1,
    undecodable: 0,
    ok: true,
    ...over,
  });
  if (!opts.file) return fail("set-grid: --file=<sidecar key> is required");
  if (!opts.beats || opts.beats.length === 0)
    return fail("set-grid: --beats are required (JSON array of grid rows)");
  // three accepted spellings: the compare-style key
  // ("collection/ANLZ0000.DAT" / "usb/P001/<hash>/ANLZ0000.DAT"), a raw
  // mount-relative path, or an absolute path inside the mount.
  const rooted = SPIKE_ROOTS.some((r) => opts.file!.startsWith(`${r.name}/`))
    ? resolveSidecar(mount, opts.file)
    : resolvePath(mount, opts.file);
  const abs = rooted;
  const mountAbs = resolvePath(mount);
  if (!(abs === mountAbs || abs.startsWith(`${mountAbs}/`)))
    return fail(`set-grid: ${opts.file} escapes the mount — refused`);
  if (!existsSync(abs)) return fail(`no such sidecar: ${opts.file}`);
  const backup = `${abs}.pre-grid-${opts.tag.replace(/[^A-Za-z0-9_-]/gu, "_")}`;
  if (!containedGridPath(mount, abs) || !containedGridPath(mount, backup))
    return fail(
      `set-grid: sidecar or backup is a symlink or escapes the mount — refused`,
    );

  const bytes = new Uint8Array(readFileSync(abs));
  const before = parseAnlzGrid(bytes);
  if (!before) return fail(`${opts.file} has no decodable PQTZ grid`);
  const inv = parseAnlzInventory(bytes)!;

  const rewritten = rewriteAnlzGrid(bytes, opts.beats);
  if (!rewritten) return fail(`rewrite produced nothing (layout changed?)`);
  const verify = parseAnlzGrid(rewritten);
  if (!verify || JSON.stringify(verify.beats) !== JSON.stringify(opts.beats))
    return fail(
      "pre-write verification failed — rewritten grid does not decode back to the requested beats; nothing written",
    );
  const newHash = sha256(rewritten);
  const oldHash = sha256(bytes);

  if (!opts.apply) {
    const beatDelta = opts.beats.length - before.beats.length;
    log(
      `DRY RUN ${opts.file}: ${before.beats.length} beats (${inv.sections.find((s) => s.tag === "PQTZ")?.bytes ?? 0}B PQTZ) → ${opts.beats.length} beats (${24 + opts.beats.length * 8}B PQTZ, ${beatDelta >= 0 ? "+" : ""}${beatDelta}); hash ${oldHash.slice(0, 12)} → ${newHash.slice(0, 12)}`,
    );
    log(
      `next: re-run with --apply --yes to write (a pre-edit backup is kept automatically)`,
    );
    return done({ edited: opts.file, wasHash: oldHash });
  }

  copyFileSync(abs, backup);
  writeFileSync(abs, rewritten);

  // the WHOLE-FILE re-read: the written bytes must decode to the exact
  // requested grid AND keep the section inventory's non-PQTZ entries
  const reread = new Uint8Array(readFileSync(abs));
  const ok = (() => {
    if (sha256(reread) !== newHash) return false;
    const g = parseAnlzGrid(reread);
    if (!g || JSON.stringify(g.beats) !== JSON.stringify(opts.beats))
      return false;
    const invNow = parseAnlzInventory(reread);
    if (!invNow) return false;
    const was = new Map(inv.sections.map((s) => [s.tag, s.bytes] as const));
    const now = new Map(invNow.sections.map((s) => [s.tag, s.bytes] as const));
    for (const [tag, wasBytes] of was) {
      if (tag === "PQTZ") continue;
      if (now.get(tag) !== wasBytes) return false;
    }
    return true;
  })();
  if (!ok) {
    copyFileSync(backup, abs); // restore — one bad write never stays
    return fail(
      `post-write verification failed — ${opts.file} restored from ${backup}`,
    );
  }
  log(
    `set-grid ${opts.file}: ${before.beats.length} → ${opts.beats.length} beats written; backup ${backup}; re-verified OK`,
  );
  return done({
    edited: opts.file,
    backupPath: backup,
    wasHash: oldHash,
  });
}

/** Human report (non-json mode) — thin over the log lines. */
export function printSpikeReport(
  r: SpikeSnapshot,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    if (body.mode === "snapshot") {
      log(
        `snapshot "${body.tag}": ${body.tracked} sidecars (${body.scanned} scanned, ${body.undecodable} undecodable) → ${body.baselinePath}`,
      );
      log(
        `next: do the rekordbox experiment, then rb-anlz-spike ${body.mount} compare --tag=${body.tag}`,
      );
      return;
    }
    if (body.mode === "set-grid") {
      if (!body.ok) return; // the error line is already printed
      log(
        `set-grid "${body.tag}": ${body.edited}${body.backupPath ? ` · backup ${body.backupPath}` : " · DRY RUN (nothing written)"}`,
      );
      return;
    }
    log(
      `compare "${body.tag}": ${body.identical} identical · ${body.changed?.length ?? 0} changed · ${body.added?.length ?? 0} added · ${body.removed?.length ?? 0} removed`,
    );
    logChangedRows(body.changed ?? [], log);
    for (const a of body.added ?? []) log(`  ADDED ${a}`);
    for (const d of body.removed ?? []) log(`  REMOVED ${d}`);
  });
}
