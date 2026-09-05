# megadj — Features & Projects

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
   100% of tracks, verified by reading files (never trusting the DB).
2. **Source-correct metadata** — a SoundCloud remix gets the SoundCloud
   artwork, the remix year (from the upload page's `display_date`, not a
   guessed "2023"), the SoundCloud genre tags. A hypeddit gateaway track gets
   gateway art. The source it came from is the first source of truth.
3. **Highest quality, always** — the art ladder escalates: SoundCloud page
   art at original resolution → hypeddit/hyperfollow gateways → mp3-twin →
   Deezer → iTunes → and only as a rare last resort, **AI-generated cover**
   (clearly queued, cheap model, human-reviewable). Same ratchet for audio:
   LOWQ tracks are re-fetch candidates.
4. **AI fills the gaps — cheap and accurate** — deterministic sources first,
   then OpenRouter flash-class models with confidence gates (≥ 0.7) for genre
   classification, year estimation, credit parsing. It's a few tenths of a
   cent per pass. AI does the web research and unstructured→structured
   conversion; humans do nothing.
5. **Quality & spam filter** — dedupe on ingest (`(1)`-dupe detection,
   quality rules, quarantine folder), zero-byte/corrupt probe before
   anything poisons the library, sub-60s clip gating.

**Commands:** `megadj ingest`, `megadj fetch`, `megadj enrich`, `megadj
artwork`, `megadj audit`
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

|                    |                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**         | ✅ shipped (v0.1) — dashboard + CLI + fleet features + automation (auto-scan on mount, weekly auto-verify)                                                                                                           |
| **The registry**   | every drive ever seen is a card with a photo and a name; unplug it and it becomes a **ghost** that remembers everything                                                                                              |
| **The fleet**      | cross-drive coverage matrix (which stick has this track?), per-playlist redundancy audit (what dies with a drive?), and drive-vs-drive diff                                                                          |
| **The sync**       | `usb_sync.py` injects new tracks into the rekordbox device DB (pyrekordbox), detects BPM (librosa), and **hand-builds ANLZ beatgrid/waveform files** at the hash-computed paths hardware actually reads              |
| **The verify**     | `usb_verify.py` deep gate: dual-DB agreement (OneLibrary vs legacy `export.pdb` live rows), audio existence, ANLZ-at-hash-path, grid math (duration × BPM ≈ beat count), playlist integrity, cross-drive hash parity |
| **The interlock**  | rekordbox running? everything locks — exit code 3, red banner, no exceptions. Never bypassed.                                                                                                                        |
| **The interfaces** | `bun run deck` (dashboard) · `deckctl` (CLI: `status/drives/report/run/coverage/redundancy/diff`, `--json` for agents)                                                                                               |

**Commands:** `bun run deck`, `bun run cratedeck/src/deckctl.ts …`
**Docs:** [cratedeck/README.md](../cratedeck/README.md) ·
[deckctl guide](../cratedeck/deckctl.md) ·
[USB pipeline](usb-sync.md) ·
[the doc set](cratedeck/)

**Vibe:** mission control for a drawer full of identical-looking sticks.

---

## 🧭 Coming next (from the roadmap)

The full parking lot lives in [ideas.md](ideas.md); the **opinionated
proposal — what to build next and why — is
[roadmap-proposal.md](roadmap-proposal.md)** (three moves: harden the moat →
complete the metadata → agentify). Headliners per project:

- **CrateDeck v1.x** — global search across ghosts (§B9), gig mode &
  preflight (§B12), player-compatibility verdict (§N75–78), set
  intelligence (§B11), assisted legacy-export runbook (§C18a),
  scheduled unattended sync (§C22).
  _Shipped since this list was written: auto-scan on mount + weekly
  auto-verify (§B17), fleet coverage/redundancy/diff (§B6–B8), ⌘K search
  over snapshots + the Fleet page._
- **GetDat v2** — SoundCloud as a first-class source (§K57), Bandcamp +
  long-tail platforms (§K58), 1001tracklists mining → discovery queue
  (§K59), `megadj drop` one-shot (§K61), LOWQ upgrade queue (§D24, L62).
- **FullTags v2** — acoustic fingerprint ledger (§L62), OpenKeyScan key
  detection writing `TKEY` + Camelot (§I51), real BPM + downbeats via
  `beat_this` (§I46), Essentia mood & vibe suite (§I45),
  structure-aware grids & cues (§I46).
- **The agentic layer** — safety rails first (§O86), then the megadj MCP
  server (§O82) and a weekly headless agent prep loop (§O83).
- **The dream** — hit predictor & set-builder copilot, calibrated on what
  actually got played; proposes sequences, never auto-exports (§M64, M66).

---

## The pipeline in one command each

```bash
megadj sync                    # GetDat: pull new music
megadj fetch && megadj audit   # FullTags: perfect the metadata
bun run deck                   # CrateDeck: see every drive, sync + verify
```

Going deeper: [usb-sync.md](usb-sync.md) (pipeline what/why) ·
[`fulltags/`](../fulltags/README.md) (the enrichment engine) ·
[fulltags-roadmap.md](fulltags-roadmap.md) (what's next for tags)
