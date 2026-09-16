/**
 * keeper.ts — THE duplicate-keeper decision, parameterized by tier
 * policy (issue #158).
 *
 * "Which of these duplicates is the keeper?" is the most
 * safety-relevant decision in the dedupe domain, and it was made by
 * five hand-rolled comparators with four different policies — the
 * ingest inline even claimed "same tiebreaks as everywhere" while
 * using a shorter-basename rule nobody else had. The policies are
 * DELIBERATELY different (rb-dedup prefers device-export Contents
 * membership because the loser path may be referenced by exports;
 * ingest prefers shorter basenames because pool rips ship "Track -
 * Extended Mix.mp3" vs "Track (Better Rip) 1.mp3" noise), so this is
 * NOT a policy unification: one comparator, explicit per-tier
 * policies, every ordering visible and test-pinned.
 *
 * Tiers and their declared policies:
 * - rb-dedup (`pickRbKeeper`): Contents-member → higher bitrate →
 *   bigger size → stable path. The original pickKeeper contract.
 * - ingest (`pickScoredKeeper`): higher score → shorter basename.
 *   Was inlined three times inside ingest (within-folder,
 *   by-content, by-fingerprint) — now one helper, three thin calls.
 * - shelf-dedupe keeps qualityRank at its verdict (its key input is
 *   the rank number, not a path) — pinned by the same table test.
 *
 * No tier's ordering changes at this commit — the table test pins
 * each policy so a future edit cannot silently move a winner.
 */

import { basename } from "node:path";

export interface RbCandidate {
  path: string;
  size: number;
  bitrate: number;
}

/** rb-dedup tier: Contents-member first, higher bitrate, bigger size,
 * stable path. Contract-compatible with the original pickKeeper. */
const inContents = (p: string): boolean => /\/Contents(?:\/|$)/u.test(p);

export function pickRbKeeper(
  first: RbCandidate,
  second: RbCandidate,
): "a" | "b" {
  const aIn = inContents(first.path);
  const bIn = inContents(second.path);
  if (aIn !== bIn) return aIn ? "a" : "b";
  if (first.bitrate !== second.bitrate)
    return first.bitrate > second.bitrate ? "a" : "b";
  if (first.size !== second.size) return first.size > second.size ? "a" : "b";
  return first.path <= second.path ? "a" : "b";
}

/** Ingest tier: higher score wins; equal scores keep the
 * shorter-basename file (pool-rip noise rule); full tie keeps the
 * first-seen. `first` = incumbent, `second` = challenger. `pathOf`
 * adapts the caller's record shape (ingest's Record_ carries `file`). */
export function pickScoredKeeper<A>(
  first: A,
  second: A,
  pathOf: (x: A) => string,
  scoreOf: (x: A) => number,
): "a" | "b" {
  const fScore = scoreOf(first);
  const sScore = scoreOf(second);
  if (sScore > fScore) return "b";
  if (
    sScore === fScore &&
    basename(pathOf(second)).length < basename(pathOf(first)).length
  )
    return "b";
  return "a";
}
