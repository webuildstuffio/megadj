# megadj — Features & Projects

**Status:** 📚 REFERENCE — product map; live work is tracked in the current-state document and GitHub.

megadj is not one tool; it's a small fleet of named projects, each with a
vibe and a goal (see [PRINCIPLES.md](PRINCIPLES.md) §10). They chain together
into one pipeline:

```
GetDat ──▶ FullTags ──▶ CrateDeck (the Crate) ──▶ the booth
download    perfect       organize, verify,          play on
& archive   metadata      sync DJ USB drives         Pioneer
```

Status: ✅ shipped · 🔨 in progress · 🧭 coming (roadmap in
[ideas.md](ideas.md))

---

## 🎧 GetDat — _pull every track from everywhere_

**Goal:** one command pulls a track (or a whole library) from any source into
the local archive — highest quality available, rate-limited and polite,
nothing ever downloaded twice.

|                    |                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | 🔨 YouTube Music today; SoundCloud next                                                                                                                                 |
| **Sources today**  | YouTube Music (liked songs, playlists)                                                                                                                                  |
| **Sources coming** | SoundCloud (yt-dlp already covers it — it's config work), Bandcamp, 1001tracklists mining as a discovery queue                                                          |
| **How it works**   | `megadj sync` → yt-dlp at the best format available (256 kbps AAC first, graceful fallback); polite pacing and backoff, permanent failures classified and never retried |
| **State**          | SQLite tracks every video ID: status, format, bitrate, path, attempt history. Nothing re-downloads.                                                                     |
| **Flag**           | anything below 250 kbps is flagged `LOWQ` in `megadj list` — quality only ever ratchets up                                                                              |

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
   `fulltags/src/fleet.ts`; the full pick → audit → fix → reload loop is
   a skill: `.claude/skills/booth-check/SKILL.md`.
2. **Source-correct metadata** — the source the track came from is the
   first source of truth (SoundCloud page art, remix year from the upload
   page, genre tags); Beatport is the second (rev 6.4) and the only
   source of the DJ identity fields — label / mix name / official
   remixer / ISRC — stamped TXXX:BP-FIELDS.
3. **Highest quality, always** — the art ladder escalates rung by rung
   (SC original-res → Beatport 1500² → gateways → mp3-twin → Deezer →
   iTunes → AI-generated cover as the rare, queued last resort). Same
   ratchet for audio: LOWQ tracks are re-fetch candidates. The
   ladder's single home is `fulltags/src/art-sources.ts`.
4. **AI fills the gaps — cheap and accurate** — deterministic sources
   first, then OpenRouter flash-class models with confidence gates
   (≥ 0.7) for genre/year/credits; `megadj years` verifies years against
   the source page after any AI fallback.
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
`megadj setbuild`, `megadj gold-report`/`regate` (gold-set gate harness)
**Also:** FullTags ships standalone in [`fulltags/`](../fulltags/README.md)
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
right. It has [its own doc set](../cratedeck/README.md) (brief, PRD,
architecture, build plan, acceptance).

|                    |                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | ✅ shipped (v0.1) — dashboard + CLI + fleet features + automation (auto-scan on mount, weekly auto-verify) + agent surface (MCP server, B12 preflight, N75/N78 player-compat verdict, O83 weekly prep, shelf hygiene + bench-anomaly + role-aware archive-tier checks) |
| **The registry**   | every drive ever seen is a card with a photo and a name; unplug it and it becomes a **ghost** that remembers everything                                                                                                          |
| **The fleet**      | cross-drive coverage matrix (which stick has this track?), per-playlist redundancy audit (what dies with a drive?), and drive-vs-drive diff                                                                                      |
| **The sync**       | `usb_sync.py` injects new tracks into the rekordbox device DB (pyrekordbox), detects BPM (librosa), and **hand-builds ANLZ beatgrid/waveform files** at the hash-computed paths hardware actually reads                          |
| **The verify**     | `usb_verify.py` deep gate: dual-DB agreement (OneLibrary vs legacy `export.pdb` live rows), audio existence, ANLZ-at-hash-path, grid math (duration × BPM ≈ beat count), playlist integrity, cross-drive hash parity             |
| **The interlock**  | rekordbox running? everything locks — exit code 3, red banner, no exceptions. Never bypassed.                                                                                                                                    |
| **The interfaces** | `bun run deck` (dashboard) · `deckctl` (CLI, `--json` for agents) · `bun run mcp` (MCP server) — every surface's census is derived from source and pinned in [surface-parity.md](surface-parity.md) §1 |

**Commands:** `bun run deck`, `bun run cratedeck/src/deckctl.ts …`
**Shelf intake:** `megadj shelf-archive [volume …]` pulls everything from any
drive into the shelf master — additive, junk-filtered, MD5-verified, divergent
copies preserved (see [usb-sync-log.md](usb-sync-log.md), Sep 9 2026).
**Docs:** [cratedeck/README.md](../cratedeck/README.md) ·
[deckctl guide](../cratedeck/deckctl.md) ·
[USB pipeline](usb-sync.md) ·
[the doc set](cratedeck/)

> **Note:** the status row already includes the Sep 5–11 2026 additions —
> B12 preflight, N75/N78 player-compat verdicts, the MCP server's archive
> half and `getdat_*` twins, O83 weekly digest (now also a Fleet ⌗
> Prep tab), O87 job attribution, O88 agent notes, O85 plugin packaging,
> the FullTags beats + mood + cues ledgers (FullTags roadmap rev 6.2),
> the Sep 7 surface-parity revs (Fleet ⌗ Archive tab, `deckctl
rename`/`report --dossier` + MCP twins), the Sep 10 shelf-hygiene engine
+ role-aware archive-tier checks, and the Sep 11 set-builder CLI spoke
+ `megadj shelf-restore`. Rev-by-rev detail lives once in
[surface-parity.md](surface-parity.md).

**Vibe:** mission control for a drawer full of identical-looking sticks.

---

## 🧭 Coming next (from the roadmap)

- **[ideas.md](ideas.md) is canon for detail and ordering** — the full
  parking lot (§A–§O), with §0 gating everything; the live queue is
  [product-state-2026-09-07.md](product-state-2026-09-07.md) §The queue.
  (The Sep 6 proposal was executed and is archived:
  [archive/roadmap-proposal.md](archive/roadmap-proposal.md).)

Headline shape (one line per move; product-state §The roadmap owns the
re-scored table, ideas.md owns every detail):

- **Move 1 — CrateDeck v1.x:** shipped minus the C18a runbook and
  C21/C22 differential mirror + one-click sync.
- **Move 2 — FullTags v1.x:** ALL SHIPPED behind ground-truth gates —
  [fulltags-roadmap.md](fulltags-roadmap.md) is the rev-by-rev record.
- **Move 3 — the agentic layer:** SHIPPED; remaining: O84 inbox agent.
- **The dream** — hit predictor calibrated on what actually got played
  (§M64, needs history); the set-builder half already shipped propose-only
  (§M66).

Do-now items live in [ideas.md §0](ideas.md#0--do-now-before-anything-else),
which is now software-complete (issues #1–#5 closed; the two physical
tasks — evacuate Extra, create the rclone remote — wait on hardware time).

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
megadj setbuild --preset peak  # FullTags: propose a Camelot/energy-arc mix chain
bun run deck                   # CrateDeck: see every drive, sync + verify
```

Going deeper: [usb-sync.md](usb-sync.md) (pipeline what/why) ·
[`fulltags/`](../fulltags/README.md) (the enrichment engine) ·
[fulltags-roadmap.md](fulltags-roadmap.md) (what's next for tags)
