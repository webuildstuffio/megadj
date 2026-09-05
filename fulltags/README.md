# FullTags

**One pass, every field.** FullTags is the megadj sub-project that takes any
`mp3 / m4a / wav / flac / aiff` and fully enriches it: title, artist, album,
album artist, genre, year (of _this version_ — remix year for edits), remix
credit, producer credits, grouping, source URL, energy, embedded artwork,
MusicBrainz MBID.

Ground-truth driven: the **file** is the truth, the DB is a cache. Every
write is atomic (tmp + rename, audio stream-copied — never re-encoded).
Idempotent: run it twice, the second pass changes nothing.

```
fulltags <file-or-folder>            fill every missing field
fulltags audit <folder> [--json]     completeness gate (same gate as `megadj audit`)
```

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
  test/                  49 tests (schema, writer round-trips, pipeline, AIFF)
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

## Format gotchas (why there's one writer)

- **AIFF**: ffmpeg's aiff muxer **drops the ID3 chunk** — AIFF tag writes go
  through mutagen, editing the chunk in place (embedded art survives).
- **WAV**: ffmpeg's wav muxer can't carry attached_pic — art goes via mutagen
  APIC. But rekordbox ignores WAV art entirely → convert to AIFF at ingest
  (`convert.ts`).
- **mp3**: written as id3v2.3 for widest hardware compatibility.
- **m4a**: ipod muxer; covers re-encode to mjpeg + `attached_pic`.
- **tmp files keep their extension** — ffmpeg infers the muxer from the
  filename; an extensionless `.fa` tmp fails with "Unable to choose an output
  format" (a real bug this migration fixed in the old `fetch_lib` path).

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
