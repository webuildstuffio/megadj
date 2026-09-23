import type { CommandDocEntry } from "./command-doc-types";

export const FULLTAGS_COMMAND_DOCS: readonly CommandDocEntry[] = [
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
      "  megadj drop    <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback] [--force-rip] [--json]",
      "                                               one-shot intake: download → ingest → fetch",
      "                                               (tags/genre/art/year/energy/fingerprint/key)",
      "                                               → years → beats → mood → cues → organize",
      "                                               → tag-check → audit — point at a folder,",
      "                                               get finished tracks; SC urls are link-first",
      "                                               (a purchase/free-download link is offered",
      "                                               instead of ripping; sets expand fully)",
    ],
  },
  {
    name: "fetch",
    group: "fulltags",
    block: [
      "  megadj fetch   [--art|--genres|--tags|--years] [--all] [--jobs N] [--json]",
      "                          [--ai-fallback] [--revote] [--dry-run]",
      "                                               enrichment pass: tags+genres+years+art from",
      "                                               SC/Beatport/gateways; AI genre+year only with",
      "                                               --ai-fallback (opt-in — verify years after);",
      "                                               --revote re-runs the genre vote ladder on",
      "                                               rows whose genre predates the vote system",
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
      "  megadj beats   [--limit N] [--jobs N] [--max-seconds S] [--force] [--dry-run] [--json]",
      "                                               beat_this → DB ledger (downbeats for cues/grid checks; no tag writes)",
    ],
  },
  {
    name: "mood",
    group: "fulltags",
    block: [
      "  megadj mood    [--limit N] [--jobs N] [--max-seconds S] [--force] [--dry-run] [--json] [--embeddings]",
      "                                               ONNX mood/dance/VA → DB ledger (syncs TXXX:MOOD stamps; analyzes unstamped;",
      "                                               files >10 min skipped — --max-seconds 0 disables)",
    ],
  },
  {
    name: "catch-up",
    group: "fulltags",
    block: [
      "  megadj catch-up [--limit N] [--jobs N] [--max-seconds S] [--force] [--dry-run] [--json]",
      "                                               ONE analysis gap pass for new imports: beats → mood, ledgered == analyzed",
      "                                               (a fresh library is a fast no-op; --force re-analyzes; parallelism lives here,",
      "                                               not in sync)",
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
      "  megadj genre    [--apply] [--eval] [--refold] [--k N] [--min-agreement F] [--no-duration-guard] [--json]",
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
      "                 [--limit N] [--search greedy|beam] [--genre FAMILY] [--landmark <video_id>…] [--json]",
      "                                                set-builder: propose an ordered mix chain; --search forces the",
      "                                                sequencer (A/B compare), omitted = pool size decides (deep search under 250)",
      "                                               from the beats/mood ledgers + file keys — Camelot-",
      "                                               compatible, ±6% tempo, shaped by an energy-arc preset",
      "                                               (--genre narrows the pool by family substring — house, techno,",
      "                                               tropical house…; --landmark pins must-plays into the chain, repeatable;",
      "                                               unplaceable pins are reported, never silently dropped; --limit adds an",
      "                                               optional cap; propose-only, no tags/playlists written; prints ledger",
      "                                               freshness; empty chain = run `megadj catch-up` first)",
    ],
  },
  {
    name: "megaset-calibrate",
    group: "fulltags",
    block: [
      "  megadj megaset-calibrate [--preset warmup|peak|afterhours] [--minutes N] [--limit N] [--out FILE|-] [--json]",
      "                                                scoring-calibration digest (#306): builds the set over EVERY",
      "                                               preset × strategy (greedy+beam) on the LIVE archive and writes a",
      "                                               dated digest file — run before and after any scoring change and",
      "                                               diff the two (a moved chain= line or changed hop t= value is the",
      "                                               change made visible); --out - streams to stdout; propose-only,",
      "                                               reads the archive DB, writes only the digest file",
    ],
  },
  {
    name: "megaset-cohorts",
    group: "fulltags",
    block: [
      "  megadj megaset-cohorts [--minutes N] [--limit N] [--families LIST] [--json]",
      "                                                cohort builder (#295): warmup + peak chain PER genre family in one",
      "                                               run — default families are the measured big four (edm, house, techno,",
      "                                               tech house); --families narrows (comma-separated ids); blank-genre",
      "                                               tracks are reported outside scope, never guessed; exit 1 when an arm",
      "                                               falls short of the budget (shortfall visible in the summary)",
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
    name: "genre-why",
    group: "fulltags",
    block: [
      "  megadj genre-why <video_id> [--json]         the #173 vote ladder's breakdown for one track:",
      "                                               every rung: genre + weight + elected flag —",
      '                                               "why Techno?" answered from the row, not code',
    ],
  },
  {
    name: "regate",
    group: "fulltags",
    block: [
      "  megadj regate bpm [--detector D] [--gold-dir F] [--json]    re-gate BPM ledger against gold (80% / 2% bar)",
      "  megadj regate genre [--json]                 re-gate genre kNN vs the ≥65% ship gate (LOO harness)",
      "  megadj regate effnet [--json]                reports unavailable until the effnet reference ledger exists",
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
      "  megadj organize [--dry-run] [--json]         sweep loose root files into the dated batch folder (batch intake, never genre)",
    ],
  },
];
