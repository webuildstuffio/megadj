---
name: new-music-intake
description: >-
  How to get NEW songs into the DJ library: download (megadj or by hand),
  tag/artwork/dedupe them (megadj ingest does the Picard pass automatically),
  everything-else via ONE command `tools/fetch_all.ts` (tags+genres+artwork:
  SC page at original res → gateways → twins → Deezer → iTunes → AI queue),
  then onto the USB drives. Use when asked to add new music, tag downloads,
  fix ID3 tags or artwork, dedupe downloads, or get tracks ready for
  rekordbox / the XDJ-XZ.
---

# New Music Intake → DJ Library

Pipeline: **tag+dedupe locally (one subfolder per dump!) → `fetch_all` →
USB**. Whatever the source, a track ends up in a dated batch folder under
`~/Music/DJ-Imports/<YYYY-MM-DD dump name>/` — **every ingest run gets its
own subfolder** (named from the source folder + its dump date, e.g.
`2026-09-09 new dump/`), so separate dumps never mix (genre still lives in
the ID3 `genre` tag, not folders; rekordbox filters on it) — tagged,
artworked, registered in megadj's DB. Re-running the same source folder
reuses its batch folder, and re-processing an already-ingested batch is a
safe no-op: Phase C treats a self-match (the existing DB row's `file_path`
IS the file being walked) as "unchanged" — it never quarantines the
archive's own copy (the Sep 10 UI re-run before this guard quarantined 14
live files and left their rows pointing at missing paths; regression-tested
in `src/commands/ingest-selfmatch.test.ts`). The pre-Sep-10 flat layout was
migrated into `2026-09-05 intake/` + `2026-09-09 intake/` (renamed Sep 11
to the standard convention — "batch import" was an early hand-made name
that the slugger would now render as "intake"; DB paths updated to match).

## Step 1 — Scan for downloads (loose files + zips)

```bash
find ~/Downloads -maxdepth 2 -type f \
  \( -iname "*.m4a" -o -iname "*.mp3" -o -iname "*.wav" \
     -o -iname "*.flac" -o -iname "*.aiff" -o -iname "*.zip" \) ! -name "._*"
```

Also peek at `~/Desktop`. DJ edits pile up loose in `~/Downloads` as WAVs
named like `BLAH (DUER Remix) FINAL.wav`; pools ship zips.

**Zip rule:** mp3+wav pairs = same song, take the WAV, copy the mp3's
embedded art onto it (mutagen APIC), let ingest's dedupe quarantine the
mp3. Since Sep 10 2026 this rule is ENFORCED in code: ingest's
fingerprint pass quarantines any same-stem mp3 whose stem matches a
lossless file in the same intake run (the lossless side wins even when
the mp3's nominal bitrate scores higher — regression-tested in
`src/commands/ingest-pair.test.ts`; the Sep 10 "Play Hard" pair slipped
through before this existed).

## Step 2 — megadj ingest (the Picard pass)

```bash
cd /path/to/megadj
bun src/cli.ts ingest ~/Downloads --dry-run   # review the plan
bun src/cli.ts ingest ~/Downloads             # execute
```

**Archive already has WAVs?** `bun src/cli.ts convert` (add `--dry-run` to
preview) sweeps the whole archive: converts every WAV with the safe
converter, runs the artwork ladder on each new AIFF, updates DB paths, and
verifies player compat — one command, idempotent (no WAVs → no-op).

