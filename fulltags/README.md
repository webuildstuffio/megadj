# FullTags

**One pass, every field.** FullTags is the megadj sub-project that takes any
`mp3 / m4a / wav / flac / aiff` and fully enriches it: title, artist, album,
album artist, genre, year (of _this version_ — remix year for edits), remix
credit, producer credits, grouping, source URL, energy, embedded artwork,
MusicBrainz MBID — plus three offline analysis stages shipped Sep 5 2026
(roadmap rev 4): **acoustic fingerprint** (chromaprint → `TXXX:ACOUSTID`),
**real BPM** (beat_this → `TBPM`, half/double-tempo folded into the 70–180
DJ window), and **harmonic key** (OpenKeyScan analyzer → `TKEY` +
`TXXX:CAMELOT`). All idempotent via existing-stamp detection; missing envs
degrade to a skip note, never a failure.

Ground-truth driven: the **file** is the truth, the DB is a cache. Every
write is atomic (tmp + rename, audio stream-copied — never re-encoded).
Idempotent: run it twice, the second pass changes nothing.

```
fulltags <file-or-folder>            fill every missing field
fulltags audit <folder> [--json]     completeness gate (same gate as `megadj audit`)
fulltags <folder> --fingerprint      chromaprint fingerprint → TXXX:ACOUSTID (brew install chromaprint)
fulltags <folder> --bpm              beat_this tempo → TBPM (uv-managed env; ~1 s/track CPU)
fulltags <folder> --key              OpenKeyScan key → TKEY + TXXX:CAMELOT (clone the analyzer repo)
bun run fulltags/verify-key.ts <folder> --limit 20   # key gauntlet gate: ≥80% vs existing tags
```

Key-stage operational gauntlet (before any library-wide run): disable
rekordbox Key analysis (it overwrites imported keys), batch-write, Reload
Tags in RB, then run `verify-key.ts` against tracks with existing MIK/RB
keys — require ≥80% exact agreement. BPM stage: compare against
rekordbox-reanalyzed grids; flag disagreements > 2%.

---

## Why a sub-project

