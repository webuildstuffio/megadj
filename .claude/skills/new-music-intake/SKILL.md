---
name: new-music-intake
description: >-
  How to get NEW songs into the DJ library: download (megadj or by hand),
  tag/artwork them (megadj ingest does the Picard pass automatically), place
  into the archive, and get them onto the DJ USB drives. Use when asked to
  add new music, tag downloads, fix ID3 tags or artwork, or get tracks
  ready for rekordbox / the XDJ-XZ.
---

# New Music Intake → DJ Library

End-to-end: wherever a track came from, it ends up in `~/Music/YTMusic-Liked`
(tagged, artworked, registered in megadj's DB) and then on both DJ USBs.

## Sources — pick by situation

### A. It's on YouTube Music (most common)
`megadj sync` already embeds artwork (yt-dlp `--embed-thumbnail`), writes full
tags from the label feed, and infers genre. Nothing extra needed.

```bash
cd ~/github/megadj
bun src/cli.ts sync --limit 5          # newest 5 liked tracks
bun src/cli.ts sync --music-only        # skip podcasts/ramble
```

### B. Files you already have (Bandcamp,Beatport, friends' folders, loose downloads)
`megadj ingest` is the scripted Picard pass — it probes files, merges
filename/tags, fills missing album/date from MusicBrainz, infers genre,
fetches missing artwork from iTunes (600x600) and embeds it, copies into the
archive, and registers everything in the state DB. It never touches sources.

```bash
cd ~/github/megadj
bun src/cli.ts ingest ~/Downloads/party-drops --dry-run   # preview first
bun src/cli.ts ingest ~/Downloads/party-drops             # do it
bun src/cli.ts organize                                     # into genre folders
```

- Filenames help but aren't required: `Artist - Title.ext` is parsed when
  tags are missing. `NNN - ` rank prefixes are tolerated.
- Broken/zero-byte files are reported and left in place — delete them
  yourself after checking.
- `--no-artwork` skips artwork if you want zero network lookups.
- WAV/FLAC/AIFF are carried as-is; only tags get rewritten (stream copy).

### C. Full interactive tagging (rare: compilations, wrong artist matches)
The "brainz something" is **MusicBrainz Picard** — only worth opening for
albums where per-disc/track numbering matters. It embeds artwork too
(Cover Art → "Embed cover art" in Options), then `megadj adopt` to register
the files. Not part of the normal loop; `ingest` covers ~everything.

## After tagging — onto the drives

1. `megadj organize` (genre folders; YTMusic Liked tracks stay put).
2. Run the USB pipeline from `rekordbox-usb-sync` skill: `usb_sync.py` for
   DB injection + BPM + ANLZ, or the simple path — drag into rekordbox
   while it's open (fine for a handful of tracks).
3. Verify with `usb_verify.py` after rekordbox closes.

**Rule of thumb:** a few tracks → drag in rekordbox. A batch → `ingest` +
`usb_sync.py`. Never hand-edit drive DBs (see rekordbox-usb-sync safety
rules).

## Analysis / BPM
rekordbox always re-analyzes on import (beatgrids/waveforms are its own
format). Our generated ANLZ exists so legacy players see something; when
tracks go in via rekordbox, its analysis is authoritative. No extra local
BPM step needed for the normal loop.
