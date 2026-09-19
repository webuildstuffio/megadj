/**
 * usage — the megadj help RENDERER. Lives here (not cli.ts) so the CLI
 * stays under the 800-line file cap. #143: the content is pure data in
 * src/command-registry.ts (COMMAND_DOCS); this file only lays it out —
 * header, group sections in registry order, footer. Byte-identical to
 * the old hand-written string (golden-pinned by usage-golden.test.ts).
 */
import { COMMAND_DOCS, COMMAND_GROUPS, groupHeader } from "./command-registry";

const HEADER =
  "megadj — DJ library manager: acquire (GetDat), enrich (FullTags), drive it (CrateDeck)";

const FOOTER = `  bun run deck                                 the dashboard: every drive, its health, its playlists
  bun run deckctl status | report | run | coverage | diff    agent/human CLI
  bun run mcp                                  same surface over MCP for AI agents

environment:
  MEGADJ_MUSIC_DIR      target folder (default ~/Music/DJ-Imports)
  MEGADJ_DB             state db path (default ~/.local/state/megadj/archive.db)
  MEGADJ_COOKIES        browser for cookies (default chrome, empty to disable)
  MEGADJ_COOKIES_FILE   exported cookie jar for headless runs (see tools/export-cookies.sh)
  MEGADJ_ART_MAX        max AI covers per artwork pass (default 20)
  MEGADJ_ART_QUEUE      artwork queue path (default ~/.local/state/megadj/artwork-queue.jsonl)
  OPENROUTER_API_KEY    required for \`artwork\` + AI genre/year (load from keychain, never hardcode)

agents: every command takes --json (one summary object on stdout, exit code
still meaningful) — PRINCIPLES.md §1.`;

export function printHelp(): void {
  const out: string[] = [HEADER];
  for (const { group } of COMMAND_GROUPS) {
    out.push("");
    out.push(groupHeader(group));
    for (const entry of COMMAND_DOCS) {
      if (entry.group === group) out.push(...entry.block);
    }
  }
  // The cratedeck group renders entirely from COMMAND_DOCS entries
  // (doctor/init) plus FOOTER (deck/deckctl/mcp + environment). Its
  // group header comes last from groupHeader() — FOOTER no longer
  // carries it.
  out.push(FOOTER);
  console.log(out.join("\n"));
}
