---
name: new-music-intake
description: >-
  How to get NEW songs into the DJ library: download (megadj or by hand),
  tag/artwork/dedupe them (megadj ingest does the Picard pass automatically),
  move them into the local archive, then get them onto the DJ USB drives.
  Use when asked to add new music, tag downloads, fix ID3 tags or artwork,
  dedupe downloads, or get tracks ready for rekordbox / the XDJ-XZ.
---

# New Music Intake → DJ Library

Pipeline: **tag+dedupe locally → organize → USB**. Wherever a track came
from, it ends up in `~/Music/YTMusic-Liked` (tagged, artworked, registered
in megadj's DB), and only then goes to the drives.

## Step 1 — Scan for downloads (loose files first)

```bash
find ~/Downloads -maxdepth 2 -type f \
  \( -iname "*.m4a" -o -iname "*.mp3" -o -iname "*.wav" \
     -o -iname "*.flac" -o -iname "*.aiff" \) ! -name "._*" | wc -l
```

Also peek at `~/Desktop` and `~/Music` (outside YTMusic-Liked). DJ edits
usually pile up loose in `~/Downloads` as WAVs with names like
`BLAH (DUER Remix) FINAL.wav`.

## Step 2 — Always dry-run first, review, then run

`megadj ingest` is the scripted Picard pass. It:

- probes every file; broken/zero-byte files are reported and left in place
- **dedupes with quality rules**: within the folder AND against the existing
  archive, highest quality wins (lossless > bitrate > duration). Losers are
  moved to `<folder>/ingest-duplicates/` — never deleted, review + empty
  that folder manually when satisfied
- catches Safari re-download dupes (`name (1).ext`) and version noise
  (`final`, `MASTER`, `v3`) via identity normalization
- merges existing ID3 tags with `Artist - Title` filename parsing
- fills missing artist/album/date from MusicBrainz (1 rps, polite)
- genre inference (YouTube categories + MusicBrainz artist tags)
- artwork, in order: already embedded → SoundCloud (URL found in file tags
  → oEmbed/og:image, upscaled to t500x500) → iTunes Search 600x600.
  WAV files get tags but never embedded art (WAV+art is unreliable)
- **duration gate**: files < 60s are skipped (clips/ads/broken rips — you
  won't DJ them). Override with `--min-duration N` seconds. Skipped files
  are recorded (`skipped_short`) so nothing silently disappears
- **energy rating** (1–10, RMS-loudness based — Mixed In Key style) stored
  in the DB for set planning / CrateDeck sorting
- **bootleg-aware tags**: `X - Y (Z Remix/Flip/Edit)` filenames set the
  version/remixer tag (rekordbox shows it), original artist goes in
  composer, album falls back to `Original — Track (Remixes)` or
  `Artist — Bootlegs & Edits`, and grouping carries the genre for filters
- copies tagged files into `~/Music/YTMusic-Liked` (sources never touched)
  and registers them in the state DB

```bash
cd ~/github/megadj
bun src/cli.ts ingest ~/Downloads --dry-run   # review the plan
bun src/cli.ts ingest ~/Downloads             # execute
ls ~/Downloads/ingest-duplicates/             # review dupes; delete manually
```

## Step 2b — Generated artwork queue (bootlegs with no cover anywhere)

When no artwork source is found, ingest writes the track to
`~/.local/state/megadj/artwork-queue.jsonl` and marks it `queued`. Later
(an agent session, or manually), generate square covers via the
**image-maker** CLI (`~/.claude/skills/image-maker/SKILL.md`,
OpenRouter; default `nano-banana-2-lite` ≈ $0.034/img, hard cap via
`MEGADJ_ART_MAX`, default 20 → max ~$0.68/run) and embed:

```bash
cd ~/github/megadj
export OPENROUTER_API_KEY=...        # same key as image-maker MCP config
bun src/cli.ts artwork --dry-run     # preview prompts (no spend)
bun src/cli.ts artwork               # generate + embed (bounded batch)
bun src/cli.ts artwork --model nano-banana-2   # fancier model if wanted
```

Processed entries move to `artwork-queue.jsonl.done`; covers are kept in
`~/.local/state/megadj/artwork-covers/`. Nothing spends money without an
explicit `artwork` run.

Expected pace: ~1–2 s/file (MusicBrainz politeness + artwork lookups);
60 files ≈ 10–15 min.

## Step 3 — Organize into genre folders

```bash
cd ~/github/megadj
bun src/cli.ts organize            # move into House/ Hip-Hop/ etc.
bun src/cli.ts status              # archive summary
```

## Step 4 — Onto the USB drives

Two paths (see `rekordbox-usb-sync` skill for the full pipeline + safety
rules):

- **A few tracks** → drag them onto the device in rekordbox while it's open.
  rekordbox analyzes (BPM/grids/waveforms) and writes both DBs on export.
  Fine for <20 tracks; no megadj DB surgery needed.
- **A batch / full sync** → `usb_sync.py` (DB injection + BPM + ANLZ
  generation) per the rekordbox-usb-sync skill, then verify with
  `usb_verify.py` after rekordbox closes. Hardware gate: export.pdb ==
  OneLibrary counts.

**Never** hand-edit drive DBs, and never let two writers (megadj pipeline +
rekordbox export) touch a drive at the same time.

## Step 5 — Housekeeping tools (after crash-interrupted runs)

If an ingest crashes mid-run (or Finder shows a file with "no tags"), use:

```bash
cd ~/github/megadj
bun tools/tag_audit.ts            # scan archive: zero/partial/full core tags
bun tools/fix_dupes_and_tags.ts   # swap inverted (1)-dupes back, fill missing
                                  #   artist/album/genre on flip/edit files
bash tools/dedupe_archive.ts      # DB-level dedupe, highest quality wins
bun tools/queue_missing_artwork.ts  # mark art-less mp3/m4a as queued
```

**Why a file can show "0 tags" but isn't:** WAV files keep tags in trailing
ID3 chunks that Finder/QuickTime don't display — `tag_audit.ts` reads them
properly via ffprobe. Also, files whose DB row exists but file is "missing"
often live inside rekordbox's Mac collection (imported from the USB path);
check rekordbox before assuming data loss.

## MusicBrainz Picard — when actually needed

Only for compilations/albums where track numbering and per-track credits
matter, or when ingest's automatic match is wrong for a whole batch.
Picard can also embed cover art (Options → Cover Art → Embed). After
Picard, run `megadj adopt` to register the files, then organize.
