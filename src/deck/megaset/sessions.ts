// sessions.ts — M6 (#330): resumable/editable set proposals.
//
// A session records a MegaSet proposal so it can be resumed, diffed,
// and improved across sessions. The session is the attribution unit —
// every chain is traceable to a parent session + instruction.
//
// Storage: `megaset_sessions` table in archive.db (the pipeline ledger).
// Verbs: keep (pin steps), swap (replace one step), regen (re-fill a window).
// Each verb produces a NEW session with a parent_id link to the source.

import type { MegasetQuality, MegasetResult } from "../shared/megaset";
import { round3 } from "../../shared/leaf/fmt";

/** Session status lifecycle. */
export type SessionStatus = "draft" | "committed" | "superseded";

/** A stored session row (the DB shape). */
export interface MegasetSession {
  id: string;
  parent_id: string | null;
  preset: string;
  minutes: number;
  genre: string | null;
  search: "greedy" | "beam";
  status: SessionStatus;
  /** The full MegasetResult JSON snapshot — byte-identical on re-read. */
  result_json: string;
  /** M4 quality verdict at creation time. */
  quality: MegasetQuality;
  /** Instruction that produced this session from its parent (null = initial). */
  instruction: string | null;
  created_at: string;
  updated_at: string;
}

/** Create a new session from a fresh build result. */
export function createSession(args: {
  result: MegasetResult;
  quality: MegasetQuality;
  genre: string | null;
  parentId?: string | null;
  instruction?: string | null;
}): Omit<MegasetSession, "updated_at"> {
  const now = new Date().toISOString();
  return {
    id: sessionId(),
    parent_id: args.parentId ?? null,
    preset: args.result.preset,
    minutes: args.result.minutes,
    genre: args.genre,
    search: args.result.search,
    status: "draft",
    result_json: JSON.stringify(args.result),
    quality: args.quality,
    instruction: args.instruction ?? null,
    created_at: now,
  };
}

/** Keep: pin specific steps in the chain (mark them as immutable).
 *  Returns the pinned videoId set — the regen verb respects these. */
export function keepSteps(
  result: MegasetResult,
  videoIds: string[],
): Set<string> {
  const pool = new Set(result.steps.map((s) => s.videoId));
  const kept = new Set<string>();
  for (const id of videoIds) {
    if (pool.has(id)) kept.add(id);
  }
  return kept;
}

/** Swap: replace one step in the chain with a substitute.
 *  Returns a NEW result with the swap applied (deterministic). */
export function swapStep(
  result: MegasetResult,
  targetVideoId: string,
  replacement: MegasetResult["steps"][number],
): MegasetResult {
  const idx = result.steps.findIndex((s) => s.videoId === targetVideoId);
  if (idx === -1) return result;
  const newSteps = [...result.steps];
  newSteps[idx] = { ...replacement, atMin: result.steps[idx]?.atMin ?? 0 };
  return {
    ...result,
    steps: newSteps,
    avg_transition: recomputeAvgTransition(newSteps),
    min_transition: recomputeMinTransition(newSteps),
  };
}

/** Determinism check: same result JSON → same session (byte-identical). */
export function sessionResultStable(session: MegasetSession): boolean {
  let reparsed: string;
  try {
    reparsed = JSON.stringify(JSON.parse(session.result_json));
  } catch {
    return false;
  }
  return reparsed === session.result_json;
}

// ---- internals ----

function sessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ses-${ts}-${rand}`;
}

function recomputeAvgTransition(steps: MegasetResult["steps"]): number | null {
  const transitions = steps
    .map((s) => s.transition)
    .filter((t): t is number => t !== null);
  if (transitions.length === 0) return null;
  return (
    Math.round(
      (transitions.reduce((a, b) => a + b, 0) / transitions.length) * 1000,
    ) / 1000
  );
}

function recomputeMinTransition(steps: MegasetResult["steps"]): number | null {
  const transitions = steps
    .map((s) => s.transition)
    .filter((t): t is number => t !== null);
  if (transitions.length === 0) return null;
  return round3(Math.min(...transitions));
}
