/**
 * The check registry — one file per check, run in PRIORITY order with a
 * claimed-set short-circuit: a file claimed by an earlier check is never
 * re-reported by a later one (byte-twin evidence beats acoustic evidence
 * beats name heuristics — §5 Phase 1.2).
 *
 * NOT shipped (plan §4.2 lists them; each needs a producer that doesn't
 * exist yet and gets its own slice): spelling-typo + truncated-name +
 * stale-pointer + orphan-audio (rekordbox DB seam), re-download (manual
 * ledger). The registry here is the extension point — add the import +
 * one array row; claimed-set + upsert semantics come free.
 */
import type { Finding, FindingKind } from "../types";
import { byteTwin } from "./byte-twin";
import { acousticTwin } from "./acoustic-twin";
import { appledoubleJunk, zeroByte } from "./simple";
import { folderVariant } from "./folder-variant";

export interface CheckResult {
  kind: FindingKind;
  findings: Finding[];
}

/** Files already named by an earlier check (keeper OR loser). */
export function claimedSet(findings: Finding[]): Set<string> {
  const s = new Set<string>();
  for (const f of findings) for (const p of f.paths) s.add(p);
  return s;
}

/** All checks in priority order, deduped by the claimed set. Junk check
 *  runs first (they're not audio dupes — nothing else should claim them);
 *  then byte-twin (decisive, cheap), acoustic (strong), folder (weak). */
export function runChecks(
  files: Parameters<typeof byteTwin.detect>[0],
  ctx: Parameters<typeof byteTwin.detect>[1],
): CheckResult[] {
  const junk = appledoubleJunk.detect(files, ctx);
  const junkClaimed = claimedSet(junk);

  const walkable = files.filter((f) => !junkClaimed.has(f.path));
  const bytes = byteTwin.detect(walkable, ctx);
  const byteClaimed = claimedSet(bytes);

  const unclaimed = walkable.filter((f) => !byteClaimed.has(f.path));
  const acoustic = acousticTwin.detect(unclaimed, ctx);
  const acousticClaimed = claimedSet(acoustic);

  // folder-variant reads ALL walkable files (its unit is folders, not
  // files) — only the junk claims are excluded
  const folders = folderVariant.detect(walkable, ctx);
  void acousticClaimed; // reserved for truncated-name/orphan ordering

  return [
    { kind: appledoubleJunk.kind, findings: junk },
    { kind: byteTwin.kind, findings: bytes },
    { kind: acousticTwin.kind, findings: acoustic },
    { kind: folderVariant.kind, findings: folders },
    { kind: zeroByte.kind, findings: zeroByte.detect(unclaimed, ctx) },
  ];
}
