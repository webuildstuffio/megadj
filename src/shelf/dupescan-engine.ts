// dupescan-engine.ts — THE fingerprint-dedupe engine (issue #142).
//
// dupescan and dedupe-archive ran the same three stages as
// hand-copied loops: fingerprint (cache-get → compute-missing → put),
// group (fp-equality, >=2 cut, keeper sort, reason strings), and the
// apply gate (same-size → md5-equality; different-size → name
// agreement; else review — the safety rules that must never drift
// between tiers). The engine is those stages ONCE, parameterized by
// per-tier policy; the commands are walk + policy + report shells.
//
// Kept distinct on purpose:
// - dedupe (the twins tier) is a per-PAIR ladder (md5 → fp →
//   keep-both) with a quality-upgrade two-rename rollback and no fp
//   cache — a different verdict model, not a policy knob. It keeps
//   dedupe-verdict.ts and shares only moveLoser (#84).
// - The fingerprint function is per-tier (dupescan: fpcalc -length 120
//   raw parse; archive: fpcalc -json full-length) and so is the cache
//   table — the cached values are NOT interchangeable. Do not unify
//   the functions silently.
//
// Safety invariants (all tiers, unchanged):
// - never persist a null fingerprint (the transient-miss poisoning trap)
// - never delete — quarantine moves only, through moveLoser (#84)
// - a collision aborts THAT file, never the run
// - the two-step --apply/--quarantine + --yes gate stays in the command
import { statSync } from "node:fs";
import {
  groupByFingerprint,
  moveLoser,
  type DupFile,
  type DupGroup,
  type DupFpCache,
} from "./dupescan-shared";
import { md5Cli } from "./md5-cli";

/** Apply-time byte re-verification rides THE md5 subprocess seam
 *  (#70) — never a second hand-rolled spawn. Scan stages never hash. */
export function md5sum(path: string): string | null {
  return md5Cli(path);
}

// ---- stage 1: fingerprint (cache-get → compute-missing → put) ----------

export interface FingerprintStats {
  cached: number;
  computed: number;
}

export interface FingerprintOpts {
  jobs?: number;
  fingerprint: (path: string) => string | null;
  log?: (s: string) => void;
  /** progress line fired every `every` completions (0/absent = never). */
  every?: number;
}

/** Fill the cache for every file, skipping cached rows and never
 *  persisting a null fingerprint. `jobs` > 1 fans out a small worker
 *  pool (the shelf pass); `jobs` = 1 runs serially (the archive pass).
 *  Files that vanish mid-scan are skipped, not errors. */
export async function fingerprintFiles(
  files: readonly string[],
  cache: DupFpCache,
  opts: FingerprintOpts,
): Promise<FingerprintStats> {
  const log = opts.log ?? (() => {});
  const every = opts.every ?? 0;
  const missing: { path: string; size: number }[] = [];
  let cached = 0;
  for (const f of files) {
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue; // vanished mid-scan
    }
    if (cache.get(f, size) !== undefined) cached++;
    else missing.push({ path: f, size });
  }
  let done = 0;
  const workers = Array.from(
    {
      length: Math.max(1, Math.min(opts.jobs ?? 1, missing.length || 1)),
    },
    async () => {
      for (;;) {
        const next = missing[done];
        if (next === undefined) break;
        done++;
        const fp = opts.fingerprint(next.path);
        // Never cache a miss: a transient fpcalc failure would poison
        // the row permanently and drop the file out of every future
        // dedupe pass (the Sep 11 poisoning trap class).
        if (fp !== null) cache.put(next.path, next.size, fp);
        if (every > 0 && done % every === 0)
          log(`  ${done}/${missing.length} fingerprints…`);
      }
    },
  );
  await Promise.all(workers);
  return { cached, computed: done };
}

// ---- stage 2: group (fp-equality → >=2 cut → keeper sort) --------------

export interface CutOptions {
  /** keeper = files[0] after this sort (largest, then tier tiebreak). */
  keeperSort: (a: DupFile, b: DupFile) => number;
  /** human-readable reason for the group (keeper = files[0] by then). */
  reason: (group: readonly DupFile[], keeper: DupFile) => string;
}

export interface CutResult {
  groups: DupGroup[];
  /** bytes of all losers (the reclaimable total). */
  redundantBytes: number;
}

