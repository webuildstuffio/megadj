---
name: new-music-intake
description: >-
  How to get NEW songs into the DJ library: download (megadj or by hand),
  tag/artwork/dedupe them (megadj ingest does the Picard pass automatically),
  artwork via SC/Deezer/iTunes/twin/AI (art_final), genres via SC +
  OpenRouter classifier (ai_genres), then onto the USB drives. Use when asked
  to add new music, tag downloads, fix ID3 tags or artwork, dedupe downloads,
  or get tracks ready for rekordbox / the XDJ-XZ.
---

# New Music Intake → DJ Library

Pipeline: **tag+dedupe locally (flat!) → artwork+genres → USB**. Whatever the
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
`<folder>/ingest-duplicates/` — never delete source files), merges tags with
filename parsing, fills artist/album from MusicBrainz, infers genre, gates
sub-60s clips, energy-rates, bootleg-aware tags (remixer in version tag,
grouping = genre), copies into `~/Music/DJ-Imports` flat, registers in DB.

## Step 3 — Artwork: `tools/art_final.ts` (production, parallel)

Multi-source, 8 workers, ground-truth art detection (ffprobe/mutagen, not
the DB). Sources in order: **SoundCloud** (yt-dlp `scsearch4:` resolves the
permalink + genre; embeds t500x500) → **mp3-twin** → **Deezer** cover_xl →
**iTunes** 600px → leftovers appended to `artwork-queue.jsonl` for AI.

```bash
cd ~/github/megadj
bun tools/art_final.ts            # fill files missing art
bun tools/art_final.ts --all      # overwrite everywhere (SC-first)
bun tools/art_final.ts --jobs 8   # more workers
```

WAV embedding: mutagen APIC (ID3v2 in WAV works; ffmpeg's wav muxer canNOT
carry attached_pic). mp3/m4a: ffmpeg attached_pic. Also writes the SC
permalink into `format_id` for provenance, and SC's genre into the DB.

## Step 3b — AI covers for bootlegs with no cover anywhere

`megadj artwork` generates square covers (image-maker/OpenRouter,
nano-banana-2-lite ≈ $0.034/img, cap `MEGADJ_ART_MAX`) and embeds — WAVs now
supported via APIC. Requires `OPENROUTER_API_KEY` with credit.

```bash
bun src/cli.ts artwork --dry-run    # preview prompts
bun src/cli.ts artwork              # generate + embed (bounded batch)
```

## Step 3c — Genres at scale: `tools/ai_genres.ts`

OpenRouter mini-model, 20 tracks/request, strict JSON out. Only applies
labels with confidence ≥ 0.7. Requires `OPENROUTER_API_KEY` with credit.

```bash
bun tools/ai_genres.ts                        # default gemini-flash-lite
bun tools/ai_genres.ts --min-conf 0.8         # stricter
```

Between passes: SC genre tags (`#house` style) + iTunes `primaryGenreName`
cover most mainstream tracks; the classifier mops up the rest.

## Step 4 — Onto the USB drives

- **A few tracks** → drag onto the device in rekordbox; it analyzes and
  writes both DBs on export.
- **A batch** → `usb_sync.py` per the `rekordbox-usb-sync` skill, verify
  with `usb_verify.py`. Hardware gate: export.pdb == OneLibrary counts.

Never hand-edit drive DBs; never let two writers touch a drive at once.

## Step 5 — Health checks

```bash
bun tools/tag_audit.ts                              # file-level: zero/partial/full tags
uv run --with mutagen python tools/final_audit.py   # ground truth: tags + embedded art per file
```

**Why a WAV can "show no tags":** Finder/QuickTime don't display WAV ID3
chunks — ffprobe/mutagen see them fine. Files whose DB row exists but whose
file is "missing" usually live inside rekordbox's Mac collection.

## MusicBrainz Picard — when actually needed

Only for compilations/albums needing per-track credits, or when ingest's
match is wrong for a whole batch. After Picard, run `megadj adopt`.
