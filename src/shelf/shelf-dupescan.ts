/**
 * shelf-dupescan — whole-shelf acoustic duplicate scan.
 *
 * The twin pass (shelf-dedupe) only resolves "<stem> [<drive>]" pairs the
 * archive sweeps created. It cannot see the other duplicate class: the SAME
 * recording filed under DIFFERENT artist folders or filenames (ripped twice,
 * organized differently) — the ANOTR case. This pass fingerprints EVERY
 * audio file on the shelf (chromaprint, name-blind) and groups by
 * fingerprint equality, so dupes surface no matter what they're called or
 * where they live.
 *
 * Report-only by default (fingerprints cached in the archive DB). `--apply`
 * is intentionally absent: groups feed the same human-gated quarantine flow
 * as shelf-dedupe. Parallel worker pool; fp cache makes re-runs fast.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fingerprintFileLength,
  parseFpcalcOutput as fulltagsParseFpcalcOutput,
} from "../../fulltags/src/exports";
import {
  DupFpCache,
  groupByFingerprint,
  type DupGroup,
} from "./dupescan-shared";
import { applyDupGroups } from "./shelf-dupescan-apply";
import { resolveShelfVolume } from "../shared/volume";

// md5sum / nameSimilarity / moveLoser / DupGroup all live in the leaf
// modules (shelf-dupescan-apply.ts / dupescan-shared.ts) — import from
// there directly; re-exports from this module are dead surface (knip).

const AUDIO = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac"]);

export function walkAudio(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const dot = e.name.lastIndexOf(".");
        const ext = dot > 0 ? e.name.slice(dot).toLowerCase() : "";
        if (AUDIO.has(ext)) out.push(abs);
      }
    }
  };
  walk(root);
  return out;
}

/** Parse fpcalc stdout into a fingerprint — re-exported from the FullTags
 *  SSOT (fulltags/src/analysis.ts), where the spawn+parse lives as ONE
 *  implementation (fingerprintFileLength) for every fingerprint pass in
 *  the repo. The Sep 11 mass-collision parse fix now has exactly one
 *  home; these regression tests pin it. */
export const parseFpcalcOutput = fulltagsParseFpcalcOutput;

function fingerprint(path: string): string | null {
  return fingerprintFileLength(path);
}

/** Persistent fp cache — one row per file path (re-runs only decode
 *  new/changed files). Table name keeps the shelf-cache namespace; the
 *  class body is the shared DupFpCache (twin of dedupe-archive's, jscpd-
 *  flagged, now one implementation). Kept exported — shelf-hygiene and
 *  the dedupe tests re-use it. */
export class FpCache extends DupFpCache {
  constructor(db: Database) {
    super(db, "shelf_fingerprints");
  }
}

export interface DupScanOptions {
  shelfVolume?: string;
  jobs?: number;
  json?: boolean;
  log?: (s: string) => void;
  dbPath?: string;
  /** move group losers (all but the keeper) into the shelf quarantine */
  quarantine?: boolean;
  /** require --yes with --quarantine (two-step safety) */
  yes?: boolean;
  /** quarantine ONLY byte-identical (same-size + md5-equal) losers */
  onlyIdentical?: boolean;
  /** extra absolute dirs to fingerprint alongside Contents/ — e.g. the
   *  quarantine's unmatched/ dir, so row-less files cross-check against
   *  the library without moving anything back (report-only aid). */
  scanDirs?: string[];
}

