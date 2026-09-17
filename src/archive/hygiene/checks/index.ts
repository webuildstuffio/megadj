/**
 * The check registry — one file per check, run in PRIORITY order with a
 * claimed-set short-circuit: a file claimed by an earlier check is never
 * re-reported by a later one (byte-twin evidence beats acoustic evidence
 * beats name heuristics — §5 Phase 1.2).
 *
 * NOT shipped (plan §4.2 lists them; each needs a producer that doesn't
 * exist yet and gets its own slice): spelling-typo + stale-pointer +
 * orphan-audio (rekordbox DB seam), re-download (manual ledger). The
 * truncated-name detector SHIPPED (Sep 17, #9/#37 slice 3). The registry
 * here is the extension point — add the import + one array row;
 * claimed-set + upsert semantics come free.
 */
import type { Finding, FindingKind } from "../types";
import { byteTwin } from "./byte-twin";
import { acousticTwin } from "./acoustic-twin";
import { appledoubleJunk, zeroByte } from "./simple";
import { folderVariant } from "./folder-variant";
import { truncatedName } from "./truncated-name";

export interface CheckResult {
  kind: FindingKind;
  findings: Finding[];
}

/** Every REGISTERED check — the SSOT `--kind` validation and any help/
 *  parity census derive from (never a hand-copied list). */
export const REGISTERED_KINDS: readonly FindingKind[] = [
  appledoubleJunk.kind,
  byteTwin.kind,
  acousticTwin.kind,
  folderVariant.kind,
  truncatedName.kind,
  zeroByte.kind,
] as const;

/** Files already named by an earlier check (keeper OR loser). */
export function claimedSet(findings: Finding[]): Set<string> {
  const s = new Set<string>();
  for (const f of findings) for (const p of f.paths) s.add(p);
  return s;
}

/** All checks in priority order, deduped by the claimed set. Junk check
 *  runs first (they're not audio dupes — nothing else should claim them);
 *  then byte-twin (decisive, cheap), acoustic (strong), truncated-name
 *  (DB-vs-disk rename evidence), folder (weak).
 *  `only` restricts REPORTED kinds (`--kind`): every check still runs on
 *  the full walk so claimed-set filtering stays correct — restriction
 *  filters output, never weakens the evidence chain. */
export function runChecks(
  files: Parameters<typeof byteTwin.detect>[0],
  ctx: Parameters<typeof byteTwin.detect>[1],
  only?: ReadonlySet<string>,
): CheckResult[] {
  const wanted = (k: string): boolean => !only || only.has(k);
  const junk = appledoubleJunk.detect(files, ctx);
  const junkClaimed = claimedSet(junk);

  const walkable = files.filter((f) => !junkClaimed.has(f.path));
  const bytes = byteTwin.detect(walkable, ctx);
  const byteClaimed = claimedSet(bytes);

  const unclaimed = walkable.filter((f) => !byteClaimed.has(f.path));
  const acoustic = acousticTwin.detect(unclaimed, ctx);
  const acousticClaimed = claimedSet(acoustic);

  // folder-variant + truncated-name read ALL walkable files (their units
  // are folders / DB-vs-disk joins, not fp-equal file pairs) — only the
  // junk claims are excluded
  const folders = folderVariant.detect(walkable, ctx);
  const truncated = truncatedName.detect(walkable, ctx);
  void acousticClaimed; // reserved for orphan-audio ordering

  return [
    ...(wanted(appledoubleJunk.kind)
      ? [{ kind: appledoubleJunk.kind, findings: junk }]
      : []),
    ...(wanted(byteTwin.kind)
      ? [{ kind: byteTwin.kind, findings: bytes }]
      : []),
    ...(wanted(acousticTwin.kind)
      ? [{ kind: acousticTwin.kind, findings: acoustic }]
      : []),
    ...(wanted(folderVariant.kind)
      ? [{ kind: folderVariant.kind, findings: folders }]
      : []),
    ...(wanted(truncatedName.kind)
      ? [{ kind: truncatedName.kind, findings: truncated }]
      : []),
    ...(wanted(zeroByte.kind)
      ? [{ kind: zeroByte.kind, findings: zeroByte.detect(unclaimed, ctx) }]
      : []),
  ];
}
