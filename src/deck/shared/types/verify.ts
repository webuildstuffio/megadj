// shared/types/verify.ts — the verify wire domain (#196): the verify
// check rows, deltas, reports, and the verify-help doc shapes.
// Split out of the 846-line types.ts monolith. Imports its check-status
// and HealthCheck bases from the drive sibling (no cycle — drive.ts
// imports nothing from types/).
import type { HealthCheck } from "./drive";

/** One granular verify check — mirrors HealthCheck but for usb_verify output. */
export interface VerifyCheck {
  id: string;
  label: string;
  status: HealthCheck["status"];
  detail: string;
  /** Plain-English: why does this check matter for a DJ? */
  meaning: string;
  fix?: string | undefined;
  /** The offending track paths (capped) — exactly WHAT needs attention. */
  offenders?: string[] | undefined;
  /** How many offenders exist in total (offenders may be truncated). */
  offender_count?: number | undefined;
}

/** Per-check direction vs the previous run (fewer = improving). */
export interface VerifyDelta {
  check_id: string;
  label: string;
  /** +N more offenders than last run, −N fewer. 0/no-entry = unchanged. */
  delta: number;
  prev_status: VerifyCheck["status"] | null;
  prev_count: number;
  count: number;
}

/** Full structured result of a verify run, stored per drive. */
export interface VerifyReport {
  ran_at: number;
  ok: boolean;
  final: string | null;
  duration_s: number | null;
  checks: VerifyCheck[];
  /** Raw counts from the script (tracks, playlists, pioneer variance…). */
  stats: Record<string, number>;
  summary: string;
  /** Comparison against the previous stored run, when one existed. */
  deltas?: VerifyDelta[];
  prev_ran_at?: number | null;
}

/** The "what does verify actually do" help doc — the SSOT is
 *  src/deck/verify_help.ts (VERIFY_HELP), served verbatim at
 *  /help/jobs and /drives/:id/verify/help; deckctl explain and the web
 *  VerifyTab consume this shape. Restated here so shared stays a leaf;
 *  verify_help.ts's type is structurally identical (a census test would
 *  flag drift — do not edit one side without the other). */
export interface VerifyCheckDoc {
  id: string;
  label: string;
  /** What the check does, mechanically. */
  what: string;
  /** Why a DJ should care. */
  why: string;
  /** What a failure means for gig night. */
  if_fail: string;
  /** Typical fix. */
  fix: string;
}

/** Wire shape of the verify help endpoints above. */
export interface VerifyHelpDoc {
  intro: string;
  duration: string;
  safety: string;
  checks: VerifyCheckDoc[];
}
