// mcp_surfaces.ts — the capability names shared by deckctl and MCP.
//
// Keep this deliberately data-only: handlers, schemas, and transport belong
// to their owning surface modules.  A capability's CLI verb and MCP name are
// declared exactly once here, which makes a missing twin impossible to hide
// behind two hand-maintained lists.

export const DECK_MCP_SURFACES = [
  { verb: "status", tool: "deck_status" },
  { verb: "drives", tool: "deck_drives" },
  { verb: "report", tool: "deck_report" },
  { verb: "coverage", tool: "deck_coverage" },
  { verb: "redundancy", tool: "deck_redundancy" },
  { verb: "diff", tool: "deck_diff" },
  { verb: "jobs", tool: "deck_jobs" },
  { verb: "run", tool: "deck_run" },
  { verb: "cancel", tool: "deck_cancel" },
  { verb: "hygiene", tool: "deck_hygiene" },
  { verb: "fixes", tool: "deck_fixes" },
  { verb: "explain", tool: "deck_explain" },
  { verb: "preflight", tool: "deck_preflight" },
  { verb: "players", tool: "deck_players" },
  { verb: "booth", tool: "deck_booth" },
  { verb: "note", tool: "deck_note" },
  { verb: "rename", tool: "deck_rename" },
  { verb: "notes", tool: "deck_notes" },
  { verb: "prep", tool: "deck_prep" },
  { verb: "search", tool: "deck_search" },
  { verb: "help", tool: "deck_help" },
  { verb: "dismiss", tool: "deck_dismiss" },
] as const;

export type DeckMcpVerb = (typeof DECK_MCP_SURFACES)[number]["verb"];
export type DeckMcpTool = (typeof DECK_MCP_SURFACES)[number]["tool"];

/** Build the MCP registry names from the canonical CLI/MCP capability map.
 * The caller supplies implementations keyed by CLI verb, so it cannot
 * independently retype a `deck_*` tool id. */
export function deriveDeckTools<T>(
  handlers: Record<DeckMcpVerb, T>,
): Record<DeckMcpTool, T> {
  return Object.fromEntries(
    DECK_MCP_SURFACES.map(({ verb, tool }) => [tool, handlers[verb]]),
  ) as Record<DeckMcpTool, T>;
}
