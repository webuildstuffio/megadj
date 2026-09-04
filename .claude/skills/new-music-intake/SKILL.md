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

Pipeline: **tag+dedupe locally (flat!) → `fetch_all` → USB**. Whatever the
source, a track ends up in `~/Music/DJ-Imports` — **one flat folder, no genre
subfolders** (genre lives in the ID3 `genre` tag; rekordbox filters on it) —
tagged, artworked, registered in megadj's DB.

## Step 1 — Scan for downloads (loose files + zips)

```bash
find ~/Downloads -maxdepth 2 -type f \
  \( -iname "*.m4a" -o -iname "*.mp3" -o -iname "*.wav" \
     -o -iname "*.flac" -o -iname "*.aiff" -o -iname "*.zip" \) ! -name "._*"
```

Also peek at `~/Desktop`. DJ edits pile up loose in `~/Downloads` as WAVs
named like `BLAH (DUER Remix) FINAL.wav`; pools ship zips.

**Zip rule:** mp3+wav pairs = same song, take the WAV, copy the mp3's
embedded art onto it (mutagen APIC), let ingest's dedupe quarantine the mp3.

## Step 2 — megadj ingest (the Picard pass)

```bash
cd ~/github/megadj
bun src/cli.ts ingest ~/Downloads --dry-run   # review the plan
bun src/cli.ts ingest ~/Downloads             # execute
```

It probes, dedupes (quality rules, `(1)`-dupe detection, losers moved to
`<folder>/ingest-duplicates/`), merges tags with filename parsing, fills
artist/album from MusicBrainz, infers genre, gates sub-60s clips,
energy-rates, bootleg-aware tags (remixer in version tag, grouping =
genre), copies into `~/Music/DJ-Imports` flat, registers in DB.

**Zips are built in:** every `*.zip` in the folder is extracted, its audio
staged next to it and ingested. The zip is **deleted only after every file
from it landed in the archive or quarantine** — anything skipped/broken
keeps the zip on disk. Sources (loose files too) are **moved, not copied**:
after a successful copy into the archive the original in Downloads is
removed, so nothing duplicates.

**WAVs get artwork:** ingest embeds via mutagen APIC (ffmpeg's wav muxer
can't carry attached_pic).

## Step 3 — THE one command: `tools/fetch_all.ts`

Everything ingest didn't finish — tags, genres, artwork — in one parallel,
idempotent, ground-truth pass (reads the files, not the DB):

```bash
cd ~/github/megadj
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
   - **mp3-twin** (same-named mp3's embedded art, for WAVs from pools).
   - **Deezer** cover_xl → **iTunes** 600px.
   - leftovers → `artwork-queue.jsonl` → `megadj artwork` (AI, last resort).

**Lesson from the 88-track full pass (Sep 2026):** tracks that "can't be
found" usually ARE on SoundCloud under a different name/query — search the
**remixer's name + original title** (`"Tiwari Kesha Blow"`), look for the
**uploader's pack pages** (Vazana edit/mashup packs, RAFAEL VIP's
`LEVEX x RAFAEL MASHUP PACK`) and use the pack cover. Never accept
"untraceable" until you've tried the remixer's profile and pack pages.

## Step 3b — AI covers: last resort only

Only tracks with **no online presence at all** (checked SC search, remixer
profile, pack pages, gateways) go to the queue:

```bash
bun src/cli.ts artwork --dry-run        # preview prompts, no spend
bun src/cli.ts artwork --max 10         # bounded batch (≈$0.034/img)
```

Requires `OPENROUTER_API_KEY` (keep it in the keychain:
`security add-generic-password -a $USER -s megadj-openrouter-key -w <key>`
— the repo never hardcodes keys).

## Step 4 — Onto the USB drives

- **A few tracks** → drag onto the device in rekordbox; it analyzes and
  writes both DBs on export.
- **A batch** → `usb_sync.py` per the `rekordbox-usb-sync` skill, verify
  with `usb_verify.py`. Hardware gate: export.pdb == OneLibrary counts.

Never hand-edit drive DBs; never let two writers touch a drive at once.

## Step 5 — Health checks

```bash
bun tools/fetch_all.ts --dry-run                     # what would still be done
uv run --with mutagen python tools/final_audit.py    # ground truth: tags + embedded art
```

Ground truth = files, not the DB. As of Sep 2026: **88/88 tracks have art,
complete tags and genre** (73 WAV via APIC, 15 MP3).

**Why a WAV can "show no tags":** Finder/QuickTime don't display WAV ID3
chunks — ffprobe/mutagen see them fine. Files whose DB row exists but whose
file is "missing" usually live inside rekordbox's Mac collection.

## MusicBrainz Picard — when actually needed

Only for compilations/albums needing per-track credits, or when ingest's
match is wrong for a whole batch. After Picard, run `megadj adopt`.

## Retired tools (superseded by `fetch_all.ts`, kept in git history)

`art_final.ts`, `pack_art.ts`, `sc_art_direct.ts`, `sc_genres.ts`,
`normalize_genres.ts`, `sync_genres.ts`, `ai_genres.ts` — all their
strategies live inside `fetch_all.ts` now.
