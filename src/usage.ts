/**
 * usage — the megadj help text. Lives here (not cli.ts) so the CLI stays
 * under the 800-line file cap; the help content is pure data.
 */
export function printHelp(): void {
  console.log(`megadj — DJ library manager: acquire (GetDat), enrich (FullTags), drive it (CrateDeck)

getdat — pull every track from everywhere:
  megadj sync    [--limit N] [--dry-run] [--music-only] [--target-total N] [--sources LM,LL,PLxxxx] [--json]
                                               download from YouTube Music; resumable, rate-limited
  megadj status [--json]                       archive summary + recent runs
  megadj list    [filter] [--json]             list tracks (by status or text)
  megadj adopt   [--json]                      register existing files in the DB
  megadj retry   [--json]                      reset failure counters, then \`megadj sync\` to retry

fulltags — 100% accuracy, 100% coverage, zero manual labour:
  megadj ingest  <folder> [--dry-run] [--no-artwork] [--min-duration N] [--json]
                                               tag+art+dedupe downloads (zips too)
  megadj convert [--dry-run] [--no-artwork] [--json]
                                               archive-wide wav→aiff: every legacy wav
                                               becomes art-capable, booth-verified aiff
                                               (art ladder + DB paths follow)
  megadj drop    <folder-or-url> [--dry-run] [--no-mood] [--json]
                                               one-shot pipeline: download → ingest → beats → mood → cues → organize
  megadj fetch   [--art|--genres|--tags|--years] [--all] [--jobs N] [--dry-run] [--json]
                                               enrichment pass: tags+genres+years+art
  megadj audit   [--json]                      ground-truth tag/art audit — exits 1 on any gap
  megadj booth-fix [--apply --yes] [--dry-run] [--json]
                                               fix what the booth can't read: sanitize emoji/mojibake
                                               tags, rename illegal-char paths (renames follow the DB)
  megadj years   [--dry-run] [--json]          verify years vs SC page/yt-dlp (kills AI 2023 guesses)
  megadj beats   [--limit N] [--jobs N] [--force] [--dry-run] [--json]
                                               beat_this → DB ledger (downbeats for cues/grid checks; no tag writes)
  megadj mood    [--limit N] [--jobs N] [--force] [--dry-run] [--json] [--embeddings]
                                               ONNX mood/dance/VA → DB ledger (syncs TXXX:MOOD stamps; analyzes unstamped)
  megadj similar <video_id> [--k N] [--json]   "sounds like": cosine kNN over the embeddings ledger (read-only)
  megadj upgrade [--limit N] [--dry-run] [--json]
                                               re-fetch below-floor tracks at best quality (fingerprint-gated swap)
  megadj cues    [--limit N] [--force] [--dry-run] [--json]
                                               8-bar phrase cues from the beats ledger → DB (no player writes)
  megadj artwork [--model M] [--max N] [--dry-run] [--json]
                                               generate covers for queued tracks (last resort)
  megadj enrich  [--dry-run] [--json]          fill weak genres via MusicBrainz
  megadj organize [--dry-run] [--json]         move downloaded files into genre folders
  megadj shelf-sync [--dry-run] [--json]       copy archive music onto the shelf master
                                               (+ mounted sticks) — additive, resumable
  megadj shelf-archive [volume ...] [--into F] [--trashes] [--deep] [--json]
                                               pull everything from drive(s) INTO the
                                               shelf — additive, junk-filtered, MD5-verified,
                                               divergent copies preserved (never overwritten)
  megadj shelf-sweeps [--json]                 DB ledger: every drive→shelf sweep, its
                                               verdict and counters (latest per drive)
  megadj shelf-dedupe [--apply --yes] [--json] resolve [drive] twins: MD5 + fingerprint,
                                               report first; --apply moves losers to
                                               quarantine on the shelf (never deletes)
  megadj shelf-dupescan [--json]               fingerprint EVERY shelf audio file; group
                                               identical recordings regardless of filename
                                               or folder (cross-folder duplicate hunt)
                                               [--quarantine --yes] moves group losers to
                                               the shelf quarantine (never deletes)
                                               [--only-identical] restricts quarantine to
                                               byte-verified md5-equal copies
  megadj dedupe-archive [--apply --yes] [--json]
                                               same fingerprint pass, over the DJ-Imports
                                               archive: cross-batch duplicate hunt
                                               (--apply moves losers to the archive
                                               quarantine, never deletes)
  megadj shelf-hygiene [--json]                the hygiene sweep: byte/fp/junk checks →
                                               findings ledger (--json = census);
                                               [--confirm ID | --dismiss ID] decide one;
                                               [--apply --yes] executes CONFIRMED losers
                                               into the shelf quarantine (never deletes)
  megadj rb-fix-paths [drive] [--apply --yes] [--json]
                                               repair stale rekordbox paths after folder
                                               moves/merges: dry-run reports broken rows
                                               and fixes (dry first, ALWAYS); --apply
                                               backs the DB up, refuses while rekordbox
                                               runs, rewrites, then re-checks EVERY row

cratedeck — the Crate: organize, sync & verify every DJ USB:
  megadj doctor  [--json]                      one-shot dependency/env/config diagnostics (exit 1 if broken)
  megadj init                                  first-run bootstrap: scaffold config.toml + doctor
  bun run deck                                 the dashboard: every drive, its health, its playlists
  bun run deckctl status | report | run | coverage | diff    agent/human CLI
  bun run mcp                                  same surface over MCP for AI agents

environment:
  MEGADJ_MUSIC_DIR      target folder (default ~/Music/DJ-Imports)
  MEGADJ_DB             state db path (default ~/.local/state/megadj/archive.db)
  MEGADJ_COOKIES        browser for cookies (default chrome, empty to disable)
  MEGADJ_COOKIES_FILE   exported cookie jar for headless runs (see scripts/export-cookies.sh)
  MEGADJ_ART_MAX        max AI covers per artwork pass (default 20)
  MEGADJ_ART_QUEUE      artwork queue path (default ~/.local/state/megadj/artwork-queue.jsonl)
  OPENROUTER_API_KEY    required for \`artwork\` + AI genre/year (load from keychain, never hardcode)

agents: every command takes --json (one summary object on stdout, exit code
still meaningful) — PRINCIPLES.md §1.`);
}