It probes, dedupes (quality rules, `(1)`-dupe detection, **MD5-verified
content twins regardless of filename**, **same-stem mp3↔lossless pairs**,
acoustic fingerprints), losers moved to
`<archive>/.ingest-duplicates/` — a HIDDEN dot-folder at the archive ROOT
(NOT inside the batch folder: people drag batch folders, and a visible
duplicates folder inside one would get re-dragged back in as "new
music"; dot-folders are skipped by every walker and by Finder), merges tags with filename parsing, fills
artist/album from MusicBrainz, infers genre, gates sub-60s clips,
energy-rates, bootleg-aware tags (remixer in version tag, grouping =
genre), copies into `~/Music/DJ-Imports/<YYYY-MM-DD dump name>/` (one
subfolder per dump — `src/commands/intake-folder.ts`), registers in DB.
Content dedupe matters: a mislabeled "[Extended Mix]" that is a
byte-identical copy of the Radio Edit quarantines even though its
title/filename differ (the Back To Friends trap).

**Zips are built in:** every `*.zip` in the folder is extracted, its audio
staged next to it and ingested. The zip is **deleted only after every file
from it landed in the archive or quarantine** — anything skipped/broken
keeps the zip on disk. Sources (loose files too) are **moved, not copied**:
after a successful copy into the archive the original in Downloads is
removed, so nothing duplicates.

**WAVs become AIFF:** rekordbox cannot read art embedded in WAVs, so ingest
**converts every WAV to AIFF on the way in**. AIFF covers show natively in
rekordbox, CDJs and the XDJ-XZ — no `rb_art.py` DB surgery needed for
anything ingested going forward. Legacy WAVs already in the archive are
fixed by **`megadj convert`** (archive-wide wav→aiff: same safe converter,
art ladder on each new AIFF, DB paths follow, player-compat verdicts).
The Sep 10 2026 run converted all 71 legacy WAVs — the archive is now
100% AIFF/MP3.

**Conversion is a BE re-map, never `-c:a copy`:** WAVs are little-endian;
stream-copying LE PCM into ffmpeg's `aiff` muxer emits a malformed
AIFC-style COMM chunk inside a FORM declared plain `AIFF` — strict parsers
(ffprobe: "could not find COMM tag") and booth players reject it. The
converter re-maps to `pcm_s16be`/`pcm_s24be` (identical samples, spec
container), floors 32-bit/float sources to 24-bit, and ffprobe-validates
the output **before** deleting the source WAV. Regression:
`fulltags/test/wav-to-aiff.test.ts`.

**Player-compat gate (Sep 10 2026):** every intake file is checked against
the strictest-fleet floor — XDJ-XZ + CDJ-3000 + CDJ-2000NXS2 + CDJ-2000
(`fulltags/src/player-compat.ts`, enforced in ingest and `megadj audit`).
Hard rejects (left in place, never ingested): 32-bit int/float PCM WAVs
(DAW bounces), ADPCM WAVs, MPEG-2 MP3 rips (16/22.05/24 kHz), no-audio
files. Hi-res warnings (ingest but flagged): 88.2/96 kHz. FLAC/ALAC are
not universal either — the plain CDJ-2000 has no FLAC, the XDJ-XZ no
ALAC. Audio compat ≠ art compat: WAV would play, but its art doesn't
show — that's what the AIFF conversion is for.

## Step 3 — THE one command: `tools/fetch_all.ts`

Everything ingest didn't finish — tags, genres, artwork — in one parallel,
idempotent, ground-truth pass (reads the files, not the DB):

```bash
cd /path/to/megadj
bun tools/fetch_all.ts             # fill everything missing (default)
bun tools/fetch_all.ts --dry-run   # report only
bun tools/fetch_all.ts --all       # + upgrade existing SC art to original res
bun tools/fetch_all.ts --art       # artwork only
bun tools/fetch_all.ts --genres    # genres only
bun tools/fetch_all.ts --tags      # tags only
bun tools/fetch_all.ts --jobs 8    # workers (default 6)
```

Per track it does, skipping whatever is already complete:

1. **tags** — push DB values into the file (album heuristic for pack tracks).
2. **genre** — SoundCloud tag from the same SC search → canonicalized
   (Hip-Hop, EDM, Tech House, …) → OpenRouter classifier fallback
   (`google/gemini-2.5-flash-lite`, confidence ≥ 0.7 gate).
3. **artwork**, in order:
   - **SC search → SC page `og:image` upgraded to `-original` / `-t1080x1080`**
     (the big one: plain t500x500 search hits get replaced by full-res page
     art; one yt-dlp call feeds genre AND permalink AND art).
   - **hypeddit/hyperfollow gateways** (DDG → og:image scrape).
   - **mp3-twin** (same-named mp3's embedded art, for WAVs from pools —
     CHECK THE ZIP FIRST: pool zips ship mp3+wav pairs and the mp3 twin
     often carries the original 2000×2000 cover).
   - **Deezer** cover_xl → **iTunes** 600px.
   - leftovers → `artwork-queue.jsonl` → `megadj artwork` (AI, last resort).
4. **year** — SC upload timestamp of the remix/edit page = the version's
   year (NOT the original song's year) → `megadj years` re-verifies
   every year against the real SC page `display_date` → AI best-estimate
   as the last fallback.

**Year accuracy warning:** OpenRouter flash-lite defaults to "2023" when
asked for a remix year — always verify with `fix_years.ts` (real SC page
dates) before trusting AI years.

**Lesson from a full-archive enrichment pass:** tracks that "can't be
found" usually ARE on SoundCloud under a different name/query — search the
**remixer's name + original title**, look for the
**uploader's pack pages** (edit/mashup/VIP packs often have their own
cover art) and use the pack cover. Never accept
"untraceable" until you've tried the remixer's profile and pack pages.

**Artwork hunt before AI (Sep 10 2026):** when only 1–2 covers are
missing, do NOT jump to `megadj artwork` (spend). The automated SC search
misses hits the manual ladder finds in seconds:

1. `yt-dlp --flat-playlist --print "%(title).70s | %(webpage_url)s |
%(uploader)s" "scsearch5:<remixer> <original title>"` — the ARTIST'S
   OWN upload almost always has real cover art (Sep 10: Stayin' Alive
   edit found on the remixer's profile after SC/Deezer/iTunes all
   "missed").
2. Upgrade the og:image thumb to original res: swap `-t500x500` for
   `-t1080x1080` (then `-original`) in the sndcdn URL — 76 KB thumb →
   336 KB real cover.
3. **Pool gateways**: if the download came from hypeddit/hyperfollow,
   revisit that gateway page in a browser — the release cover is there
   even when DDG's cache misses it. Pool zips may also ship `Cover.jpg`
   next to the audio (embed it directly).
4. Only THEN queue AI (`megadj artwork`). Same rule for unidentified
   "DJ tool" titles: try 4–5 query shapes (remixer+title, title+genre,
   title+bpm, quoted phrases) before concluding anything.

## Step 3b — AI covers: last resort only

Only tracks with **no online presence at all** (checked SC search, remixer
profile, pack pages, gateways) go to the queue:

```bash
bun src/cli.ts artwork --dry-run        # preview prompts, no spend
OPENROUTER_API_KEY=$(security find-generic-password -a $USER -s megadj-openrouter-key -w) \
  bun src/cli.ts artwork --max 10      # bounded batch (≈$0.034/img)
```

Requires `OPENROUTER_API_KEY` (keep it in the keychain:
`security add-generic-password -a $USER -s megadj-openrouter-key -w <key>`
— the repo never hardcodes keys; the command above pulls it from the
keychain into the env for one run).

## Step 4 — Onto the USB drives

- **A few tracks** → drag onto the device in rekordbox; it analyzes and
  writes both DBs on export.
- **A batch** → `usb_sync.py` per the `rekordbox-usb-sync` skill, verify
  with `usb_verify.py`. Hardware gate: export.pdb == OneLibrary counts.

Never hand-edit drive DBs; never let two writers touch a drive at once.

### Onto the shelf master (the archive-grade HDD)

New tracks reach the shelf via `megadj shelf-sync` (archive → shelf,
additive). For stray drives full of unknown music (old sticks, a friend's
library), the intake sweep is the mirror command: `megadj shelf-archive
<volume> [--trashes] [--deep]` — pulls EVERYTHING into the shelf,
additive and MD5-verified, preserving divergent copies as `<name>
[<drive>]` twins instead of overwriting. The Sep 9 2026 three-stick sweep
(BANGERS + BOSEXY + a dead stick) is the worked example in
`docs/usb-sync-log.md`.

## Step 5 — Health checks

```bash
megadj audit                    # ground-truth file audit: art+title+artist+album+genre+year
                                #   + mood+energy + player-compat (booth-playable)
megadj tag-check                # corrupt-ID3 scanner (Sep 11): no-title/artist voids,
                                #   mojibake (booth-text SSOT), control bytes, fleet-text.
                                #   Found a real "Henández"→"Hernández" mojibake title.
megadj fetch --dry-run          # what would still be done
megadj years --dry-run          # verify years against real SC page dates
megadj mood                     # ONNX mood → ledger (Sep 10 regression: flagless runs
                                #   analyzed NOTHING — always confirm `analyzed > 0`
                                #   on a fresh batch, or beats/cues rows go missing)
megadj beats && megadj cues     # downbeats + 8-bar phrase cues → ledgers
```

**Queue order matters: beats → mood → cues.** Cues derive from the beats
ledger, so re-running beats (any re-analysis) STALES every cue for those
tracks — re-derive with `megadj cues --force` after a beats repair. Sep 11
full-archive pass: beats+mood+cues for 8 new rows, then `cues --force`
re-derived all 131 (2043 cues).

**Genre-loss watch on upgrades:** the upgrade re-ingest path re-stamps
tags from filename-only metadata and can CLOBBER SC genres fetched
earlier (7 tracks lost `genre` in the Sep 11 sweep; `fetch --genres`
refilled all 7 in 10s). After ANY upgrade re-ingest, run `megadj audit`
and refill whatever it flags before declaring done.

**Grid coherence (beatgrid QA):** a downbeat array is sane when its
spacings sit on the folded-BPM bar grid (bar = 240/bpm seconds, ±6%,
coherence ≥ 85% of inter-down gaps). Sep 11 census found 21 tracks with
double-fire/mixed-spacing downbeats (transient-happy beat_this on
trap/dubstep flips); they were snap-repaired by keeping downs that land
on the bar grid, then re-deriving cues. Two half-time/double-time
ambiguous tracks remain flagged but their cues are musically usable.
`megadj grid-triage` (ANLZ-sidecar based) is the drive-mounted analogue
— it needs a stick/shelf mounted.

`megadj audit` exits 1 and lists every file with `[missing,fields]` if
anything is incomplete — use it as the final gate after any batch. It reads
tags via mutagen ground truth (the old `final_audit.py`/`tag_audit.ts`
one-offs are retired; `megadj audit` supersedes both).

Ground truth = files, not the DB. Run `megadj audit` after every batch;
it exits 0 only when every track has art, full tags, genre and a
verified year.

### rekordbox WAV artwork (legacy tracks)

rekordbox cannot read art embedded in WAVs — it stores art in its own
library (`share/PIONEER/Artwork/<shard>/<uuid>/` + `ImagePath` in
`djmdContent`). **New ingests don't hit this** (WAVs convert to AIFF at
ingest, covers just work). **Legacy WAVs can be fixed in one pass** via
`tools/rb_art.py` pilot → batch (pilot first, verify in RB, then batch).

