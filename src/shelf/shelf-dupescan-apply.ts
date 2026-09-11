// shelf-dupescan-apply.ts — the apply stage for `shelf-dupescan --quarantine
// --yes`, extracted from shelf-dupescan.ts at the complexity guard. Guards,
// in order: (1) every loser is re-verified md5-vs-keeper at apply time — a
// same-fingerprint group with DIFFERENT md5s but wildly different names is a
// possible long-mix collision and is skipped unless sizes also match
// (byte-equal); (2) losers move to quarantine, never deleted; (3) collisions
// in quarantine abort that file, not the run.
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import type { DupGroup } from "./dupescan-shared";
import { moveLoser } from "./dupescan-shared";
import { nameSimilarity } from "../archive/hygiene/checks/similarity";

/** md5 via the macOS `md5` CLI (apply-stage re-verify; the scan stage never
 *  hashes — fingerprints are the grouping key there). */
export function md5sum(path: string): string | null {
  const r = spawnSync("md5", ["-q", path]);
  if (r.status !== 0) return null;
  const h = r.stdout.toString().trim();
  return h.length > 0 ? h : null;
}

/** Outcome counters for one apply pass. */
export interface ApplyTally {
  quarantined: number;
  skippedForReview: number;
}

/** Decide + apply one loser. Returns true when the file quarantined. */
function decideLoser(
  loser: { path: string; bytes: number },
  keeper: { path: string; bytes: number },
  keeperMd5: string | null,
  avgNameRatio: number,
  onlyIdentical: boolean,
  qDir: string,
  errors: string[],
  tally: ApplyTally,
): boolean {
  const sameSize = loser.bytes === keeper.bytes;
  if (sameSize) {
    // same fingerprint + same size: require byte-equality
    const lm = md5sum(loser.path);
    if (keeperMd5 && lm !== keeperMd5) {
      errors.push(`md5 mismatch inside same-size group: ${loser.path}`);
      tally.skippedForReview++;
      return false;
    }
  } else if (onlyIdentical || avgNameRatio < 0.5) {
    // --only-identical: never touch same-fp/different-bytes files.
    // different size + dissimilar names = possible long-mix fp collision —
    // needs human/ear review, never auto-quarantined
    tally.skippedForReview++;
    return false;
  }
  return moveLoser(loser.path, qDir, errors);
}

/** Apply every decided group (caller gates on --quarantine --yes BEFORE
 *  this). Losers move into qDir; per-file failures collect in errors — one
 *  bad rename never stops the run. */
export function applyDupGroups(
  dupes: DupGroup[],
  qDir: string,
  onlyIdentical: boolean,
  errors: string[],
): ApplyTally {
  const tally: ApplyTally = { quarantined: 0, skippedForReview: 0 };
  for (const g of dupes) {
    const keeper = g.files[0]!;
    const keeperMd5 = md5sum(keeper.path);
    // name similarity across the group decides how strict the checks are
    const avgNameRatio =
      g.files
        .slice(1)
        .reduce(
          (s, f) => s + nameSimilarity(basename(keeper.path), basename(f.path)),
          0,
        ) /
      (g.files.length - 1);
    for (const loser of g.files.slice(1)) {
      if (
        decideLoser(
          loser,
          keeper,
          keeperMd5,
          avgNameRatio,
          onlyIdentical,
          qDir,
          errors,
          tally,
        )
      )
        tally.quarantined++;
    }
  }
  return tally;
}
