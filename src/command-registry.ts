/**
 * command-registry.ts — THE megadj CLI help/census SSOT (#143).
 *
 * Help text was a hand-written string in usage.ts that had to be kept in
 * sync with four handler records + the maintenance table by hand — the
 * proven drift class (Sep 10: usage documented `--tag q1` / `--limit 20`
 * space-form flags the parser silently dropped; a stale second
 * rb-comment-sync block documented `--limit N` which the arm never
 * parsed). One data table now OWNS the per-command help blocks;
 * usage.ts renders from it, and the surface-parity census derives the
 * megadj verb set from the registry's `name:` rows (no second hand list).
 *
 * Handlers stay in cli-commands-{core,shelf,tags,analysis}.ts +
 * shared/maintenance-cmds.ts (file caps + dynamic-import discipline);
 * src/shared/maintenance-verbs.test.ts pins MAINTENANCE_VERBS to the
 * dispatch table, and this registry's names are cross-checked against
 * that union by the census tests — two lists, one test-guaranteed set.
 *
 * `block` lines are VERBATIM help bytes (wrapped usage + description).
 * Renderer contract: byte-identical output, --help stdout / exit 0.
 */

export type CommandGroup = "getdat" | "fulltags" | "cratedeck";

export interface CommandDocEntry {
  /** The verb token (census surface — unique per family spellings). */
  name: string;
  group: CommandGroup;
  /** Verbatim help lines for this entry (usage + description). */
  block: string[];
}

export const COMMAND_GROUPS: readonly {
  group: CommandGroup;
  tagline: string;
}[] = [
  { group: "getdat", tagline: "pull every track from everywhere" },
  {
    group: "fulltags",
    tagline: "100% accuracy, 100% coverage, zero manual labour",
  },
  {
    group: "cratedeck",
    tagline: "the Crate: organize, sync & verify every DJ USB",
  },
];

