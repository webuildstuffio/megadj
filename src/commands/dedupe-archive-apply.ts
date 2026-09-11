// dedupe-archive-apply.ts — the apply stage for `dedupe-archive --apply
// --yes`, extracted from dedupe-archive.ts at the complexity guard. The
// shelf-dupescan safety rules apply verbatim: fp-equal + same-size +
// md5-equal → safe; fp-equal + dissimilar names + different sizes → left
// for review. Losers move to quarantine, never deleted; collisions abort
// that file, never the run.
import { basename, join } from "node:path";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { nameSimilarityTokens } from "../../fulltags/src/exports";
import { md5sum } from "./shelf-dupescan-apply";
import type { DupGroup } from "./dupescan-shared";

/** Apply outcome appended onto the command's result object. */
export interface ApplyOutcome {
  quarantined: number;
  skippedForReview: number;
  errors: string[];
}

/** Decide one loser: safe to move? Same-size groups require md5 equality;
 *  different-size groups require the names to agree (≥0.5 token ratio — a
 *  real re-rip), else it's a possible fingerprint collision → review. */
function loserSafe(
  loser: { path: string; bytes: number },
  keeper: { path: string; bytes: number },
  keeperMd5: string | null,
): boolean {
  if (loser.bytes === keeper.bytes) {
    // same fp + same size: require byte-equality before moving
    const lm = md5sum(loser.path);
    return keeperMd5 !== null && lm === keeperMd5;
  }
  // different size + fp-equal: only move when names agree (a real re-rip);
  // dissimilar names = possible collision → review
  return (
    nameSimilarityTokens(basename(loser.path), basename(keeper.path)) >= 0.5
  );
}

/** Move one loser into the quarantine dir. Returns true when moved. */
function quarantineLoser(
  loserPath: string,
  qDir: string,
  out: ApplyOutcome,
  log: (m: string) => void,
): boolean {
  const dest = join(qDir, basename(loserPath));
  if (existsSync(dest)) {
    out.errors.push(`quarantine name collision: ${loserPath}`);
    out.skippedForReview++;
    return false;
  }
  try {
    renameSync(loserPath, dest);
    out.quarantined++;
    log(`  → quarantined: ${basename(loserPath)}`);
    return true;
  } catch (e) {
    out.errors.push(
      `move failed: ${loserPath} (${e instanceof Error ? e.message : e})`,
    );
    return false;
  }
}

/** Apply every decided group (caller gates on --apply --yes BEFORE this).
 *  Groups whose keeper sort put duplicates first are re-verified at apply
 *  time — md5s are recomputed HERE, never trusted from the scan. */
export function applyArchiveGroups(
  groups: DupGroup[],
  qDir: string,
  out: ApplyOutcome,
  log: (m: string) => void,
): void {
  mkdirSync(qDir, { recursive: true });
  for (const g of groups) {
    const keeper = g.files[0]!;
    const keeperMd5 = md5sum(keeper.path);
    for (const loser of g.files.slice(1)) {
      if (!existsSync(loser.path)) continue;
      if (loserSafe(loser, keeper, keeperMd5))
        quarantineLoser(loser.path, qDir, out, log);
      else out.skippedForReview++;
    }
  }
}
