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
  "hygiene-scan": {
    what: "Shelf hygiene detection: walks the shelf master and runs the byte-twin / acoustic-twin / folder-variant / zero-byte / junk checks, writing every finding into the findings ledger (docs/shelf-hygiene-2026-09-09.md).",
    typical: "1–10 min (fingerprinting dominates; cached between runs)",
    safe: "Read-only + ledger writes on the host. Nothing on the shelf moves.",
    needs: "shelf drive mounted",
  },
  "hygiene-apply": {
    what: "Executes CONFIRMED hygiene findings: re-verifies every loser (md5 at apply time, stale-walk abort) and moves it into the shelf quarantine — never deletes. Validation receipts land on each applied row.",
    typical: "seconds–minutes (moves are same-volume renames)",
    safe: "Quarantine-only and reversible; unconfirmed findings are never touched.",
    needs: "shelf drive mounted; confirmed findings in the ledger",
  },
  "fixes-scan": {
    what: "Booth compatibility dry run: megadj booth-fix over the shelf Contents against the selected fleet (deckctl booth) — filenames the players can't carry, tags they can't display, audio they can't play. Produces the fix plan without touching anything.",
    typical: "5–12 min (reads every file's tags)",
    safe: "Read-only — a dry run. Nothing is renamed or rewritten until you apply.",
    needs: "shelf drive mounted",
  },
  "fixes-apply": {
    what: "Executes the SAFE subset of the booth fix plan: filename renames (DB path follows) + tag rewrites to fleet-safe text. Proposal-only rows (float WAVs, intentional scripts) are never auto-executed.",
    typical: "minutes (a rescan follows to prove what's left)",
    safe: "Renames + tag writes only, nothing deletes. Renames need one rekordbox pass: Collection → ⌘A → Relocate Lost Files, then re-sync sticks.",
    needs: "shelf drive mounted; a completed fixes-scan plan",
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
  speedtest: {
    what: "Minimal link-class probe: reads ~10MB from the drive's biggest file and reports sequential MB/s — cheap enough to run on demand from the banner to confirm a suspected USB 2.0 vs 3.0 link. For the full sequential + random-4k picture use `benchmark`.",
    typical: "under a second",
    safe: "Read-only (a few MB). No interlock needed.",
    needs: "drive mounted",
  },
  ingest: {
    what: "The GetDat intake pipeline as a job (the Intake tab's engine): runs megadj ingest over a watch/batch folder — tag+art+dedupe downloads, MusicBrainz fill — then the post-run audit verdict.",
    typical: "minutes (scales with batch size)",
    safe: "Writes into the archive (music dir + DB). Batch folders land in their own fresh subfolder; zips expand only when fully ingested.",
    needs: "archive reachable; a batch/watch folder",
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
