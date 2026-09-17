// CrateDeck shared types — imported by server and web.
//
// DEPENDENCY RULE (enforced by `bunx madge --circular cratedeck/src
// cratedeck/shared cratedeck/web`): this file is the leaf of the graph.
// It may import NOTHING from src/ — every wire type used across the
// server/web boundary is DEFINED in shared/types/<domain>.ts, and src/
// producers import their wire shapes FROM here. This file is the barrel:
// it only re-exports from its domain modules, so all 80 existing
// `from "../shared/types"` import sites keep compiling unchanged
// (#196 — the 846-line monolith split by domain; the leaf stays the
// leaf, it just stops being a monolith).
//
// Domain map (same names as the routes files):
//   types/drive.ts   — Drive row, verdict unions, cards, snapshots, report
//   types/jobs.ts    — JOB_KINDS SSOT, statuses, Job rows, bench rows
//   types/intake.ts  — intake run + the #159 counter-key SSOT
//   types/verify.ts  — verify checks/deltas/reports/help docs
//   types/fleet.ts   — coverage/redundancy/diff (§B6/B7/B8)
//   types/players.ts — players compat, preflight, booth, notes
//   types/misc.ts    — ports/interlock/search + radar/archive/hygiene/megaset re-exports

export * from "./types/drive";
export * from "./types/jobs";
export * from "./types/intake";
export * from "./types/verify";
export * from "./types/fleet";
export * from "./types/players";
export * from "./types/misc";