Key gotcha learned during the pilot: RB renders covers from the
`artwork_m.jpg` + `artwork_s.jpg` thumbnails — a dir with only
`artwork.jpg` silently shows no art. `ensure_artwork_file` generates all
three via Pillow now. If covers don't render after an ImagePath write,
quit + reopen rekordbox (it caches the old blank state in memory).

`tools/rb_art.py` remains available for any future legacy WAVs
(see `docs/rekordbox-wav-artwork.md` for the full research + options):

```bash
uv run --with "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git" \
    --with mutagen --with Pillow python tools/rb_art.py status
#  dry-run → pilot (3 tracks, verify in RB) → batch (all WAVs)
```

Safety rails enforced: rekordbox closed, master.db+shm+wal backed up,
pilot before batch, idempotent re-runs.

**Why a WAV can "show no tags":** Finder/QuickTime don't display WAV ID3
chunks — ffprobe/mutagen see them fine. Files whose DB row exists but whose
file is "missing" usually live inside rekordbox's Mac collection.

## MusicBrainz Picard, when needed

Only for compilations/albums needing per-track credits, or when ingest's
match is wrong for a whole batch. After Picard, run `megadj adopt`.

## Retired tools (superseded by `fetch_all.ts`, kept in git history)

`art_final.ts`, `pack_art.ts`, `sc_art_direct.ts`, `sc_genres.ts`,
`normalize_genres.ts`, `sync_genres.ts`, `ai_genres.ts` — all their
strategies live inside `fetch_all.ts` now.
