// check_matrix.ts — THE SSOT for which health checks apply to which drive
// tier. Every check surface (preflight, drive reports, rail badges, verify
// parsing) derives its role-awareness from THIS table; a `role === "shelf"`
// string compare scattered across modules is how the matrix silently
// rewinds (that exact regression shipped once — jobs.ts/rb.ts lost the
// shelf wiring in a refactor, and shelf drives started failing again).
//
// The model (Sep 10): drives have TIERS, and the tier decides what the
// software judges.
//
//   shelf (archive)  — STORAGE. The master library lives here (rekordbox
//                      Database Management points at it); gig sticks sync
//                      FROM it; NO player ever reads it. Its empty
//                      PIONEER/rekordbox/ device tree is the CORRECT state.
//   gig (master/mirror USB) — a stick that goes in the booth. Players read
//                      it, so the full device-library matrix applies.
//   unknown/library  — treated as gig: a real drive with music on it may
//                      yet be played; judge it fully rather than skip.
//
// Per check:
//   all tiers  — space, junk, bitrot/checksums, verify (a FAILED verify is
//                a real integrity fact about the archive; only its
//                freshness sub-verdict is gig-specific).
//   gig only   — players (player-compat), grids (ANLZ coverage), mirror
//                parity, dual-db parity, changed-since-verify freshness,
//                USB-link floor (a slow shelf link is fine — nothing reads
//                it live), speed floor (same reason).
import type { DriveRole } from "./types";

/** Which check a verdict row/badge belongs to. Kept as a string-literal
 *  union so a typo anywhere is a compile error, and so census tests can
 *  derive expected ids from CHECK_APPLIES instead of hardcoding. */
export type CheckId =
  | "dual-db"
  | "grids"
  | "verify"
  | "bitrot"
  | "junk"
  | "space"
  | "dupes"
  | "artwork"
  | "mirror"
  | "speed"
  | "players";

/** The two behavioral tiers. DriveRole maps onto this via driveTier(). */
export type DriveTier = "archive" | "gig";

/** The one table. `true` = the check is judged on that tier; `false` =
 *  OMITTED entirely (never "auto-fail") — an empty device tree on a shelf
 *  is correct state, not a defect. */
export const CHECK_APPLIES: Record<CheckId, Record<DriveTier, boolean>> = {
  // ---- every tier: data-integrity facts about the stored audio ----
  verify: { archive: true, gig: true },
  bitrot: { archive: true, gig: true },
  junk: { archive: true, gig: true },
  space: { archive: true, gig: true },
  dupes: { archive: true, gig: true },
  // ---- tier-specific ----
  "dual-db": { archive: false, gig: true }, // pdb parity: players-only
  grids: { archive: false, gig: true }, // ANLZ: hardware playback only
  artwork: { archive: true, gig: true }, // browser/browse UX everywhere
  mirror: { archive: false, gig: true }, // "behind the master" is inverted
  //                                        nonsense on the top tier
  speed: { archive: false, gig: true }, // CDJ floor irrelevant — nothing
  //                                        reads the shelf live
  players: { archive: false, gig: true }, // no player reads a shelf, ever
};

/** Map a stored DriveRole to its behavioral tier. unknown/library drives
 *  are judged as gig: they may be real sticks; judge fully, skip nothing. */
export function driveTier(role: DriveRole | string | undefined): DriveTier {
  return role === "shelf" ? "archive" : "gig";
}

/** Does this check apply to a drive with this role? The only question any
 *  check surface should ask. */
export function checkApplies(
  id: CheckId,
  role: DriveRole | string | undefined,
): boolean {
  return CHECK_APPLIES[id][driveTier(role)];
}

/** Check ids a tier omits — used by tests to DERIVE expectations, and by
 *  the drive page to explain the drive's verdict in product language. */
export function omittedChecks(role: DriveRole | string | undefined): CheckId[] {
  const tier = driveTier(role);
  return (Object.keys(CHECK_APPLIES) as CheckId[]).filter(
    (id) => !CHECK_APPLIES[id][tier],
  );
}

/** Product-language one-liner: why those checks don't apply. Surfaced on
 *  the drive page (archive-tier banner) and in role help. */
export const TIER_EXPLANATION: Record<DriveTier, string> = {
  archive:
    "Archive tier — this drive is storage. rekordbox's master library lives here and sticks sync FROM it; no player ever reads it, so player-facing checks (pdb parity, beatgrids, player compatibility, mirror parity, live read speed) don't apply. What still applies: audio files exist, no junk, no bitrot, verify passes.",
  gig: "Gig tier — this stick goes in the booth. The full matrix applies: both device libraries agree, every track has beatgrids, players can read it, and it mirrors the master.",
};
