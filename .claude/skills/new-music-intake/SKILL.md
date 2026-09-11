---
name: new-music-intake
description: >-
  THE intake pipeline: point `megadj drop` at a folder (or URL) and it runs
  every automated stage — download → ingest → enrichment (SC/Beatport art,
  genre, year, DJ stamps) → year verification → beats/mood/cues → organize
  → tag-check → audit. Also covers the two MANUAL steps drop deliberately
  does not do: filename pruning/cleanup, and the dated rekordbox import +
  local-DB sync. Use when asked to add new music, tag downloads, fix ID3
  tags or artwork, dedupe downloads, or get tracks into rekordbox / the
  XDJ-XZ.
---

# New Music Intake → DJ Library

One command does the automated work; two manual steps stay human.

```
drop (automated)  ──►  prune + rename (manual)  ──►  rekordbox import (manual, runbook)
```

## Step 0 — Manual prep (before drop, ~2 min)

Skim the folder first — drop trusts filenames as a metadata fallback, so
garbage names propagate:

- Delete obvious junk: duplicates you downloaded twice, `(1)` copies,
  non-audio leftovers, 15-second previews.
- Fix garbage filenames: `track01_final_FINAL.wav` → `Artist - Title
(Remix Name).mp3`. The `(Remix)` suffix matters — ingest derives the
  remixer credit (version/remixer tags) from it.
- Zips: leave them. Drop extracts them and applies the mp3+wav pair rule
  (WAV wins, mp3's art rides along) in code.

Then:

```bash
megadj drop ~/Downloads/my-dump-name --dry-run --json   # review the plan
megadj drop ~/Downloads/my-dump-name                    # run it
```

`drop` accepts a URL too (`megadj drop <soundcloud-or-youtube-url>` —
downloads first via yt-dlp, then the same pipeline).

## What drop runs, in order

| #   | Stage     | What it does                                                                                                                                                                                                                                                                                                     |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | download  | URL only — yt-dlp best-audio into the music dir                                                                                                                                                                                                                                                                  |
| 1   | ingest    | probe, dedupe (MD5 + fingerprint + mp3↔lossless pairs), WAV→AIFF, filename-parse tags, MusicBrainz fill, art ladder, player-compat gate, register + move into `<archive>/<YYYY-MM-DD dump name>/`                                                                                                                |
| 2   | fetch     | SC search → genre + year + original-res art; Beatport → label/mix/remixer/ISRC + store art; gateways → Deezer → iTunes → mp3-twin; energy/fingerprint/key stamps. **AI genre/year is opt-in** (`--ai-fallback`) — SC+BP resolve real releases; the AI fallback has a documented remix-year failure mode ("2023") |
| 3   | years     | verify every year against the real SC page `display_date` (kills AI guesses and stale upload dates)                                                                                                                                                                                                              |
| 4   | beats     | beat_this → BPM + downbeat ledger (DB, never tags)                                                                                                                                                                                                                                                               |
| 5   | mood      | ONNX heads → mood/dance/valence stamp + DB ledger (skipped when models absent or `--no-mood`)                                                                                                                                                                                                                    |
| 6   | cues      | 8-bar phrase cues derived from the beats ledger                                                                                                                                                                                                                                                                  |
| 7   | organize  | file into genre folders; DB paths follow                                                                                                                                                                                                                                                                         |
| 8   | tag-check | structure gate: unreadable containers, mojibake, control bytes, no-title/artist voids                                                                                                                                                                                                                            |
| 9   | audit     | completeness gate: art + title + artist + album + genre + year + mood + energy + player-compat + booth-text. **Runs LAST on purpose** — a green gate certifies the final on-disk state, including the booth-text path check after organize's moves                                                               |

Every stage is idempotent; a re-run costs ~0 for finished tracks. Exit 1 +
per-stage detail on any gap. `--json` prints one summary object (P1).

**After any drop with unresolved genres/years**, the fetch summary reports
`genreUnresolvedNoAi` / `yearUnresolvedNoAi`. That bounded list is what a
one-off `megadj fetch --ai-fallback` re-pass would cover — run it
deliberately, then re-run `megadj years` (never trust an AI year blind).

## Step 1 — Manual pruning/cleanup (after drop)

drop never deletes audio. Walk the batch folder
(`~/Music/DJ-Imports/<date> <name>/`) once:

- Skim for misidentified tracks (wrong MusicBrainz match → fix the tag,
  don't re-ingest).
- Quarantined rejects (dupes, sub-60s clips) live in
  `<archive>/.ingest-duplicates/` — glance, then forget; it's hidden and
  never re-walked.
- `megadj audit --json` is the ground-truth checklist while you prune.

## Step 2 — Into rekordbox (manual, runbook-gated)

drop stops at "archive green". The rekordbox import is deliberately
separate — live DB writes never happen inside an automated pipeline:

1. **Quit rekordbox.** Never write while it runs (live WAL).
2. `megadj shelf-sync` — archive → shelf (additive, MD5-verified).
3. Open rekordbox (it needs the shelf master DB mounted), drag the new
   batch folder from the SHELF volume (`/Volumes/SHELF1/Contents/…`),
   **never from a local folder** — dragging locals registers Mac paths and
   breaks stick parity.
4. Let rekordbox analyze; export to the sticks per the
   `rekordbox-usb-sync` skill (pdb/OneLibrary parity gate).

Full mechanics: `.claude/skills/rekordbox-usb-sync/SKILL.md`.

## Health checks after any intake

```bash
megadj audit        # exit 0 = every track complete + booth-playable
megadj tag-check    # structure/mojibake gate
megadj fetch --dry-run   # what enrichment would still do
megadj years --dry-run   # year verification status
```

## Stray drives (not downloads)

A stick/folder of UNKNOWN music is a different flow:
`megadj shelf-archive <volume> [--trashes] [--deep]` — additive,
junk-filtered, MD5-verified pull into the shelf with divergent copies kept
as `<name> [<volume>]` twins. See the `shelf-intake` skill.

## Historical notes (kept for the traps)

- **Re-running an already-ingested batch is a safe no-op** — "existing row
  IS this file" is a self-match, never a quarantine finding
  (`src/commands/ingest-selfmatch.test.ts`). One subfolder per dump; dumps
  never mix.
- **WAVs convert to AIFF at ingest** (BE re-map, art-capable,
  booth-verified; source deleted only after ffprobe validates the output).
- **The upgrade re-ingest path can clobber SC genres** — after any
  upgrade, run `megadj audit` and refill flagged genres via
  `megadj fetch --genres` (Sep 11 sweep: 7 lost, refilled in 10s).
- **Cues derive from beats** — re-running beats (any re-analysis) STALES
  cues; re-derive with `megadj cues --force` after a beats repair.
- **"Unfindable" tracks usually aren't** — search the remixer's profile
  and pack pages on SC before queueing AI art; the manual og:image→
  `-t1080x1080`→`-original` upgrade beats the AI queue every time.
- AI covers remain a bounded last resort:
  `megadj artwork --dry-run` → `--max 10` (≈$0.034/img,
  `OPENROUTER_API_KEY` from the keychain).
