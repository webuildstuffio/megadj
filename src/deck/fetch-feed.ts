// fetch_feed.ts — the live-run ladder feed for fetch jobs (#215 visibility
// pass): an in-memory ring buffer of per-track events the FullTags web
// tab polls while a fetch job runs. The job leg (job_legs.ts runFetchJob)
// parses megadj fetch --json's stderr `@event {json}` protocol lines into
// this feed; GET /api/fetch/feed drains it.
//
// Ring semantics: capped at 2000 events (the same per-drive event cap the
// timeline uses), FIFO. One feed for the whole process — the archive is
// one, and the job engine already enforces one active fetch at a time
// (activeJobOfKind), so feed identity is unambiguous. A stale feed from
// a previous run stays readable until the next start resets it, so a
// late-polling tab always sees a complete, coherent run.

import type { FetchStartWire, FetchTaskWire } from "./shared/types";

/** One feed row: a start marker, a per-track event, or the run footer. */
export type FetchFeedEntry =
  | { at: number; type: "start"; start: FetchStartWire }
  | { at: number; type: "task"; task: FetchTaskWire }
  | { at: number; type: "done"; stats: Record<string, number> };

const CAP = 2000;

let entries: FetchFeedEntry[] = [];

/** Append one parsed event. Capped FIFO — old events fall off the head. */
export function fetchFeedPush(e: FetchFeedEntry): void {
  entries.push(e);
  if (entries.length > CAP) entries = entries.slice(entries.length - CAP);
}

/** Drain the feed (oldest first), optionally from an index — the poller
 *  passes back the length it last saw and gets only the tail. */
export function fetchFeedSince(since: number): {
  entries: FetchFeedEntry[];
  next: number;
} {
  const tail = since > 0 ? entries.slice(since) : entries;
  // next is an epoch counter: base 0 grows with pushes; if the caller's
  // cursor is past the current length (feed reset under it), restart.
  if (since > entries.length) return { entries, next: entries.length };
  return { entries: tail, next: entries.length };
}

/** Reset for a new run (the leg calls this on job start). */
export function fetchFeedReset(): void {
  entries = [];
}

/** Test seam: clear the module state. */
export function fetchFeedClear(): void {
  entries = [];
}
