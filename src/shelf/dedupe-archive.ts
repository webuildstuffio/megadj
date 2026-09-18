/**
 * dedupe-archive — fingerprint EVERY archive audio file (chromaprint,
 * name-blind) and resolve same-recording groups: title identity, MD5 and
 * the acoustic pass at intake can only see files in the SAME dump folder;
 * this pass catches cross-batch dupes (the same rip landed in two dated
 * batch folders, or re-added months apart).
 *
 * Reports first; `--apply` quarantines group losers (never deletes) after
 * re-verifying byte/md5 equality where sizes match — the dupescan
 * safety rules apply verbatim: fp-equal + same-size + md5-equal → safe;
 * fp-equal + dissimilar names + different sizes → left for review.
 *
 * Fingerprints cache in the archive DB (file_archive_fingerprints) keyed
 * by path+size, so re-runs only compute new/changed files.
 *
 * #142: the fingerprint/group/apply stages ARE the shared engine
 * (dupescan-engine.ts) — this shell owns walk, policy, gate, report.
 */
import { openLedger } from "../shared/sqlite-ledger";
import { basename, join } from "node:path";
import { fingerprintFile } from "../fulltags/analysis/fingerprint";
import { nameSimilarityTokens } from "../fulltags/analysis/fingerprint-dedupe";
import { walkAudioFiles } from "../fulltags/write/writer";
import { commandLog } from "../shared/progress";
import { DupFpCache, type DupGroup as DupeGroup } from "./dupescan-shared";
import {
  applyGroupsSafety,
  cutDupGroups,
  fingerprintFiles,
  sameSizeSafe,
} from "./dupescan-engine";
import {
  applyConfirmed,
  applyConfirmationRefusal,
} from "../rekordbox/rb-command-kit.js";

// DupeGroup is the shared dupescan group shape (dupescan-shared.ts, the
// leaf both this command and the engine import) — re-exported so
// existing `from "./dedupe-archive"` sites hold.
export type { DupGroup as DupeGroup } from "./dupescan-shared";

export interface DedupeArchiveOptions {
  musicDir: string;
  dbPath: string;
  /** move group losers into the archive quarantine */
  apply?: boolean;
  /** two-step safety with --apply */
  yes?: boolean;
  json?: boolean;
  log?: (m: string) => void;
}

export interface DedupeArchiveResult {
  scanned: number;
  fingerprinted: number;
  cached: number;
  groups: DupeGroup[];
  redundantBytes: number;
  quarantined: number;
  skippedForReview: number;
  errors: string[];
  applied: boolean;
}

/** The archive-tier fingerprint table (distinct from the shelf tier's
 *  shelf_fingerprints — same DupFpCache, direct instantiation, issue #73;
 *  cache VALUES are tier-local: the archive tier fingerprints with
 *  fpcalc -json full-length, not the shelf's -length 120). */
const ARCHIVE_FINGERPRINTS_TABLE = "file_archive_fingerprints";

export async function dedupeArchive(
  opts: DedupeArchiveOptions,
): Promise<DedupeArchiveResult> {
  const log = commandLog(opts);
  const db = openLedger(opts.dbPath, { create: true });
  const cache = new DupFpCache(db, ARCHIVE_FINGERPRINTS_TABLE);
  const res: DedupeArchiveResult = {
    scanned: 0,
    fingerprinted: 0,
    cached: 0,
    groups: [],
    redundantBytes: 0,
    quarantined: 0,
    skippedForReview: 0,
    errors: [],
    applied: false,
  };

  const files = walkAudioFiles(opts.musicDir).filter(
    (p) =>
      !p.includes("/ingest-duplicates/") && !p.includes("/.ingest-duplicates/"),
  );
  res.scanned = files.length;
  log(`dedupe-archive: ${files.length} files in ${basename(opts.musicDir)}/`);

  // stage 1: fingerprint (engine, serial — the archive tier never raced
  // the pool against a hygiene worker; keep it that way)
  const stats = await fingerprintFiles(files, cache, {
    fingerprint: fingerprintFile,
    log,
    every: 25,
  });
  res.cached = stats.cached;
  res.fingerprinted = stats.computed;
  log(`fingerprints: ${res.cached} cached, ${res.fingerprinted} computed`);

  // stage 2: group (engine). Keeper = biggest lossless-leaning pick:
  // size is a good proxy inside one recording group (AIFF > MP3 of the
  // same audio), then shorter name.
  const cut = cutDupGroups(files, cache, {
    keeperSort: (a, b) =>
      b.bytes - a.bytes || basename(a.path).length - basename(b.path).length,
    reason: (group, keeper) => {
      const minRatio = Math.min(
        ...group
          .slice(1)
          .map((f) =>
            nameSimilarityTokens(basename(f.path), basename(keeper.path)),
          ),
      );
      return minRatio >= 0.5
        ? `largest of ${group.length} identical-recording copies`
        : `largest of ${group.length} fp-equal copies (dissimilar names — review)`;
    },
  });
  res.groups = cut.groups;
  res.redundantBytes = cut.redundantBytes;
  for (const g of res.groups) {
    log(
      `  [group] ${g.files.length} copies · keep ${basename(g.keep)} · ${g.reason}`,
    );
    for (const f of g.files.slice(1))
      log(`      twin: ${f.path.slice(opts.musicDir.length + 1)}`);
  }

  // ---- apply stage (only with --apply --yes) ------------------------------
  // Safety rules live in dupescan-engine.ts: md5 re-verify at apply
  // time, name-similarity review gate, quarantine-never-delete.
  const applied = applyConfirmed(opts);
  if (applyConfirmationRefusal(opts) !== null) {
    log(applyConfirmationRefusal(opts) ?? "unreachable");
  }
  if (applied) {
    // Policy: same-size losers require md5 equality (sameSizeSafe);
    // different-size requires the names to agree (≥0.5 token ratio — a
    // real re-rip), else possible fingerprint collision → review.
    const qDir = join(opts.musicDir, ".dupescan-quarantine");
    const tally = applyGroupsSafety(
      res.groups,
      qDir,
      (loser, ctx) =>
        loser.bytes === ctx.keeper.bytes
          ? sameSizeSafe(loser, ctx, {
              onError: (m) => res.errors.push(m),
            })
          : ctx.nameRatio >= 0.5,
      (keeper, losers) =>
        Math.min(
          ...losers.map((f) =>
            nameSimilarityTokens(basename(f.path), basename(keeper.path)),
          ),
        ),
      {
        onError: (m) => res.errors.push(m),
        onQuarantined: (p) => log(`  → quarantined: ${basename(p)}`),
      },
    );
    res.quarantined = tally.quarantined;
    res.skippedForReview = tally.skippedForReview;
  }
  res.applied = applied;
  db.close();
  return res;
}
