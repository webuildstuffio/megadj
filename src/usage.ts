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
  megadj adopt   [--shelf --apply] [--json]     register existing files in the DB;
                                                --shelf repoints rows whose local file
                                                moved to the shelf (dry-run by default)
  megadj retry   [--json]                      reset failure counters, then \`megadj sync\` to retry

fulltags — 100% accuracy, 100% coverage, zero manual labour:
  megadj ingest  <folder> [--dry-run] [--no-artwork] [--min-duration N] [--json]
                                               tag+art+dedupe downloads (zips too)
  megadj convert [--dry-run] [--no-artwork] [--json]
                                               archive-wide wav→aiff: every legacy wav
                                               becomes art-capable, booth-verified aiff
                                               (art ladder + DB paths follow)
  megadj drop    <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback] [--json]
                                               one-shot intake: download → ingest → fetch
                                               (tags/genre/art/year/energy/fingerprint/key)
                                               → years → beats → mood → cues → organize
                                               → tag-check → audit — point at a folder,
                                               get finished tracks; exits 1 on any gap
  megadj fetch   [--art|--genres|--tags|--years] [--all] [--jobs N] [--json]
                          [--ai-fallback] [--dry-run]
                                               enrichment pass: tags+genres+years+art from
                                               SC/Beatport/gateways; AI genre+year only with
                                               --ai-fallback (opt-in — verify years after)
  megadj audit   [--json]                      ground-truth tag/art audit — exits 1 on any gap
  megadj tag-check [--json]                    scan tag structure and booth text health
  megadj booth-fix [--apply --yes] [--dry-run] [--json]
                                               fix what the booth can't read: sanitize emoji/mojibake
                                               tags, rename illegal-char paths (renames follow the DB)
  megadj years   [--dry-run] [--json]          verify years vs SC page/yt-dlp (kills AI 2023 guesses)
  megadj beats   [--limit N] [--jobs N] [--force] [--dry-run] [--json]
                                               beat_this → DB ledger (downbeats for cues/grid checks; no tag writes)
  megadj mood    [--limit N] [--jobs N] [--force] [--dry-run] [--json] [--embeddings]
                                               ONNX mood/dance/VA → DB ledger (syncs TXXX:MOOD stamps; analyzes unstamped)
  megadj similar <video_id> [--k N] [--space raw|whitened] [--json]
                                               "sounds like": cosine kNN over the embeddings ledger (read-only);
                                               --space whitened adds mean-centre + all-but-the-top + CSLS (A/B vs raw)
  megadj genre    [--apply] [--eval] [--refold] [--k N] [--min-agreement F] [--json]
                                               infer genres from audio embeddings (kNN vote over trusted seeds); propose-only by default;
                                               --eval runs the leave-one-out accuracy harness (target: gated ≥65%);
                                               --eval extras: --diagnostics (Tier-0 battery), --artist-disjoint (leakage control), --probe (linear readout);
                                               --refold: label canonicalization proposals (with --eval: umbrella arbitration A/B vs baseline);
                                               --flag: demote-and-flag pass — labels contradicting unanimous kNN consensus get genre_flag='disputed' (not rewritten, excluded from seeding)
  megadj megaset [--preset warmup|peak|afterhours] [--minutes N] [--opener <video_id>]
                 [--limit N] [--search greedy|beam] [--json]
                                                set-builder: propose an ordered mix chain; --search forces the
                                                sequencer (A/B compare), omitted = pool size decides (deep search under 250)
                                               from the beats/mood ledgers + file keys — Camelot-
                                               compatible, ±6% tempo, shaped by an energy-arc preset
                                               (full archive by default; --limit adds an optional cap;
                                               propose-only, no tags/playlists written; prints ledger freshness;
                                               empty chain = run \`megadj beats\` + \`megadj mood\` first)
  megadj upgrade [--limit N] [--dry-run] [--json]
                                               re-fetch below-floor tracks at best quality (fingerprint-gated swap)
  megadj cues    [--limit N] [--force] [--dry-run] [--json]
                                               8-bar phrase cues from the beats ledger → DB (no player writes)
  megadj gold-report [--json]                  score ledgers vs the GA-00 gold set
                                               (anchor/BPM/phrase/cue metrics, dev + holdout)
                                               — exit 1 when no annotations exist yet
  megadj regate bpm [--gold-dir F] [--json]    re-gate BPM ledger against gold (80% / 2% bar)
                                               genre and effnet share the same fulltags harness
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
                                               [--bucket NAME] batch-confirm one SAFE
                                               acoustic subcategory (metadata-diff |
                                               re-encode | safe-batch) — quality-diff,
                                               oddball, ear-check are listen-first and
                                               refuse batch-confirm (A/B compare them
                                               in the Hygiene tab);
                                               [--apply --yes] executes CONFIRMED losers
                                               into the shelf quarantine (never deletes)
  megadj shelf-restore <finding-id|path> [--into F] [--json]
                                               restore an applied ledger-owned quarantine
                                               source; MD5-verified, never overwrites
  megadj rb-fix-paths [drive] [--apply --yes] [--json]
                                               repair stale rekordbox paths after folder
                                               moves/merges: dry-run reports broken rows
                                               and fixes (dry first, ALWAYS); --apply
                                               backs the DB up, refuses while rekordbox
                                               runs, rewrites, then re-checks EVERY row
  megadj rb-unmatched [drive] [--ext E] [--json]
                                               the disk→DB reconcile half: audio files NO
                                               rekordbox row points at (import backlog).
                                               Census classifies matched / twin-named
                                               (dupescan's queue) / unknown; exit 1 while
                                               unknown > 0 (dry first, ALWAYS);
                                                [--quarantine --yes] moves ONLY unknown
                                               files to the shelf quarantine (never
                                               deletes; dated manifest beside them)
  megadj rb-adopt [drive] [--apply --yes] [--json]
                                               mirror EVERY Rekordbox Content row into
                                               archive.db with an exact Content-ID
                                               cross-reference and full metadata JSON;
                                               preserves YouTube/source IDs, dedupes one
                                               physical file, backs archive.db up, and
                                               verifies the complete census (dry first)
  megadj rb-import [drive] <folder> [--playlist NAME] [--group NAME]
                                               [--apply --yes] [--json]
                                               the sanctioned headless master-DB
                                               import: one playlist per intake
                                               folder (nested under --group),
                                               DjmdContent rows for every audio
                                               file, dated DB backup, refuses
                                               while rekordbox runs, whole-table
                                               verify after write (dry first,
                                               ALWAYS)
  megadj rb-cues [drive] [--restamp] [--apply --yes] [--json]
                                               THE djmdCue write seam (postmortem
                                               F1/F3): dry-run counts only Sep 12
                                               incident rows matching the proven
                                               broken-hot-cue signature; --apply --yes
                                               re-stamps those rows Kind=1 (hot),
                                               preserving legitimate Kind=0 memory cues;
                                               dated backup + re-read verify,
                                               refuses while rekordbox runs
  megadj rb-dedup [drive] [--apply --yes] [--json]
                                               fingerprint-ish duplicate sweep over
                                               the master DB (postmortem F2/BUG-2):
                                               finds same-title ±2s / same-path twin
                                               rows, keeps the Contents/ canonical,
                                               deletes loser rows + quarantines loser
                                               files with a receipt (never deletes);
                                               report default, dry first
  megadj rb-comment-sync [drive] [--batch TOKEN] [--apply --yes] [--json]
                                               backfill rekordbox Comment from
                                               the tags already on the files
                                               (TXXX CAMELOT/ENERGY/MOOD) +
                                               archive.db mood ledger, in the
                                               FullTags Key-E-Moods format;
                                               never clobbers non-empty comments
                                               (dry first)
  megadj rb-playlist [drive] reconcile [--apply --yes] [--json]
                                               XML-twin healer (F7): find
                                               djmdPlaylist rows missing their
                                               masterPlaylists6.xml NODE (RB7
                                               stores Ids as HEX — decimal
                                               matches lie); apply adds the
                                               missing NODEs with backups
                                               (dry first)
  megadj rb-playlist [drive] [--preset P] [--minutes N] [--opener ID]
                                               [--playlist NAME] [--group NAME]
                                               [--apply --yes] [--json]
                                               set-builder chain → playlist in
                                               the shelf master DB (no new
                                               content rows — links existing
                                               ones by filename; dry first,
                                               same gates as rb-import)
  megadj rb-comment-sync [drive] [--limit N] [--apply --yes] [--json]
                                               backfill the rekordbox Comment
                                               column from FullTags tag data
                                               (TXXX Camelot/Energy/Mood, ledger
                                               fallback): only EMPTY comments
                                               (never clobbers), dated backup +
                                               re-read verify, refuses while
                                               rekordbox runs (dry first)
  megadj rb-grid-triage [drive] [--compare D] [--limit N] [--json]
                                               grid audit vs the ANLZ rekordbox wrote:
                                               byte-compare vs a stick (--compare = SYNC
                                               issues → re-export) then decode the PQTZ
                                               grid + audit the ledger (SHIFT/PHASE/
                                               TEMPO/DRIFT/CHAOS) — read-only
  megadj rb-anlz-spike [drive] snapshot|compare --tag T [--json]
                                               GA-07 write-path spike harness: hash +
                                               inventory sidecars before/after a manual
                                               rekordbox experiment (re-export, grid
                                               nudge) — proves exactly what changes

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
