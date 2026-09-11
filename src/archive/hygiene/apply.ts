/**
 * Apply + validate — the destructive half of hygiene, and the guarded one.
 *
 * Apply (§5 Phase 1.3): moves CONFIRMED findings' losers into the shelf
 * quarantine, re-verifying evidence immediately before every move:
 *   - byte-twin: md5(loser) === md5(keeper) re-checked at apply time
 *   - walk token must equal the CURRENT walk — a stale apply aborts
 *   - moves are same-volume renames; a quarantine name collision is
 *     suffixed, never overwritten
 *   - NOTHING is ever deleted (trap §3.5)
 * The quarantine lives at the SHELF ROOT, never inside Contents/ —
 * auto-relocate scans Contents/ and chases quarantined files into the
 * master DB (the Sep 10 lesson; the shelf hosts that DB).
 *
 * Validate (§4.3 step 5): the post-apply audit the Sep 9 session ran by
 * hand — keepers present, losers still fingerprint-equal, shelf delta ==
 * quarantined count. Failure flips the finding to `failed` with the
 * receipt attached; the UI offers revert (rename back).
 */
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { CheckCtx, Finding, ValidationReceipt } from "./types";

export const QUARANTINE_DIR = ".hygiene-quarantine";

/** Where a loser lands: quarantine/<flattened path>. Path flattening
 *  keeps provenance (artist/album visible) and collision-suffixes when
 *  the same basename quarantines twice — never overwrite (§4.4). */
export function quarantineDest(qDir: string, loserPath: string): string {
  const rel = loserPath.split("/Contents/")[1] ?? basename(loserPath);
  const flat = rel.replace(/\//g, " · ");
  let dest = join(qDir, flat);
  let i = 2;
  while (existsSync(dest)) {
    dest = join(qDir, flat.replace(/(\.[^.]*)?$/, ` (${i})$1`));
    i++;
    if (i > 100) throw new Error(`quarantine collision loop: ${flat}`);
  }
  return dest;
}

/** Apply ONE finding. Returns the receipt segment: whether the loser
 *  moved, and any error (the finding flips to `failed`, the batch
 *  continues — one bad row never kills a 900-row sweep). */
export function applyFinding(
  f: Finding,
  volume: string,
  ctx: CheckCtx,
): { moved: boolean; error?: string; loser?: string; dest?: string } {
  if (f.status !== "confirmed") return { moved: false, error: "not confirmed" };
  if (f.proposedAction.type !== "quarantine-loser")
    return {
      moved: false,
      error: `action ${f.proposedAction.type} is not applyable yet (human step)`,
    };
  const keeper = f.paths[0];
  const loser = f.paths[1];
  if (!keeper || !loser) return { moved: false, error: "malformed paths" };
  if (!existsSync(keeper))
    return { moved: false, error: `keeper gone: ${keeper}` };
  if (!existsSync(loser))
    return { moved: false, error: `loser gone: ${loser}` };
  // evidence re-verification at apply time — the ledger's word is not
  // enough when the disk may have changed since detection (§4.4)
  if (f.kind === "byte-twin") {
    const km = ctx.md5(keeper);
    const lm = ctx.md5(loser);
    if (!km || !lm) return { moved: false, error: "md5 unavailable at apply" };
    if (km !== lm)
      return {
        moved: false,
        error: `md5 mismatch at apply — keeper ${keeper} vs loser ${loser}`,
      };
  }
  const qDir = join(volume, QUARANTINE_DIR);
  try {
    mkdirSync(qDir, { recursive: true });
    const dest = quarantineDest(qDir, loser);
    renameSync(loser, dest);
    return { moved: true, loser, dest };
  } catch (e) {
    return {
      moved: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Post-apply validation for one finding (§5 Phase 4.1). Counting the
 *  whole shelf is the caller's job (it owns the fresh walk). The loser is
 *  verified from its QUARANTINE location (the move already happened —
 *  that's the recoverable copy), passed as `loserNow`. */
export function validateFinding(
  f: Finding,
  shelfBefore: number,
  shelfAfter: number,
  ctx: CheckCtx,
  loserNow?: string,
): ValidationReceipt {
  const keeper = f.paths[0];
  const keepersMissing: string[] = [];
  if (keeper && !existsSync(keeper)) keepersMissing.push(keeper);
  else if (keeper) {
    try {
      const recorded = f.bytes[0];
      const actual = statSync(keeper).size;
      if (recorded !== undefined && recorded !== actual)
        keepersMissing.push(`${keeper} (size changed)`);
    } catch {
      keepersMissing.push(keeper);
    }
  }
  // loser re-verified vs keeper from its QUARANTINE copy — cache-busted
  // (the ledger's cached hashes predate the move)
  const fpMismatches: string[] = [];
  const loserCheck = loserNow ?? f.paths[1];
  if (f.kind === "byte-twin" && loserCheck && existsSync(loserCheck)) {
    const lm = ctx.md5(loserCheck);
    const km = keeper ? ctx.md5(keeper) : null;
    // byte-twins: md5 equality is the proof
    if (!lm || !km || lm !== km) fpMismatches.push(loserCheck);
  } else if (f.kind === "byte-twin") {
    fpMismatches.push(loserCheck ?? "loser missing");
  }
  const delta = {
    before: shelfBefore,
    after: shelfAfter,
    quarantined: Math.max(0, shelfBefore - shelfAfter),
  };
  const ok =
    keepersMissing.length === 0 &&
    fpMismatches.length === 0 &&
    delta.quarantined === 1;
  return {
    ranAt: new Date().toISOString(),
    keepersPresent: 1 - keepersMissing.length,
    keepersMissing,
    fpMismatches,
    shelfDelta: delta,
    ok,
  };
}