/** Cut >=2 same-fingerprint groups and sort them largest-group-first.
 *  Unfingerprintable files (null fp) never group — groupByFingerprint
 *  skips them. */
export function cutDupGroups(
  files: readonly string[],
  cache: DupFpCache,
  opts: CutOptions,
): CutResult {
  const grouped = groupByFingerprint(files, cache);
  const groups: DupGroup[] = [];
  for (const [fp, arr] of grouped) {
    if (arr.length < 2) continue;
    arr.sort(opts.keeperSort);
    const keeper = arr[0]!;
    groups.push({
      fingerprint: fp,
      files: arr,
      keep: keeper.path,
      reason: opts.reason(arr, keeper),
    });
  }
  groups.sort((a, b) => b.files.length - a.files.length);
  const redundantBytes = groups.reduce(
    (sum, g) => sum + g.files.slice(1).reduce((s, f) => s + f.bytes, 0),
    0,
  );
  return { groups, redundantBytes };
}

// ---- stage 3: apply (the safety gate, ONE home) -------------------------

export interface ApplyTally {
  quarantined: number;
  skippedForReview: number;
}

/** Group context for loser decisions (computed once per group). */
export interface GroupContext {
  keeper: DupFile;
  keeperMd5: string | null;
  /** 0..1 name agreement of the group per the tier's similarity
   *  function (dupescan: char-ratio average; archive: min token ratio). */
  nameRatio: number;
}

/** The per-tier safety policy: may THIS loser auto-quarantine?
 *  Returning false = skipped-for-review (never an error). Tiers reuse
 *  sameSizeSafe() so the byte-verify rule has one body. */
export type LoserPolicy = (loser: DupFile, ctx: GroupContext) => boolean;

export interface ApplyHooks {
  onQuarantined?: (path: string) => void;
  /** A file the policy refused — reported, never an error. */
  onReview?: (path: string, why: string) => void;
  onError?: (message: string) => void;
}

/** Byte-equality re-verify for same-size losers — shared by every
 *  fp-group tier since the rules were first written down: fp-equal +
 *  same-size + md5-equal → safe. Digests are recomputed HERE, never
 *  trusted from the scan. An md5 mismatch inside a same-size group is
 *  surfaced through onError (a possible long-mix collision) and the
 *  loser goes to review. */
export function sameSizeSafe(
  loser: DupFile,
  ctx: GroupContext,
  hooks: ApplyHooks = {},
): boolean {
  if (loser.bytes !== ctx.keeper.bytes) return false;
  const lm = md5sum(loser.path);
  if (ctx.keeperMd5 === null || lm !== ctx.keeperMd5) {
    hooks.onError?.(`md5 mismatch inside same-size group: ${loser.path}`);
    return false;
  }
  return true;
}

/** Apply every group (the caller has ALREADY gated on --apply/--yes and
 *  pre-filtered groups whose keeper is out of bounds). Losers move into
 *  qDir through moveLoser (#84); per-file failures come back through
 *  hooks.onError — one bad rename never stops the run. */
export function applyGroupsSafety(
  groups: readonly DupGroup[],
  qDir: string,
  policy: LoserPolicy,
  nameRatioOf: (keeper: DupFile, losers: readonly DupFile[]) => number,
  hooks: ApplyHooks = {},
): ApplyTally {
  const tally: ApplyTally = { quarantined: 0, skippedForReview: 0 };
  for (const g of groups) {
    const keeper = g.files[0]!;
    const losers = g.files.slice(1);
    const ctx: GroupContext = {
      keeper,
      keeperMd5: md5sum(keeper.path),
      nameRatio: nameRatioOf(keeper, losers),
    };
    for (const loser of losers) {
      if (!policy(loser, ctx)) {
        tally.skippedForReview++;
        hooks.onReview?.(loser.path, g.reason);
        continue;
      }
      const errs: string[] = [];
      moveLoser(loser.path, qDir, errs, {
        onMoved: () => {
          tally.quarantined++;
          hooks.onQuarantined?.(loser.path);
        },
        onCollision: (src) => {
          tally.skippedForReview++;
          hooks.onError?.(`quarantine name collision: ${src}`);
        },
      });
      for (const message of errs) hooks.onError?.(message);
    }
  }
  return tally;
}
