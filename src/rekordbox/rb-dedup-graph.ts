/**
 * rb-dedup-graph.ts — pure duplicate-graph primitives (issue #144).
 *
 * Split from rb-dedup.ts: component building over the candidate graph is
 * orchestration-free and trivially testable in isolation. No I/O, no
 * subprocess contract — rows in, pairs out.
 */

import { fingerprintFileLength } from "../fulltags/fingerprint";
import type { ScanPair, ScanRow } from "./rb-dedup-parse.js";
import { pickKeeper } from "./rb-dedup-support.js";

export function connectGraph(
  graph: Map<string, Set<string>>,
  first: string,
  second: string,
): void {
  const firstEdges = graph.get(first) ?? new Set<string>();
  firstEdges.add(second);
  graph.set(first, firstEdges);
  const secondEdges = graph.get(second) ?? new Set<string>();
  secondEdges.add(first);
  graph.set(second, secondEdges);
}

export function graphComponentIds(
  graph: Map<string, Set<string>>,
  start: string,
): Set<string> {
  const found = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    for (const neighbor of graph.get(id) ?? []) pending.push(neighbor);
  }
  return found;
}

export function compareStableIds(first: string, second: string): number {
  if (/^\d+$/u.test(first) && /^\d+$/u.test(second)) {
    const firstNumber = BigInt(first);
    const secondNumber = BigInt(second);
    if (firstNumber < secondNumber) return -1;
    if (firstNumber > secondNumber) return 1;
  }
  return first.localeCompare(second);
}

/** Turn cheap scan candidates into mutation proposals. Distinct paths must
 * have identical, full fingerprints; null or mismatch always means keep
 * both. A loser appears once, while one canonical keeper may own a cluster. */
export function buildDupePairs(
  candidates: ScanPair[],
  fingerprint: (path: string) => string | null = fingerprintFileLength,
): DupePair[] {
  const fingerprintCache = new Map<string, string | null>();
  const getFingerprint = (path: string): string | null => {
    if (!fingerprintCache.has(path))
      fingerprintCache.set(path, fingerprint(path));
    return fingerprintCache.get(path) ?? null;
  };
  const rows = new Map<string, ScanRow>();
  const graph = new Map<string, Set<string>>();
  const pathGraph = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    if (candidate.basis === "candidate") {
      const first = getFingerprint(candidate.path);
      if (first === null) continue;
      const second = getFingerprint(candidate.other.path);
      if (second === null || second !== first) continue;
    }
    rows.set(candidate.id, rows.get(candidate.id) ?? candidate);
    rows.set(
      candidate.other.id,
      rows.get(candidate.other.id) ?? candidate.other,
    );
    connectGraph(graph, candidate.id, candidate.other.id);
    if (candidate.basis !== "candidate")
      connectGraph(pathGraph, candidate.id, candidate.other.id);
  }

  const physicalComponents = new Map<string, string>();
  for (const id of [...pathGraph.keys()].toSorted()) {
    if (physicalComponents.has(id)) continue;
    const component = [...graphComponentIds(pathGraph, id)].toSorted();
    const label = component[0];
    if (label === undefined) continue;
    for (const member of component) physicalComponents.set(member, label);
  }

  const pairs: DupePair[] = [];

  const visited = new Set<string>();
  for (const start of [...graph.keys()].toSorted()) {
    if (visited.has(start)) continue;
    const ids = [...graphComponentIds(graph, start)].toSorted();
    for (const id of ids) visited.add(id);
    const componentRows = ids
      .map((id) => rows.get(id))
      .filter((row): row is ScanRow => row !== undefined);
    const [first, ...rest] = componentRows;
    if (first === undefined) continue;
    const keep = rest.reduce((current, row) => {
      if (
        current.path === row.path &&
        current.bitrate === row.bitrate &&
        current.size === row.size
      )
        return compareStableIds(current.id, row.id) <= 0 ? current : row;
      return pickKeeper(current, row) === "a" ? current : row;
    }, first);

    for (const lose of componentRows) {
      if (lose.id === keep.id) continue;
      const samePathComponent =
        physicalComponents.get(keep.id) !== undefined &&
        physicalComponents.get(keep.id) === physicalComponents.get(lose.id);
      pairs.push({
        keepId: keep.id,
        keepPath: keep.path,
        loseId: lose.id,
        losePath: lose.path,
        title: keep.title,
        durDelta: Math.abs(keep.len - lose.len),
        basis: samePathComponent
          ? keep.path === lose.path
            ? "same-path"
            : "path-twin"
          : "fingerprint",
      });
    }
  }
  return pairs;
}

export interface DupePair {
  keepId: string;
  keepPath: string;
  loseId: string;
  losePath: string;
  title: string;
  durDelta: number;
  basis: "same-path" | "path-twin" | "fingerprint";
}