megadj grew enrichment logic across five files (`src/metadata.ts`,
`src/commands/{energy,embed,remix,wav-to-aiff}.ts`, `tools/fetch_lib.ts`,
`tools/fetch_ai.ts`). Each had a hard-won format gotcha in it (AIFF drops
ID3 chunks; WAV can't carry ffmpeg art; mp3 wants id3v2.3). FullTags
consolidates all of it behind **one schema, one writer, one pipeline**, and
megadj's modules are now thin re-export shims so nothing else had to change
(atomic migration — `git log --follow` keeps the history).

## Layout

```
fulltags/
  cli.ts                 CLI entry (enrich + audit subcommands)
  src/
    schema.ts            FullTag / TagPatch types, genre canon + vocabulary
    schema-guards.ts     validatePatch (runtime guards before any write)
    writer.ts            ONE write surface: writePatch / applyTags / embedArt
                         (all format gotchas live here)
    readers.ts           groundTruth / readFullTag — file-first reads
    probes.ts            ffprobe, filename parsing, MB lookup, RMS energy
    metadata-build.ts    yt-dlp info → EnrichedMetadata (cleanTitle, credits)
    art-sources.ts       SC search + every artwork source (the art ladder)
    ai.ts                OpenRouter genre/year fallback (conf ≥ 0.7)
    convert.ts           WAV → AIFF (rekordbox covers)
    remix.ts             `X - Y (Z Remix)` detection
    pipeline.ts          enrichTrack / enrichAll — the orchestrator
    exports.ts           public import surface
  test/                  82 tests (schema, writer round-trips, pipeline,
                         m4a/AIFF stamps, audit gate, CLI subcommands,
                         analysis stages — env-gated)
```

## The ladders (first success wins)

| Field    | Order                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------- |
| identity | file tags → filename parse → MusicBrainz recording (1 rps)                                           |
| genre    | file → SoundCloud tags (via yt-dlp scsearch) → canonical map → AI classifier (conf ≥ 0.7)            |
| year     | file → SC upload timestamp (the **remix** year) → AI (verify: flash-lite guesses 2023)               |
| artwork  | embedded → SC page og:image (original/t1080) → hype gateways → mp3-twin → Deezer → iTunes → AI queue |
| remixer  | title/filename `(Remixer Remix/Flip/Edit)` pattern                                                   |
| energy   | ffmpeg RMS astats → 1–10 (Mixed In Key style baseline)                                               |

## AI provenance (trust in automation)

AI-filled genre/year are stamped into the file as `TXXX:AI-GENRE` /
`TXXX:AI-YEAR` with the classifier's confidence — `Techno|0.92` — so an
AI-filled field is always identifiable and auditable, never silently
indistinguishable from a human/SC-sourced one. `fulltags audit` reports
them (`genre←AI(0.92)` in the `aiFilled` column, both text and `--json`).

## Format gotchas (why there's one writer)

- **AIFF**: ffmpeg's aiff muxer **drops the ID3 chunk** — AIFF tag writes go
  through mutagen, editing the chunk in place (embedded art survives).
- **WAV**: ffmpeg's wav muxer can't carry attached_pic — art goes via mutagen
  APIC. But rekordbox ignores WAV art entirely → convert to AIFF at ingest
  (`convert.ts`).
- **mp3**: written as id3v2.3 for widest hardware compatibility.
- **m4a**: tags go through mutagen (ffmpeg's ipod muxer has NO metadata
  mapping for bpm/energy/remixer/mbid/AI-* — they vanish silently, and
  every remux wipes existing freeform atoms); covers still remux via
  ffmpeg (mjpeg + `attached_pic`).
- **tmp files keep their extension** — ffmpeg infers the muxer from the
  filename; an extensionless `.fa` tmp fails with "Unable to choose an output
  format" (a real bug this migration fixed in the old `fetch_lib` path).
- **failed writes clean up** — a corrupt input must never leave an orphan
  `.tagged` tmp in the folder (Bun's `$` throws on non-zero exit, so the
  unlink lives in `catch`, not after an exit-code check).
- **analysis-stage envs** (see roadmap rev 4 §7 for the full list): beat_this
  has no tempo field on the programmatic path (derive `60/median(Δbeats)`;
  beats arrive in seconds) and needs `soundfile` for mp3/m4a decode;
  OpenKeyScan treats **stdin EOF as shutdown** (never `stdin.end()` before
  responses land) and its stdout must be read line-by-line, never
  buffered-to-end; uv `--with-requirements` ≠ the same pins spelled as
  `--with` flags (the latter hung).

## Usage

```bash
bun run fulltags/cli.ts <folder-or-file>               # enrich (folder or single file)
bun run fulltags/cli.ts track.mp3 --energy --dry-run   # stage subset, no write
bun run fulltags/cli.ts audit <archive-folder>         # completeness gate (--json for machines)
```

Stages: `--tags --genre --art --year --energy` (default: all). Other flags:
`--jobs N`, `--upgrade-sc-art`, `--artwork-queue PATH | --no-queue`,
`--archive-dir DIR`.

**Env**: `OPENROUTER_API_KEY` for the AI genre/year fallback. Artwork misses
append to `~/.local/state/megadj/artwork-queue.jsonl` so the existing
`megadj artwork` AI-cover pass can pick them up.

## Relationship to megadj commands

| megadj command  | What it does now                                                          |
| --------------- | ------------------------------------------------------------------------- |
| `megadj ingest` | unchanged — calls FullTags `applyTags`/`wavToAiff`/energy via shims       |
| `megadj fetch`  | unchanged — `tools/fetch_all.ts` now writes through FullTags `writePatch` |
| `megadj audit`  | same completeness gate as `fulltags audit` (one reader)                   |
| `megadj enrich` | MB genre top-up (kept; will fold into FullTags later)                     |

The **roadmap** for what comes next (key detection, Essentia mood/genre
models, beat_this BPM, fingerprints) lives in
[docs/fulltags-roadmap.md](../docs/fulltags-roadmap.md).
