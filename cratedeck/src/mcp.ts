/**
 * mcp.ts — MCP (Model Context Protocol) server over CrateDeck.
 *
 * The principles say agents get the product 1:1 with humans: this exposes
 * everything deckctl does as MCP tools over stdio JSON-RPC — drive health,
 * fleet coverage, and (with confirmation) job runs; the rekordbox
 * interlock is enforced server-side and mirrored here in the tool layer.
 *
 * Run: bun run cratedeck/src/mcp.ts   (add via your MCP client config)
 * Protocol: MCP 2025-06-18 (JSON-RPC 2.0, newline-delimited over stdio).
 *
 * This file owns ASSEMBLY ONLY (the #89 file-length guard — same split
 * pattern as archive_tools.ts / getdat_tools.ts):
 *   mcp_read_tools.ts    read-only deck_* handlers (status/report/fleet/…)
 *   mcp_action_tools.ts  mutating deck_* handlers (run/cancel/hygiene/…)
 *   archive_tools.ts     the archive_* half (megadj's own DB, readonly)
 *   getdat_tools.ts      GetDat intake/conversion
 *
 * Tools:
 *   deck_status                 interlock + drives + active jobs
 *   deck_drives                 drive list with badge verdicts
 *   deck_report {drive}         full health dossier (dual-DB, grids, parity…)
 *   deck_coverage {min_copies?} fleet track×drive matrix + at-risk list
 *   deck_redundancy {min_copies?} per-playlist protection audit
 *   deck_diff {a, b}            added/removed/changed between two drives
 *   deck_jobs                   recent jobs
 *   deck_run {drive, kind, wait}  ENQUEUES A JOB — scan|verify|mirror|benchmark|checksum
 *   deck_cancel {job_id}        cancel an active job
 *   deck_explain {kind?}        what each job does, typical duration, safety
 *   deck_preflight              gig-night pass/fail across mounted drives (B12)
 *   deck_players {drive?}       which players can read each stick (N75/N78)
 *   deck_booth {ids?}           the player set compat gates enforce + citations (ids = set)
 *   deck_note {drive, note}     RECORD a finding on a drive timeline (O88)
 *   deck_notes {drive?}         active agent findings (O88, readonly)
 *   deck_rename {drive, nickname?} set/clear the display nickname (mutating)
 *   archive_search_tracks {q}   search the archive (O82b, readonly)
 *   archive_track_stats {video_id}  one track's full archive row
 *   archive_ingest_status       counts + recent runs + newest tracks
 *   archive_lowq_queue          below-bitrate upgrade queue (D24)
 *   archive_source_diff {a, b}  track-set diff between two sources
 *   archive_grid_cross_check    fitted-grid verdicts: ok/off/octave/drift
 *   archive_mood_profile        mood/dance/VA averages + extremes (roadmap #4)
 *   archive_similar_tracks {id, k?}  I49 "sounds like" cosine kNN (readonly)
 *   archive_set_build {preset?, minutes?}  set-builder proposal (readonly)
 *   archive_cue_ledger          8-bar phrase-cue ledger (readonly)
 *   archive_library_overview    FullTags mirror: genres/years/art/energy
 *   archive_skip_census         why gone/skipped rows didn't land
 *   archive_sources             source-tag census (pre-diff lookup)
 *   archive_analysis_coverage   playable vs beats/mood/cues ledgers
 *   deck_prep                   weekly digest markdown (O83, readonly)
 *   deck_search {q}             global search: playlists + folders (B9, readonly)
 *   deck_help {term?}           glossary + job/surface explainers (readonly)
 *   deck_dismiss {drive,note_id} retire an agent note from the active feed (mutating)
 *   archive_sweep               D30 bitrot/truncation sweep (readonly)
 *   getdat_ingest {folder,dry_run?}  run megadj ingest and return its JSON summary
 *   getdat_intake {action?,folder?,dry_run?}  dump census (#20) / process a dump
 *   getdat_convert {dry_run?,no_artwork?}  run archive-wide WAV→AIFF conversion
 */
import { archiveTools } from "./archive-tools";
import { deriveDeckTools, type DeckMcpVerb } from "./mcp-surfaces";
import { ensureServer } from "./deckapi";
export { jobTerminal } from "./deckapi";
import { serveMcp, type ToolDef } from "./mcp-server";
import { getdatTools } from "./getdat-tools";
import { DumpReader } from "./dump-reader";
import { DECK_READ_HANDLERS } from "./mcp-read-tools";
import { DECK_ACTION_HANDLERS } from "./mcp-action-tools";

// re-exported for tests (deckapi's terminal-status predicate)
export type { ToolDef } from "./mcp-server";

// ---- tool assembly ----------------------------------------------------------
// ToolDef lives in mcp_server.ts (the JSON-RPC half); the handler TABLES
// live in the per-concern modules. `Record<DeckMcpVerb, ToolDef>` makes a
// verb missing from either half a compile error, not a runtime surprise.
const DECK_HANDLERS: Record<DeckMcpVerb, ToolDef> = {
  ...DECK_READ_HANDLERS,
  ...DECK_ACTION_HANDLERS,
} as Record<DeckMcpVerb, ToolDef>;

const TOOLS: Record<string, ToolDef> = {
  ...deriveDeckTools(DECK_HANDLERS),
  // ---- GetDat intake/conversion (mutating, async CLI seam) --------------
  // Derived from getdat_tools.ts (#47): mcp.ts owns assembly only. The
  // dump census (#20) reads megadj's archive DB readonly (same path the
  // server's readers use — MEGADJ_DB / the state default).
  ...getdatTools({
    dumpCensus: () =>
      new DumpReader(
        process.env.MEGADJ_DB ??
          `${process.env.HOME}/.local/state/megadj/archive.db`,
      ).census(),
  }),

  // ---- O82b: the archive half (megadj's own DB, readonly) -------------------
  ...archiveTools(),
};

// ---- server loop (plumbing lives in mcp_server.ts) --------------------------
async function main(): Promise<void> {
  // Offline harnesses set CRATEDECK_OFFLINE=1: never probe, never spawn —
  // the stdio server serves immediately and backend-backed tools get a
  // clean "unreachable" error from the transport gate in deckapi.ts.
  // Local tools (deck_explain, deck_help, getdat arg validation) and
  // tools/list stay fully answerable — the Sep 15/16 root-cause fix.
  if (process.env.CRATEDECK_OFFLINE === "1") {
    await serveMcp(TOOLS, true);
    return;
  }
  // Refuse to serve if the backend never comes up — but answer initialize
  // first so clients surface a clean error instead of hanging.
  const up = await ensureServer();
  await serveMcp(TOOLS, up);
}

await main();
