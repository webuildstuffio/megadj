// shared/types/jobs.ts — the job wire domain (#196): the JOB_KINDS
// producer SSOT, statuses, the Job/WireJob rows, and the intake job's
// payload family. Split out of the 846-line types.ts monolith.
// NOTE: kind-docs.test.ts reads JOB_KINDS from shared/types.ts (the
// barrel) — keep the barrel re-exporting this module untouched.

/** The JobKind list — the producer from which the union is derived. Every surface that
 *  enumerates job kinds (deckctl run's validation, the MCP deck_run schema,
 *  deckctl explain's coverage, and the parity census) iterates this array, so
 *  a new kind flows into the type and every consumer from one source.
 *  Surface-local subsets narrow it (deckctl run accepts only drive jobs;
 *  intake ingest stays UI/job-engine-only). */
export const JOB_KINDS = [
  "scan",
  "verify",
  "mirror",
  "benchmark",
  "checksum",
  "ingest",
  "speedtest",
  "hygiene-scan",
  "hygiene-apply",
  "fixes-scan",
  "fixes-apply",
  "grid-health",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

/** Job kinds enqueued against a DRIVE (POST /api/drives/:id/jobs) — the
 *  deckctl run / deck_run subset (grid-health included: the #167 card and
 *  KIND_DOCS point operators at `deckctl run SHELF1 grid-health`). The
 *  rest (ingest = local-archive job; the hygiene and fixes family
 *  routes) have their own enqueue endpoints. */
export const DRIVE_JOB_KINDS = [
  "scan",
  "verify",
  "mirror",
  "benchmark",
  "checksum",
  "speedtest",
  "grid-health",
] as const satisfies readonly JobKind[];

export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "locked";

/** Terminal = no further transitions possible (locked is a blocked state,
 *  queued/running are live). Single source of truth for deckapi.jobTerminal
 *  and the web JobsDock history filter. */
export const TERMINAL_JOB_STATUSES = [
  "done",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly JobStatus[];

/** Live (non-terminal, non-blocked) statuses. */
export const ACTIVE_JOB_STATUSES = [
  "queued",
  "running",
] as const satisfies readonly JobStatus[];

/** Client-side stamp: when THIS browser last received the row from a jobs
 *  fetch. The server never sends it — the web client attaches it after
 *  each fetch (App's refreshJobs) so JobsDock can measure per-row
 *  staleness client-side (a frozen progress + a fresh fetch = the server
 *  really isn't moving). Declared here because it rides the Job wire type
 *  through the fetch-merge pipeline. */
export interface Job extends WireJob {
  /** client-only; optional so server rows typecheck as Job too */
  _received?: number;
}

export interface WireJob {
  id: string;
  drive_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number; // 0..1
  /** Human-readable current step, e.g. "hashing 1,204/8,911 files". */
  message: string | null;
  /** Coarse stage for progress bar segmentation. */
  phase: string | null;
  /** Seconds remaining estimate (null while unknown). */
  eta_seconds: number | null;
  error: string | null;
  result_json: string | null;
  log_path: string | null; // schema column; unused by jobs.ts yet
  /** O87 attribution: "web" | "deckctl" | "auto" | "mcp:<id>" — who asked
   *  for this job. Optional in the type (legacy literals); the jobs table
   *  column defaults to 'web', and enqueue() always sets it. */
  origin?: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TimelineEvent {
  id: string;
  drive_id: string;
  at: number;
  kind: string;
  data: Record<string, unknown>;
}

// ---- benchmarks: one benchmark job's row (the /api/drives/:id/benchmarks
// response rows). Defined here so HealthTab/DrivePage derive from the
// producer's contract, not a consumer-side re-declaration.
export interface BenchRun {
  ran_at: number;
  seq_mbps: number;
  rand4k_mbps: number;
}

/** Result of a `speedtest` job — the minimal ~10MB link-class probe. A tiny
 *  companion to `BenchRun`: cheap enough to run on demand from the banner,
 *  measuring only big-file sequential MB/s (what the USB2/3 gulf shows). */
export interface SpeedProbe {
  ran_at: number;
  mbps: number;
  bytes_read: number;
}