export const COMMAND_DOCS: readonly CommandDocEntry[] = [
  {
    name: "sync",
    group: "getdat",
    block: [
      "  megadj sync    [--limit N] [--dry-run] [--music-only] [--target-total N] [--sources LM,LL,PLxxxx] [--json]",
      "                                               download from YouTube Music; resumable, rate-limited",
    ],
  },
  {
    name: "status",
    group: "getdat",
    block: [
      "  megadj status [--json]                       archive summary + recent runs",
    ],
  },
  {
    name: "list",
    group: "getdat",
    block: [
      "  megadj list    [filter] [--json]             list tracks (by status or text)",
    ],
  },
  {
    name: "adopt",
    group: "getdat",
    block: [
      "  megadj adopt   [--shelf --apply] [--json]     register existing files in the DB;",
      "                                                --shelf repoints rows whose local file",
      "                                                moved to the shelf (dry-run by default)",
    ],
  },
  {
    name: "retry",
    group: "getdat",
    block: [
      "  megadj retry   [--json]                      reset failure counters, then `megadj sync` to retry",
    ],
  },
  {
    name: "ingest",
    group: "fulltags",
    block: [
      "  megadj ingest  <folder> [--dry-run] [--no-artwork] [--min-duration N] [--json]",
      "                                               tag+art+dedupe downloads (zips too)",
    ],
  },
  {
    name: "convert",
    group: "fulltags",
    block: [
      "  megadj convert [--dry-run] [--no-artwork] [--json]",
      "                                               archive-wide wav→aiff: every legacy wav",
      "                                               becomes art-capable, booth-verified aiff",
      "                                               (art ladder + DB paths follow)",
    ],
  },
  {
    name: "drop",
    group: "fulltags",
    block: [
      "  megadj drop    <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback] [--json]",
      "                                               one-shot intake: download → ingest → fetch",
      "                                               (tags/genre/art/year/energy/fingerprint/key)",
      "                                               → years → beats → mood → cues → organize",
      "                                               → tag-check → audit — point at a folder,",
      "                                               get finished tracks; exits 1 on any gap",
    ],
  },
  {
    name: "fetch",
    group: "fulltags",
    block: [
      "  megadj fetch   [--art|--genres|--tags|--years] [--all] [--jobs N] [--json]",
      "                          [--ai-fallback] [--dry-run]",
      "                                               enrichment pass: tags+genres+years+art from",
      "                                               SC/Beatport/gateways; AI genre+year only with",
      "                                               --ai-fallback (opt-in — verify years after)",
    ],
  },
  {
    name: "audit",
    group: "fulltags",
    block: [
      "  megadj audit   [--json]                      ground-truth tag/art audit — exits 1 on any gap",
    ],
  },
  {
    name: "tag-check",
    group: "fulltags",
    block: [
      "  megadj tag-check [--json]                    scan tag structure and booth text health",
    ],
  },
  {
    name: "booth-fix",
    group: "fulltags",
    block: [
      "  megadj booth-fix [--apply --yes] [--dry-run] [--json]",
      "                                               fix what the booth can't read: sanitize emoji/mojibake",
      "                                               tags, rename illegal-char paths (renames follow the DB)",
    ],
  },
  {
    name: "years",
    group: "fulltags",
    block: [
      "  megadj years   [--dry-run] [--json]          verify years vs SC page/yt-dlp (kills AI 2023 guesses)",
    ],
  },
  {
    name: "beats",
    group: "fulltags",
    block: [
      "  megadj beats   [--limit N] [--jobs N] [--force] [--dry-run] [--json]",
      "                                               beat_this → DB ledger (downbeats for cues/grid checks; no tag writes)",
    ],
  },
  {
    name: "mood",
    group: "fulltags",
    block: [
      "  megadj mood    [--limit N] [--jobs N] [--force] [--dry-run] [--json] [--embeddings]",
      "                                               ONNX mood/dance/VA → DB ledger (syncs TXXX:MOOD stamps; analyzes unstamped)",
    ],
  },
  {
    name: "similar",
    group: "fulltags",
    block: [
      "  megadj similar <video_id> [--k N] [--space raw|whitened] [--json]",
      '                                               "sounds like": cosine kNN over the embeddings ledger (read-only);',
      "                                               --space whitened adds mean-centre + all-but-the-top + CSLS (A/B vs raw)",
    ],
  },
  {
    name: "genre",
    group: "fulltags",
    block: [
      "  megadj genre    [--apply] [--eval] [--refold] [--k N] [--min-agreement F] [--json]",
      "                                               infer genres from audio embeddings (kNN vote over trusted seeds); propose-only by default;",
      "                                               --eval runs the leave-one-out accuracy harness (target: gated ≥65%);",
      "                                               --eval extras: --diagnostics (Tier-0 battery), --artist-disjoint (leakage control), --probe (linear readout);",
      "                                               --refold: label canonicalization proposals (with --eval: umbrella arbitration A/B vs baseline);",
      "                                               --flag: demote-and-flag pass — labels contradicting unanimous kNN consensus get genre_flag='disputed' (not rewritten, excluded from seeding);",
      '                                               --disputes: review flagged rows + live evidence; resolve one: --agree <id> (audio wins) / --keep <id> (source wins), [--note "..."]',
    ],
  },
  {
    name: "megaset",
    group: "fulltags",
    block: [
      "  megadj megaset [--preset warmup|peak|afterhours] [--minutes N] [--opener <video_id>]",
      "                 [--limit N] [--search greedy|beam] [--json]",
      "                                                set-builder: propose an ordered mix chain; --search forces the",
      "                                                sequencer (A/B compare), omitted = pool size decides (deep search under 250)",
      "                                               from the beats/mood ledgers + file keys — Camelot-",
      "                                               compatible, ±6% tempo, shaped by an energy-arc preset",
      "                                               (full archive by default; --limit adds an optional cap;",
      "                                               propose-only, no tags/playlists written; prints ledger freshness;",
      "                                               empty chain = run `megadj beats` + `megadj mood` first)",
    ],
  },
  {
    name: "upgrade",
    group: "fulltags",
    block: [
      "  megadj upgrade [--limit N] [--dry-run] [--json]",
      "                                               re-fetch below-floor tracks at best quality (fingerprint-gated swap)",
    ],
  },
  {
    name: "cues",
    group: "fulltags",
    block: [
      "  megadj cues    [--limit N] [--force] [--dry-run] [--json]",
      "                                               8-bar phrase cues from the beats ledger → DB (no player writes)",
    ],
  },
  {
    name: "gold-report",
    group: "fulltags",
    block: [
      "  megadj gold-report [--json]                  score ledgers vs the GA-00 gold set",
      "                                               (anchor/BPM/phrase/cue metrics, dev + holdout)",
      "                                               — exit 1 when no annotations exist yet",
    ],
  },
  {
    name: "regate",
    group: "fulltags",
    block: [
      "  megadj regate bpm [--gold-dir F] [--json]    re-gate BPM ledger against gold (80% / 2% bar)",
      "                                               genre and effnet share the same fulltags harness",
    ],
  },
  {
    name: "artwork",
    group: "fulltags",
    block: [
      "  megadj artwork [--model M] [--max N] [--dry-run] [--json]",
      "                                               generate covers for queued tracks (last resort)",
    ],
  },
  {
    name: "enrich",
    group: "fulltags",
    block: [
      "  megadj enrich  [--dry-run] [--json]          fill weak genres via MusicBrainz",
    ],
  },
  {
    name: "organize",
    group: "fulltags",
    block: [
      "  megadj organize [--dry-run] [--json]         move downloaded files into genre folders",
    ],
  },
  {
    name: "shelf-sync",
    group: "fulltags",
    block: [
      "  megadj shelf-sync [--dry-run] [--json]       copy archive music onto the shelf master",
      "                                               (+ mounted sticks) — additive, resumable",
    ],
  },
  {
    name: "shelf-archive",
    group: "fulltags",
    block: [
      "  megadj shelf-archive [volume ...] [--into F] [--trashes] [--deep] [--json]",
      "                                               pull everything from drive(s) INTO the",
      "                                               shelf — additive, junk-filtered, MD5-verified,",
      "                                               divergent copies preserved (never overwritten)",
    ],
  },
  {
    name: "shelf-sweeps",
    group: "fulltags",
    block: [
      "  megadj shelf-sweeps [--json]                 DB ledger: every drive→shelf sweep, its",
      "                                               verdict and counters (latest per drive)",
    ],
  },
  {
    name: "shelf-dedupe",
    group: "fulltags",
    block: [
      "  megadj shelf-dedupe [--apply --yes] [--json] resolve [drive] twins: MD5 + fingerprint,",
      "                                               report first; --apply moves losers to",
      "                                               quarantine on the shelf (never deletes)",
    ],
  },
  {
    name: "shelf-dupescan",
    group: "fulltags",
    block: [
      "  megadj shelf-dupescan [--json]               fingerprint EVERY shelf audio file; group",
      "                                               identical recordings regardless of filename",
      "                                               or folder (cross-folder duplicate hunt)",
      "                                               [--quarantine --yes] moves group losers to",
      "                                               the shelf quarantine (never deletes)",
      "                                               [--only-identical] restricts quarantine to",
      "                                               byte-verified md5-equal copies",
    ],
  },
  {
    name: "dedupe-archive",
    group: "fulltags",
    block: [
      "  megadj dedupe-archive [--apply --yes] [--json]",
      "                                               same fingerprint pass, over the DJ-Imports",
      "                                               archive: cross-batch duplicate hunt",
      "                                               (--apply moves losers to the archive",
      "                                               quarantine, never deletes)",
    ],
  },
  {
    name: "shelf-hygiene",
    group: "fulltags",
    block: [
      "  megadj shelf-hygiene [--json]                the hygiene sweep: byte/fp/junk checks →",
      "                                               findings ledger (--json = census);",
      "                                               [--confirm ID | --dismiss ID] decide one;",
      "                                               [--bucket NAME] batch-confirm one SAFE",
      "                                               acoustic subcategory (metadata-diff |",
      "                                               re-encode | safe-batch) — quality-diff,",
      "                                               oddball, ear-check are listen-first and",
      "                                               refuse batch-confirm (A/B compare them",
      "                                               in the Hygiene tab);",
      "                                               [--apply --yes] executes CONFIRMED losers",
      "                                               into the shelf quarantine (never deletes)",
    ],
  },
  {
    name: "shelf-restore",
    group: "fulltags",
    block: [
      "  megadj shelf-restore <finding-id|path> [--into F] [--json]",
      "                                               restore an applied ledger-owned quarantine",
      "                                               source; MD5-verified, never overwrites",
    ],
  },
  {
    name: "rb-fix-paths",
    group: "fulltags",
    block: [
      "  megadj rb-fix-paths [drive] [--apply --yes] [--json]",
      "                                               repair stale rekordbox paths after folder",
      "                                               moves/merges: dry-run reports broken rows",
      "                                               and fixes (dry first, ALWAYS); --apply",
      "                                               backs the DB up, refuses while rekordbox",
      "                                               runs, rewrites, then re-checks EVERY row",
    ],
  },
  {
    name: "rb-unmatched",
    group: "fulltags",
    block: [
      "  megadj rb-unmatched [drive] [--ext E] [--json]",
      "                                               the disk→DB reconcile half: audio files NO",
      "                                               rekordbox row points at (import backlog).",
      "                                               Census classifies matched / twin-named",
      "                                               (dupescan's queue) / unknown; exit 1 while",
      "                                               unknown > 0 (dry first, ALWAYS);",
      "                                                [--quarantine --yes] moves ONLY unknown",
      "                                               files to the shelf quarantine (never",
      "                                               deletes; dated manifest beside them)",
    ],
  },
  {
    name: "rb-adopt",
    group: "fulltags",
    block: [
      "  megadj rb-adopt [drive] [--apply --yes] [--json]",
      "                                               mirror EVERY Rekordbox Content row into",
      "                                               archive.db with an exact Content-ID",
      "                                               cross-reference and full metadata JSON;",
      "                                               preserves YouTube/source IDs, dedupes one",
      "                                               physical file, backs archive.db up, and",
      "                                               verifies the complete census (dry first)",
    ],
  },
  {
    name: "rb-import",
    group: "fulltags",
    block: [
      "  megadj rb-import [drive] <folder> [--playlist NAME] [--group NAME]",
      "                                               [--apply --yes] [--json]",
      "                                               the sanctioned headless master-DB",
      "                                               import: one playlist per intake",
      "                                               folder (nested under --group),",
      "                                               DjmdContent rows for every audio",
      "                                               file, dated DB backup, refuses",
      "                                               while rekordbox runs, whole-table",
      "                                               verify after write (dry first,",
      "                                               ALWAYS)",
    ],
  },
  {
    name: "rb-cues",
    group: "fulltags",
    block: [
      "  megadj rb-cues [drive] [--restamp] [--apply --yes] [--json]",
      "                                               THE djmdCue write seam (postmortem",
      "                                               F1/F3): dry-run counts only Sep 12",
      "                                               incident rows matching the proven",
      "                                               broken-hot-cue signature; --apply --yes",
      "                                               re-stamps those rows Kind=1 (hot),",
      "                                               preserving legitimate Kind=0 memory cues;",
      "                                               dated backup + re-read verify,",
      "                                               refuses while rekordbox runs",
    ],
  },
  {
    name: "rb-dedup",
    group: "fulltags",
    block: [
      "  megadj rb-dedup [drive] [--apply --yes] [--json]",
      "                                               fingerprint-ish duplicate sweep over",
      "                                               the master DB (postmortem F2/BUG-2):",
      "                                               finds same-title ±2s / same-path twin",
      "                                               rows, keeps the Contents/ canonical,",
      "                                               deletes loser rows + quarantines loser",
      "                                               files with a receipt (never deletes);",
      "                                               report default, dry first",
    ],
  },
  {
    name: "rb-comment-sync",
    group: "fulltags",
    block: [
      "  megadj rb-comment-sync [drive] [--batch TOKEN] [--apply --yes] [--json]",
      "                                               backfill rekordbox Comment from",
      "                                               the tags already on the files",
      "                                               (TXXX CAMELOT/ENERGY/MOOD) +",
      "                                               archive.db mood ledger, in the",
      "                                               FullTags Key-E-Moods format;",
      "                                               never clobbers non-empty comments",
      "                                               (dry first)",
    ],
  },
  {
    name: "rb-playlist",
    group: "fulltags",
    block: [
      "  megadj rb-playlist [drive] reconcile [--apply --yes] [--json]",
      "                                               XML-twin healer (F7): find",
      "                                               djmdPlaylist rows missing their",
      "                                               masterPlaylists6.xml NODE (RB7",
      "                                               stores Ids as HEX — decimal",
      "                                               matches lie); apply adds the",
      "                                               missing NODEs with backups",
      "                                               (dry first)",
    ],
  },
  {
    name: "rb-playlist",
    group: "fulltags",
    block: [
      "  megadj rb-playlist [drive] [--preset P] [--minutes N] [--opener ID]",
      "                                               [--playlist NAME] [--group NAME]",
      "                                               [--apply --yes] [--json]",
      "                                               set-builder chain → playlist in",
      "                                               the shelf master DB (no new",
      "                                               content rows — links existing",
      "                                               ones by filename; dry first,",
      "                                               same gates as rb-import)",
    ],
  },
  {
    name: "rb-grid-triage",
    group: "fulltags",
    block: [
      "  megadj rb-grid-triage [drive] [--compare D] [--limit N] [--json]",
      "                                               grid audit vs the ANLZ rekordbox wrote:",
      "                                               byte-compare vs a stick (--compare = SYNC",
      "                                               issues → re-export) then decode the PQTZ",
      "                                               grid + audit the ledger (SHIFT/PHASE/",
      "                                               TEMPO/DRIFT/CHAOS) — read-only",
    ],
  },
  {
    name: "rb-anlz-spike",
    group: "fulltags",
    block: [
      "  megadj rb-anlz-spike [drive] snapshot|compare --tag T [--json]",
      "                                               GA-07 write-path spike harness: hash +",
      "                                               inventory sidecars before/after a manual",
      "                                               rekordbox experiment (re-export, grid",
      "                                               nudge) — proves exactly what changes",
    ],
  },
  // cratedeck family — doctor/init are real dispatch verbs
  // (cli-commands-core.ts) that used to hide their help lines inside the
  // hand-written footer; the registry owns them like every other command.
  // deck/deckctl/mcp are not megadj verbs (bun-run entry points) and
  // stay in usage.ts's FOOTER.
  {
    name: "doctor",
    group: "cratedeck",
    block: [
      "  megadj doctor  [--json]                      one-shot dependency/env/config diagnostics (exit 1 if broken)",
    ],
  },
  {
    name: "init",
    group: "cratedeck",
    block: [
      "  megadj init                                  first-run bootstrap: scaffold config.toml + doctor",
    ],
  },
];

/** Group tagline line (verbatim, for the renderer). */
export function groupHeader(group: CommandGroup): string {
  const meta = COMMAND_GROUPS.find((g) => g.group === group);
  if (!meta) throw new Error(`unknown command group: ${group}`);
  return `${meta.group} — ${meta.tagline}:`;
}
