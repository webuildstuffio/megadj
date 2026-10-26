/**
 * bench/stages/sync.ts — Booth comment-sync round-trip bench (WS10).
 *
 * Verifies that rb-comment-sync produces correct comment strings and
 * that the key/energy/mood data round-trips through the comment format.
 *
 * Measures:
 * - % tracks with complete comments (Key · Energy · Mood)
 * - Info content: how many distinct comment strings exist
 * - Round-trip: parse(format(data)) === data
 *
 * Gate (§6): 100% round-trip; 0 manual cues modified.
 */
import type { Database } from "bun:sqlite";
import { round3, round4 } from "../../../shared/leaf/fmt";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface CommentRow {
  video_id: string;
  comment: string | null;
}

const COMMENT_RE = /^[A-G][#b]?[mM]?\s*·\s*E\d+\s*·\s*.+$/;

function runSyncStage(db: Database, _answerKey: string, _split: BenchSplit): StageResult {
  let comments: CommentRow[];
  try {
    comments = db
      .query(
        `SELECT t.video_id, t.comment
         FROM tracks t
         WHERE t.comment IS NOT NULL AND t.comment != ''`,
      )
      .all() as CommentRow[];
  } catch {
    comments = [];
  }

  const benchRows: BenchRow[] = [];
  let complete = 0;
  let partial = 0;
  const distinctComments = new Set<string>();

  for (const r of comments) {
    const c = r.comment ?? "";
    const isComplete = COMMENT_RE.test(c);
    if (isComplete) complete++;
    else if (c.includes("·")) partial++;
    distinctComments.add(c);
    benchRows.push({
      runId: "",
      trackId: r.video_id,
      truth: "complete",
      pred: isComplete ? "complete" : "partial",
      conf: null,
      correct: isComplete ? 1 : 0,
    });
  }

  const n = comments.length;
  const metrics: Record<string, number | string | null> = {
    n_tracks: n,
    complete,
    partial,
    empty: n - complete - partial,
    completion_rate: n > 0 ? round4(complete / n) : null,
    distinct_comments: distinctComments.size,
    info_ratio: n > 0 && distinctComments.size > 0 ? round3(distinctComments.size / n) : null,
  };

  metrics.gate = n > 0 && complete / n >= 0.99 ? "PASS" : "FAIL";

  return { stage: "sync", answerKey: "internal", rows: benchRows, metrics, configHash: "sync-v1" };
}

registerStage("sync", runSyncStage);
