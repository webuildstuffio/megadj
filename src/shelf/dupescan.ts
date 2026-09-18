/**
 * dupescan — whole-shelf acoustic duplicate scan.
 *
 * The twin pass (dedupe) only resolves "<stem> [<drive>]" pairs the
 * archive sweeps created. It cannot see the other duplicate class: the SAME
 * recording filed under DIFFERENT artist folders or filenames (ripped twice,
 * organized differently) — the ANOTR case. This pass fingerprints EVERY
 * audio file on the shelf (chromaprint, name-blind) and groups by
 * fingerprint equality, so dupes surface no matter what they're called or
 * where they live.
 *
 * Report-only by default (fingerprints cached in the archive DB). `--apply`
 * is intentionally absent: groups feed the same human-gated quarantine flow
 * as dedupe. Parallel worker pool; fp cache makes re-runs fast.
 *
 * #142: the fingerprint/group/apply stages ARE the shared engine
 * (dupescan-engine.ts) — this shell owns walk, policy, gate, report.
 */
import { openLedger } from "../shared/sqlite-ledger";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fingerprintFileLength } from "../fulltags/analysis/fingerprint";
export { parseFpcalcOutput } from "../fulltags/analysis/fingerprint";
import { DupFpCache, type DupGroup } from "./dupescan-shared";
import {
  applyGroupsSafety,
  cutDupGroups,
  fingerprintFiles,
  sameSizeSafe,
} from "./dupescan-engine";
import { nameSimilarity } from "../archive/hygiene/checks/similarity";
import { applyConfirmationRefusal } from "../rekordbox/rb-command-kit.js";
import { resolveShelfVolume } from "../shared/volume";
import { writeJson, setExit } from "../shared/cli-output";
import { walkAudioDir } from "../shared/audio-walk";

export function walkAudio(root: string): string[] {
  return walkAudioDir(root);
}

/** Parse fpcalc stdout into a fingerprint — re-exported from the FullTags
 *  SSOT (fulltags/src/analysis.ts), where the spawn+parse lives as ONE
 *  implementation (fingerprintFileLength) for every fingerprint pass in
 *  the repo. The Sep 11 mass-collision parse fix now has exactly one
 *  home; these regression tests pin it. */
function fingerprint(path: string): string | null {
  return fingerprintFileLength(path);
}

/** Persistent fp cache — one row per file path (re-runs only decode
 * new/changed files). DupFpCache is instantiated DIRECTLY with its table
 * name (issue #73: the one-method FpCache subclass was a jscpd-flagged
 * twin of dedupe-archive's). This alias keeps the exported name that
 * hygiene and the dedupe tests import. */
export const FpCache = DupFpCache;

/** The shelf-tier fingerprint table (shelf-cache namespace). */
export const SHELF_FINGERPRINTS_TABLE = "shelf_fingerprints";

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
    if (json) await writeJson({ error: "shelf not mounted" });
    else log(`shelf not mounted: ${shelfVolume}`);
    // #160 ring 3: setExit is the one mutation point.
    setExit(1);
    return;
  }

  const db = openLedger(dbPath);
  const cache = new FpCache(db, SHELF_FINGERPRINTS_TABLE);
  const files = [...walkAudio(contents)];
  // extra scan dirs fingerprint INTO the same grouping (never into the
  // quarantine-apply candidate set unless they group among themselves —
  // the apply stage skips groups whose keeper lies outside Contents/).
  for (const dir of scanDirs) {
    if (!existsSync(dir)) {
      log(`dupescan: scan dir missing, skipped: ${dir}`);
      continue;
    }
    files.push(...walkAudio(dir));
  }
  log(
    `dupescan: ${files.length} audio files on ${shelfVolume}${scanDirs.length ? ` (+${scanDirs.length} extra dir(s))` : ""}`,
  );

  // stage 1+2: fingerprint (engine) → group (engine, keeper = largest)
  const { cached, computed } = await fingerprintFiles(files, cache, {
    jobs,
    fingerprint,
    log,
    every: 250,
  });
  log(`fingerprints cached: ${cached} · to compute: ${computed}`);
  const cut = cutDupGroups(files, cache, {
    keeperSort: (a, b) => b.bytes - a.bytes,
    reason: (group) =>
      `largest of ${group.length} identical-fingerprint copies`,
  });
  const dupes = cut.groups;
  const redundantBytes = cut.redundantBytes;

  // ---- apply stage (only with --quarantine --yes) ----------------------
  // Safety rules live in dupescan-engine.ts: md5 re-verify at apply time,
  // quarantine-never-delete, per-file collision isolation. Groups whose
  // KEEPER lies outside Contents/ (extra scan dirs) are never applied —
  // an extra dir is a reporting lens, not a quarantine source.
  const contentsInGroup = (g: DupGroup): boolean =>
    g.files.some((f) => f.path.startsWith(`${contents}/`));
  const applyable = dupes.filter(contentsInGroup);
  const qDir = join(shelfVolume, "Contents", ".dupescan-quarantine");
  if (
    applyConfirmationRefusal({
      apply: quarantine,
      yes,
      flag: "--quarantine",
    }) !== null
  ) {
    // two-step gate via the SSOT — surface the refusal, degrade to report
    log(
      applyConfirmationRefusal({
        apply: quarantine,
        yes,
        flag: "--quarantine",
      }) ?? "unreachable",
    );
  }
  const applied = quarantine && yes;
  const errors: string[] = [];
  let quarantined = 0;
  let skippedForReview = 0;
  if (applied) {
    mkdirSync(qDir, { recursive: true });
    // Policy: same-size losers require md5 equality (sameSizeSafe);
    // different-size requires the names to agree (≥0.5 char ratio — a
    // real re-rip), unless --only-identical forbids all same-fp/
    // different-bytes moves. Anything else = possible long-mix fp
    // collision → review, never auto-quarantined.
    const tally = applyGroupsSafety(
      applyable,
      qDir,
      (loser, ctx) =>
        loser.bytes === ctx.keeper.bytes
          ? sameSizeSafe(loser, ctx, { onError: (m) => errors.push(m) })
          : !onlyIdentical && ctx.nameRatio >= 0.5,
      (keeper, losers) =>
        losers.reduce(
          (s, f) => s + nameSimilarity(basename(keeper.path), basename(f.path)),
          0,
        ) / losers.length,
      { onError: (m) => errors.push(m) },
    );
    quarantined = tally.quarantined;
    skippedForReview = tally.skippedForReview;
  }

  if (json) {
    // P1: one summary object, awaited (writeJson = #53 pipe-EOF seam);
    // compact shape is the repo-wide standard (#159 — the pretty-printed
    // variant was the drift).
    await writeJson({
      command: "dupescan",
      shelf: shelfVolume,
      // report provenance (issue #10): a saved dossier must self-identify
      // — stale reports (pre-cleanup counts) otherwise read as current
      generatedAt: new Date().toISOString(),
      contentsDir: contents,
      scanned: files.length,
      duplicateGroups: dupes.length,
      redundantFiles: dupes.reduce((s, g) => s + g.files.length - 1, 0),
      redundantBytes,
      applied,
      quarantined,
      skippedForReview,
      errors,
      groups: dupes,
    });
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
