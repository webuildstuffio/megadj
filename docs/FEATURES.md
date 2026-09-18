# megadj — Features & Projects

**Status:** 📚 REFERENCE — product map; live work is tracked in the current-state document and GitHub.

megadj is not one tool; it's a small fleet of named projects, each with a
vibe and a goal (see [PRINCIPLES.md](PRINCIPLES.md) §10). They chain together
into one pipeline:

```
GetDat ──▶ FullTags ──▶ Set ──▶ CrateDeck (the Crate) ──▶ the booth
download    perfect       propose      organize, verify,      play on
& archive   metadata      the mix      sync DJ USB drives     Pioneer
```

Status: ✅ shipped · 🔨 in progress · 🧭 coming (roadmap on
[GitHub issues](https://github.com/webuildstuffio/megadj/issues))

---

## 🎧 GetDat — _pull every track from everywhere_

**Goal:** one command pulls a track (or a whole library) from any source into
the local archive — highest quality available, rate-limited and polite,
nothing ever downloaded twice.

|                    |                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | 🔨 YouTube Music downloads today; SC/BP/Bandcamp enrichment live in the fetch ladder                                                                                                                                                                |
| **Sources today**  | YouTube Music (liked songs, playlists); SoundCloud + Beatport + **Bandcamp (Sep 15)** vote genre/year/label/art at `megadj fetch` time; the **imprint prior (Sep 16, W7)** converts Beatport-filled labels into a genre vote when the catalogs miss |
| **Sources coming** | SoundCloud as a download source (#109) · 1001tracklists mining as a discovery queue (#110) · Bandcamp downloads once yt-dlp's extractor recovers (#124 context)                                                                                     |
| **How it works**   | `megadj sync` → yt-dlp at the best format available (256 kbps AAC first, graceful fallback); polite pacing and backoff, permanent failures classified and never retried                                                                             |
| **State**          | SQLite tracks every video ID: status, format, bitrate, path, attempt history. Nothing re-downloads.                                                                                                                                                 |
| **Flag**           | anything below 250 kbps is flagged `LOWQ` in `megadj list` — quality only ever ratchets up                                                                                                                                                          |

**Vibe:** the archiver that never says "this source isn't supported" without
also saying "here's the issue where it will be".

---

## 🏷️ FullTags — _100% accurate, 100% coverage, zero manual labour_

**Goal:** every file fully tagged — every ID3 field filled, every field
**correct** — with quality/spam filtering, and the _right_ artwork and year:
the remix's, not the original's.

**Sub-goals:**

1. **Coverage + accuracy** — `megadj audit` is the ground-truth gate: art +
   title + artist + album + genre + year must be present _and correct_ on
   100% of tracks, verified by reading files (never trusting the DB). The
   gate is also booth-safe: `player-compat` + `booth-text` enforce the
   audio floor of the **configured booth fleet** and flag what the players
   can't display or export (glyph tables, mojibake, illegal filename
   characters, over-long paths). `megadj booth-fix [--apply --yes]`
   proposes (and applies) the safe fixes. Fleet selection + citations:
   `src/fulltags/fleet.ts`; the full pick → audit → fix → reload loop is
   a skill: `.claude/skills/booth-check/SKILL.md`.
2. **Source-correct metadata** — the source the track came from is the
   first source of truth (SoundCloud page art, remix year from the upload
   page, genre tags); Beatport is the second (rev 6.4) and the only
   source of the DJ identity fields — label / mix name / official
   remixer / ISRC — stamped TXXX:BP-FIELDS. Since #173 (Sep 16) the
   fetch ladder is a **weighted multi-source vote**: every rung
   (SC / Beatport / Bandcamp / imprint prior / AI / MusicBrainz / file
   tags / sync category) casts genre + weight + provenance
   (`GENRE_VOTE_WEIGHTS`, the doc's W-table versioned in
   `src/fulltags/genre/genre-vote.ts`); the highest total elects, ties break
   toward the harder gate, and the full breakdown persists in
   `tracks.genre_votes` — every stored genre is explainable after the
   fact.
3. **Highest quality, always** — the art ladder escalates rung by rung
   (SC original-res → Beatport 1500² → gateways → mp3-twin → Deezer →
   iTunes → AI-generated cover as the rare, queued last resort). Same
   ratchet for audio: LOWQ tracks are re-fetch candidates. The
   ladder's single home is `src/fulltags/sources/art-sources.ts`.
4. **AI fills the gaps — explicitly and measurably** — deterministic sources
   first; `--ai-fallback` opts into OpenRouter genre/year proposals with a
   ≥0.7 confidence gate. `megadj years` then verifies years against the source
   page.
5. **Quality & spam filter** — dedupe on ingest (`(1)`-dupe detection,
   same-stem mp3↔lossless pairs, quality rules; rejects go to the
   archive-root hidden `.ingest-duplicates/`, never a visible folder
   people drag back in), zero-byte/corrupt probe before
   anything poisons the library, sub-60s clip gating.

**Commands:** `megadj ingest`, `megadj convert` (archive-wide WAV→AIFF),
`megadj drop` (one-shot: download → ingest → fetch → years → beats →
mood → cues → organize → tag-check → audit), `megadj fetch`, `megadj
enrich`, `megadj artwork`, `megadj audit`, `megadj tag-check` (tag
structure + booth-text health), `megadj years`, `megadj booth-fix`,
`megadj beats`, `megadj mood`, `megadj cues`, `megadj similar`,
`megadj megaset`, `megadj gold-report`/`regate` (gold-set gate harness)
**Also:** FullTags ships standalone in [`src/fulltags/`](../fulltags/README.md)
— same schema, writer, art ladder, its own CLI + `audit --json`; megadj's
commands are thin wrappers over it.
**Docs:** [new-music-intake skill](../.claude/skills/new-music-intake/SKILL.md)

**Vibe:** Picard, if Picard had a web browser, a fingerprint matcher, and a
budget of four cents.

---

## 📼 CrateDeck — _the Crate: organize, sync, verify every DJ USB_

**Goal:** every DJ USB drive — mounted or in a drawer — identified on sight,
kept byte-identical to its mirror, verified down to the byte-grid level, and
answered in one glance: **is this stick safe for tonight?**

This is the USB-crate organization project, and it's a project in its own
right. It has [its own doc set](../cratedeck/README.md) (PRD, architecture,
acceptance, and the deckctl guide).

|                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | ✅ shipped (v0.1) — dashboard + CLI + fleet features + automation (auto-scan on mount, weekly auto-verify) + agent surface (MCP server, B12 preflight, N75/N78 player-compat verdict, O83 weekly prep, shelf hygiene + bench-anomaly + role-aware archive-tier checks)                                                                                                                                                                                                                                            |
| **The registry**   | every drive ever seen is a card with a photo and a name; unplug it and it becomes a **ghost** that remembers everything                                                                                                                                                                                                                                                                                                                                                                                           |
| **The fleet**      | cross-drive coverage matrix (which stick has this track?), per-playlist redundancy audit (what dies with a drive?), and drive-vs-drive diff                                                                                                                                                                                                                                                                                                                                                                       |
| **The sync**       | `usb_sync.py` injects new tracks into the rekordbox device DB (pyrekordbox), detects BPM (librosa), and **hand-builds ANLZ beatgrid/waveform files** at the hash-computed paths hardware actually reads                                                                                                                                                                                                                                                                                                           |
| **The verify**     | `usb_verify.py` deep gate: dual-DB agreement (OneLibrary vs legacy `export.pdb` live rows), audio existence, ANLZ-at-hash-path, grid math (duration × BPM ≈ beat count), playlist integrity, cross-drive hash parity. **Read a dual-DB mismatch as an export gap** — every drive carries BOTH libraries (`export.pdb` is the only one hardware players read), so a green master DB ≠ hardware sees the change: re-export after imports/relocations; the mismatch fails on gig sticks, informational on shelf tier |
| **The interlock**  | rekordbox running? everything locks — exit code 3, red banner, no exceptions. Never bypassed.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **The interfaces** | `bun run deck` (dashboard) · `deckctl` (CLI, `--json` for agents) · `bun run mcp` (MCP server) — every surface's census is derived from source and pinned in [surface-parity.md](surface-parity.md) §1                                                                                                                                                                                                                                                                                                            |

**Commands:** `bun run deck`, `bun run cratedeck/src/deckctl.ts …`
**Shelf intake:** `megadj shelf-archive [volume …]` pulls everything from any
drive into the shelf master — additive, junk-filtered, MD5-verified, divergent
copies preserved. Live receipts come from `megadj shelf-sweeps --json`; the
local `docs/usb-sync-log.md` is intentionally gitignored operator evidence.
**Docs:** [cratedeck/README.md](../cratedeck/README.md) ·
[deckctl guide](../cratedeck/deckctl.md) ·
[USB pipeline](getdat/usb-sync.md) ·
[the doc set](cratedeck/)

> Revision history and the exact surface census live once in
> [surface parity](surface-parity.md).

**Vibe:** mission control for a drawer full of identical-looking sticks.

---

## 🎚️ MegaSet — _the co-pilot: propose the mix, keep the taste_

**Goal:** turn the archive's measured data (beats, mood, key, embeddings,
8-bar phrase cues) into an ordered, key-compatible mix proposal with a
visible energy arc — deterministic, honest about its inputs, and
propose-only: the DJ keeps every creative decision.

|                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ graduated product — v0 shipped propose-only (Sep 11–12 2026): greedy Camelot/energy-arc engine, whole-library pool, CLI + web + MCP + M3U8 export, gated `megadj rb-playlist` write-off; own doc set since Sep 14. v1 = the [re-ranked roadmap](megaset/03-competitive-analysis.md). Sep 16: #106 Phase D cue-window handoffs + #171 embeddings similarity prior.                                                                                                                                                                                                                                                                                                                     |
| **How it works**  | FullTags ledgers feed a pure scoring engine (`0.45·tempo + 0.3·key + 0.25·energy-fit`, ±6% tempo window, Camelot wheel); one preset registry (warmup/peak/afterhours) drives all surfaces; every exclusion is counted and explainable. Sep 16: transitionScore adds a capped cosine-similarity bonus (`MEGASET_SIMILARITY_WEIGHT` 0.1) from both tracks' stored embeddings — timbre breaks ties among ALREADY-mixable candidates; the tempo/key/anchor gates run first, so the prior never rescues a clash. Beam search (width 8) activates for sparse pools. Phase D adds mix-in/mix-out cue windows from the phrases ledger to every step, rendered in CLI, web, and M3U8 (`#EXTREM`). |
| **The write-off** | `megadj rb-playlist` links a proposal into the rekordbox master as a real playlist — dry-run first; `--apply` requires rekordbox closed, backs up both collection surfaces, writes the DB row and `masterPlaylists6.xml` twin, then verifies both.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Docs**          | [MegaSet docs](megaset/01-prd.md) (PRD · architecture · 30-comparator analysis) · [audit + plan detail](megaset/08-audit-and-plan.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Commands:** `megadj megaset --preset peak --minutes 60 [--opener <id>] [--search greedy|beam] [--json]` (the old `setbuild` verb is retired — unknown-command since #56) ·
`megadj rb-playlist [drive] [--preset …] [--apply --yes]`
**Vibe:** "the opener sells the night — Set makes sure you never open
with a 73-BPM track in a 128 room."

---

## 🧭 Coming next (from the roadmap)

The [current product state](product-state-2026-09-07.md) owns the short ordered
outcome list. GitHub issues own backlog rationale and execution priority (the
former ideas catalog is archived at
[archive/ideas-2026-09-15.md](archive/ideas-2026-09-15.md)). The executed Sep 6
proposal is retained only as [archive evidence](archive/roadmap-proposal.md).

---

## The pipeline in one command each

```bash
megadj sync                    # GetDat: pull new music
megadj fetch && megadj audit   # FullTags: perfect the metadata
megadj beats && megadj mood    # FullTags: beats + mood ledgers (DB-side)
megadj years                   # FullTags: verify years vs SC page (kills AI 2023 guesses)
megadj shelf-sync              # shelf: archive → shelf master (new music out)
megadj shelf-archive <volume>  # shelf: drive → shelf master (stray-drive intake)
megadj shelf-sweeps            # shelf: DB ledger — every sweep's verdict, latest per drive
megadj shelf-dupescan          # shelf: fingerprint dupes regardless of name/folder
megadj similar <video_id>      # FullTags: sounds-like kNN over the embeddings ledger
megadj megaset --preset peak  # MegaSet: propose a Camelot/energy-arc mix chain
bun run deck                   # CrateDeck: see every drive, sync + verify
```

Going deeper: [getdat/usb-sync.md](getdat/usb-sync.md) (pipeline what/why) ·
[`src/fulltags/`](../fulltags/README.md) (the enrichment engine) ·
[fulltags/fulltags-roadmap.md](fulltags/fulltags-roadmap.md) (what's next for tags)
