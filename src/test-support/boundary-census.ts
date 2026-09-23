// boundary-census.ts — the boundary census driver: scan the repo's
// production sources for Number()/JSON.parse() boundary calls, prove (or
// sanction) each, and produce the digest the census tests pin.
//
// (#42 split): source discovery + call-site extraction live in
// boundary-census-shared.ts, the catch-visibility analysis in
// boundary-census-failure.ts, and the Number-guard proof machinery in
// boundary-census-guard.ts. This file is the census itself: the scan
// loop, the allowlist reconciliation, and the public API.
import {
  censusDigest,
  callSite,
  parseSource,
  productionSources,
  type BoundaryCall,
  type CensusResult,
} from "./boundary-census-shared";
import { hasVisibleCatch } from "./boundary-census-failure";
import { hasOrderedNumberGuard } from "./boundary-census-guard";

export type { BoundaryCall, CensusResult } from "./boundary-census-shared";
export { isProductionSourcePath } from "./boundary-census-shared";

type CallPredicate = (node: CallExpression) => boolean;
type GuardPredicate = (node: CallExpression, call: BoundaryCall) => boolean;

import {
  forEachChild,
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  type CallExpression,
  type Node,
} from "./ts-ast";

function scanSources(
  sources: Readonly<Record<string, string>>,
  matches: CallPredicate,
  guardedBy: GuardPredicate = () => false,
): { calls: BoundaryCall[]; guarded: Set<BoundaryCall> } {
  const calls: BoundaryCall[] = [];
  const guarded = new Set<BoundaryCall>();
  for (const [file, text] of Object.entries(sources).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceFile = parseSource(file, text);
    const visit = (node: Node): void => {
      if (isCallExpression(node) && matches(node)) {
        const call = callSite(sourceFile, node, file);
        calls.push(call);
        if (guardedBy(node, call)) guarded.add(call);
      }
      forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { calls, guarded };
}

function scanOne(
  file: string,
  text: string,
  matches: CallPredicate,
): BoundaryCall[] {
  return scanSources({ [file]: text }, matches).calls;
}

export function scanNumberSource(file: string, text: string): BoundaryCall[] {
  return scanOne(file, text, isNumberCall);
}

export function scanJsonSource(file: string, text: string): BoundaryCall[] {
  return scanOne(file, text, isJsonParse);
}

function isNumberCall(node: CallExpression): boolean {
  return isIdentifier(node.expression) && node.expression.text === "Number";
}

function isJsonParse(node: CallExpression): boolean {
  return (
    isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSON" &&
    node.expression.name.text === "parse"
  );
}

function disambiguateDuplicateKeys(calls: BoundaryCall[]): void {
  const groups = new Map<string, BoundaryCall[]>();
  for (const call of calls) {
    const group = groups.get(call.key) ?? [];
    group.push(call);
    groups.set(call.key, group);
  }
  for (const group of groups.values())
    if (group.length > 1)
      group.forEach((call, index) => {
        call.key += `#${index + 1}`;
      });
}

function census(
  calls: BoundaryCall[],
  guardedCalls: ReadonlySet<BoundaryCall>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  disambiguateDuplicateKeys(calls);
  const guardedKeys = new Set(
    calls.filter((call) => guardedCalls.has(call)).map((call) => call.key),
  );
  const actualKeys = new Set(calls.map((call) => call.key));
  const violations = calls.filter(
    (call) => !guardedKeys.has(call.key) && allowlist[call.key] === undefined,
  );
  const sanctioned = calls.filter(
    (call) => !guardedKeys.has(call.key) && allowlist[call.key] !== undefined,
  ).length;
  return {
    calls: calls.toSorted((a, b) => a.key.localeCompare(b.key)),
    violations,
    unusedAllowlist: Object.keys(allowlist).filter(
      (key) => !actualKeys.has(key),
    ),
    redundantAllowlist: Object.keys(allowlist).filter(
      (key) => actualKeys.has(key) && guardedKeys.has(key),
    ),
    duplicateKeys: [],
    audited: calls.length,
    guarded: guardedKeys.size,
    sanctioned,
    digest: censusDigest(calls),
  };
}

export function numberBoundaryCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  return numberBoundaryCensusForSources(productionSources(repo), allowlist);
}

export function numberBoundaryCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const { calls, guarded } = scanSources(sources, isNumberCall, (node) =>
    hasOrderedNumberGuard(node),
  );
  return census(calls, guarded, allowlist);
}

export function persistedJsonCensus(
  repo: string,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  return persistedJsonCensusForSources(productionSources(repo), allowlist);
}

export function persistedJsonCensusForSources(
  sources: Readonly<Record<string, string>>,
  allowlist: Readonly<Record<string, string>>,
): CensusResult {
  const { calls, guarded } = scanSources(
    sources,
    isJsonParse,
    (node, call) => call.owner === "parseSnapshotJson" || hasVisibleCatch(node),
  );
  return census(calls, guarded, allowlist);
}

export function formatCensusFailure(
  kind: string,
  result: CensusResult,
): string {
  return [
    `${kind} boundary census failed`,
    ...result.violations.map(
      (call) => `  ${call.file}:${call.line} ${call.source}`,
    ),
    ...result.unusedAllowlist.map((key) => `  stale allowlist: ${key}`),
    ...result.redundantAllowlist.map(
      (key) => `  redundant allowlist (now guarded): ${key}`,
    ),
    ...result.duplicateKeys.map((key) => `  duplicate fingerprint: ${key}`),
    `audited=${result.audited} guarded=${result.guarded} sanctioned=${result.sanctioned}`,
  ].join("\n");
}