export async function shelfDupescan(opts: DupScanOptions = {}): Promise<void> {
  const {
    shelfVolume = resolveShelfVolume(),
    jobs = 8,
    json = false,
    log = (s) => console.log(s),
    dbPath = process.env.MEGADJ_DB ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
    quarantine = false,
    yes = false,
    onlyIdentical = false,
    scanDirs = [],
  } = opts;

  const contents = join(shelfVolume, "Contents");
  if (!existsSync(contents)) {
    if (json) console.log(JSON.stringify({ error: "shelf not mounted" }));
    else log(`shelf not mounted: ${shelfVolume}`);
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPath);
  const cache = new FpCache(db);
  const files = [...walkAudio(contents)];
  // extra scan dirs fingerprint INTO the same grouping (never into the
  // quarantine-apply candidate set unless they group among themselves —
  // the apply stage skips groups whose keeper lies outside Contents/).
  for (const dir of scanDirs) {
    if (!existsSync(dir)) {
      log(`shelf-dupescan: scan dir missing, skipped: ${dir}`);
      continue;
    }
    files.push(...walkAudio(dir));
  }
  log(
    `shelf-dupescan: ${files.length} audio files on ${shelfVolume}${scanDirs.length ? ` (+${scanDirs.length} extra dir(s))` : ""}`,
  );

  // compute missing fingerprints with a small parallel pool
  const missing = files.filter((f) => {
    try {
      return cache.get(f, statSync(f).size) === undefined;
    } catch {
      return false;
    }
  });
  log(
    `fingerprints cached: ${files.length - missing.length} · to compute: ${missing.length}`,
  );
  let done = 0;
  const workers = Array.from(
    { length: Math.min(jobs, missing.length || 1) },
    async () => {
      for (;;) {
        const f = missing[done];
        if (f === undefined) break;
        done++;
        const { size } = statSync(f);
        cache.put(f, size, fingerprint(f));
        if (done % 250 === 0) log(`  ${done}/${missing.length} fingerprints…`);
      }
    },
  );
  await Promise.all(workers);

  // group by fingerprint (skip nulls/unfingerprintable)
  const groups = groupByFingerprint(files, cache);

  // a duplicate group = >=2 files with the same fingerprint
  const dupes: DupGroup[] = [];
  for (const [fp, arr] of groups) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.bytes - a.bytes);
    dupes.push({
      fingerprint: fp,
      files: arr,
      keep: arr[0]!.path,
      reason: `largest of ${arr.length} identical-fingerprint copies`,
    });
  }
  dupes.sort((a, b) => b.files.length - a.files.length);

  const redundantBytes = dupes.reduce(
    (sum, g) => sum + g.files.slice(1).reduce((s, f) => s + f.bytes, 0),
    0,
  );

  // ---- apply stage (only with --quarantine --yes) ----------------------
  // Guards live in shelf-dupescan-apply.ts: md5 re-verify at apply time,
  // quarantine-never-delete, per-file collision isolation. Groups whose
  // KEEPER lies outside Contents/ (extra scan dirs) are never applied —
  // an extra dir is a reporting lens, not a quarantine source.
  const contentsInGroup = (g: DupGroup): boolean =>
    g.files.some((f) => f.path.startsWith(`${contents}/`));
  const applyable = dupes.filter(contentsInGroup);
  const qDir = join(shelfVolume, "Contents", ".dupescan-quarantine");
  const applied = quarantine && yes;
  let quarantined = 0;
  let skippedForReview = 0;
  const errors: string[] = [];
  if (applied) {
    mkdirSync(qDir, { recursive: true });
    const tally = applyDupGroups(applyable, qDir, onlyIdentical, errors);
    quarantined = tally.quarantined;
    skippedForReview = tally.skippedForReview;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "shelf-dupescan",
          shelf: shelfVolume,
          scanned: files.length,
          duplicateGroups: dupes.length,
          redundantFiles: dupes.reduce((s, g) => s + g.files.length - 1, 0),
          redundantBytes,
          applied,
          quarantined,
          skippedForReview,
          errors,
          groups: dupes,
        },
        null,
        2,
      ),
    );
  } else {
    log(
      `duplicate groups: ${dupes.length} (redundant copies: ${dupes.reduce((s, g) => s + g.files.length - 1, 0)}, ${(redundantBytes / 1e9).toFixed(2)} GB)`,
    );
    for (const g of dupes.slice(0, 40)) {
      log(
        `\n  group of ${g.files.length} — keep: ${g.keep.replace(contents, "")}`,
      );
      for (const f of g.files.slice(1))
        log(
          `    dupe: ${f.path.replace(contents, "")} (${(f.bytes / 1e6).toFixed(1)} MB)`,
        );
    }
    if (dupes.length > 40)
      log(`\n  …and ${dupes.length - 40} more groups (--json for full list)`);
  }
  db.close();
}
