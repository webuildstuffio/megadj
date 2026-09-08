// deckctl_docs.ts — the KIND_DOCS SSOT behind `deckctl explain [kind]`,
// extracted from deckctl.ts (file-length guard).
//
// "Explain a job" is rendered by TWO verbs — `explain` and (for job
// entries) `help` — so the docs table and its pretty-printer live here,
// shared via plain function exports instead of print hooks.

/** One job-kind doc: what it does, how long, how safe, what it needs. */
export interface KindDoc {
  what: string;
  checks?: string[];
  typical: string;
  safe: string;
  needs: string;
}

export const KIND_DOCS: Record<string, KindDoc> = {
  scan: {
    what: "Inventory the drive. Walks every file (light) and reads the rekordbox device DB (full: tracks, playlists, beatgrid coverage, genres/BPM/artwork stats, free space).",
    typical: "10–60s (scales with library size)",
    safe: "Read-only. Always safe.",
    needs: "drive mounted",
  },
  mirror: {
    what: "Copy master → mirror so both USB drives are identical (files + both databases + ANLZ). Skips files that already match.",
    typical: "minutes–1h+ depending on how much changed",
    safe: "Writes ONLY to the mirror drive. Master is never written. rekordbox must be closed.",
    needs: "both drives mounted, rekordbox NOT running",
  },
  benchmark: {
    what: "Measure real read speed: sequential (big files) + random 4k. CDJ hardware needs sustained ≥30 MB/s or tracks stutter.",
    typical: "~10–30s",
    safe: "Read-only. Safe anytime.",
    needs: "drive mounted",
  },
  checksum: {
    what: "Hash every audio file into a corruption ledger. Later runs re-hash only files whose size/mtime changed and report any file whose CONTENT changed silently — that's bitrot/failing flash.",
    typical: "first run ~1–5 min (hashes everything); later runs seconds–1 min",
    safe: "Read-only (writes one small ledger DB on the host, never on the drive).",
    needs: "drive mounted",
  },
};

/** One KIND_DOCS entry as CLI prose (shared by the all-kinds + single-kind
 *  paths in `explain`, and by `help <kind>` via deckctl_help.ts). */
export function printKindDoc(
  kind: string,
  d: KindDoc,
  log: (s: string) => void,
): void {
  log(`── ${kind} ──`);
  log(d.what);
  if (d.checks) {
    log("");
    log("checks:");
    for (const c of d.checks) log(`  • ${c}`);
  }
  log("");
  log(`typical time: ${d.typical}`);
  log(`safety: ${d.safe}`);
  log(`requires: ${d.needs}`);
  log("");
}
