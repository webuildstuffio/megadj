// deckctl_search.ts — `deckctl search <query>` (B9 global search from the CLI).
//
// Extracted module (file-length guard): the ⌘K topbar search reaches
// GET /api/search; this is the same read for terminals/agents (F2 closed —
// deckctl + MCP twins of the UI's global search).

import { apiGet } from "./deckapi";

export interface SearchMatch {
  type: "playlist" | "folder";
  name: string;
  entries: unknown[];
}

export interface SearchHit {
  drive_id: string;
  drive_name: string;
  mounted: boolean;
  matches: SearchMatch[];
}

export interface SearchPrintHooks {
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (code: number) => never;
}

/** `deckctl search <query>` — playlists + folders across every snapshot. */
export async function cmdSearch(
  h: SearchPrintHooks,
  query: string,
): Promise<void> {
  const q = query.trim();
  if (!q) {
    h.errOut("usage: deckctl search <query>");
    h.exit(2);
  }
  const res = await apiGet(
    `/api/search?q=${encodeURIComponent(q)}`,
  );
  const hits = (await res.json()) as SearchHit[];
  if (h.jsonMode) {
    console.log(JSON.stringify({ query: q, hits }, null, 2));
    return;
  }
  if (!hits.length) {
    h.log(`no matches for "${q}"`);
    return;
  }
  for (const hit of hits) {
    h.log(
      `${hit.drive_name}${hit.mounted ? "" : " (unmounted)"} — ${hit.matches.length} match${hit.matches.length === 1 ? "" : "es"}`,
    );
    for (const m of hit.matches)
      h.log(`  [${m.type}] ${m.name} (${m.entries.length} entries)`);
  }
}
