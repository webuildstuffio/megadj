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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseAnlzInventory } from "../../fulltags/src/anlz";

export interface SpikeOptions {
  mount: string;
  tag: string;
  /** "snapshot" writes the baseline; "compare" diffs against it. */
  mode: "snapshot" | "compare";
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
  mode: "snapshot" | "compare";
  mount: string;
  tag: string;
  /** When the snapshot was taken (epoch ms) — compare reads it back. */
  takenAt?: number;
  scanned: number;
  tracked: number;
  undecodable: number;
  /** compare mode only. */
  identical?: number;
  changed?: {
    file: string;
    was: string;
    now: string;
    sections: Array<{ tag: string; was: number; now: number }>;
  }[];
  added?: string[];
  removed?: string[];
  baselinePath?: string;
  ok: boolean;
  error?: string;
}

const sha256 = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

function fail(opts: SpikeOptions, mount: string, msg: string): SpikeSnapshot {
  return {
    command: "rb-anlz-spike",
    mode: opts.mode,
    mount,
    tag: opts.tag,
    scanned: 0,
    tracked: 0,
    undecodable: 0,
    ok: false,
    error: msg,
  };
}

/** Baseline JSON lives in the scratch dir under data/ (the only allowed
 * write root outside the archive; the drive is never written). */
function baselinePath(mount: string, tag: string): string {
  const root =
    process.env.MEGADJ_SPIKE_DIR ??
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
        `rb-anlz-spike: unreadable dir ${rel || "."}: ${e instanceof Error ? e.message : String(e)}`,
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
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  if (!existsSync(mount)) return fail(opts, mount, `not mounted: ${mount}`);
  if (!opts.tag.trim()) return fail(opts, mount, "--tag is required");

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
      baselinePath: baselinePath(mount, opts.tag),
      ok: true,
    };
    writeFileSync(snap.baselinePath!, JSON.stringify({ ...snap, recs }));
    log(
      `snapshot: ${recs.length} sidecars hashed (${scanned} scanned, ${undecodable} undecodable) → ${snap.baselinePath}`,
    );
    return snap;
  }

  // compare
  const bp = baselinePath(mount, opts.tag);
  if (!existsSync(bp))
    return fail(
      opts,
      mount,
      `no baseline for tag "${opts.tag}" — run snapshot first`,
    );
  let base: SpikeSnapshot & { recs: SidecarRec[] };
  try {
    base = JSON.parse(readFileSync(bp, "utf8")) as SpikeSnapshot & {
      recs: SidecarRec[];
    };
  } catch (e) {
    return fail(
      opts,
      mount,
      `baseline unreadable (${e instanceof Error ? e.message : String(e)}) — re-snapshot`,
    );
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
  for (const c of changed) {
    const secs = c.sections
      .map((s) => `${s.tag} ${s.was}→${s.now}B`)
      .join(", ");
    log(`  CHANGED ${c.file}: ${secs}`);
  }
  return snap;
}

/** Human report (non-json mode) — thin over the log lines. */
export function printSpikeReport(
  r: SpikeSnapshot,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  if (r.mode === "snapshot") {
    log(
      `snapshot "${r.tag}": ${r.tracked} sidecars (${r.scanned} scanned, ${r.undecodable} undecodable) → ${r.baselinePath}`,
    );
    log(
      `next: do the rekordbox experiment, then rb-anlz-spike ${r.mount} compare --tag=${r.tag}`,
    );
    return;
  }
  log(
    `compare "${r.tag}": ${r.identical} identical · ${r.changed?.length ?? 0} changed · ${r.added?.length ?? 0} added · ${r.removed?.length ?? 0} removed`,
  );
  for (const c of r.changed ?? []) {
    const secs = c.sections
      .map((s) => `${s.tag} ${s.was}→${s.now}B`)
      .join(", ");
    log(`  CHANGED ${c.file}: ${secs}`);
  }
  for (const a of r.added ?? []) log(`  ADDED ${a}`);
  for (const d of r.removed ?? []) log(`  REMOVED ${d}`);
}
