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

## 🎧 GetDat — *pull every track from everywhere*

**Goal:** one command pulls a track (or a whole library) from any source into
the local archive — highest quality available, rate-limited and polite,
nothing ever downloaded twice.

| | |
|---|---|
| **Status** | 🔨 YouTube Music today; SoundCloud next |
| **Sources today** | YouTube Music (liked songs, playlists) |
| **Sources coming** | SoundCloud (yt-dlp already covers it — it's config work), Bandcamp, 1001tracklists mining as a discovery queue |
| **How it works** | `megadj sync` → yt-dlp with premium-quality formats (256 kbps AAC first, graceful fallback), token-bucket rate limiting with jitter and exponential backoff, permanent failures classified and never retried |
| **State** | SQLite tracks every video ID: status, format, bitrate, path, attempt history. Nothing re-downloads. |
| **Flag** | anything below 250 kbps is flagged `LOWQ` in `megadj list` — quality only ever ratchets up |

**Vibe:** the archiver that never says "this source isn't supported" without
also saying "here's the issue where it will be".

---

## 🏷️ FullTags — *100% accurate, 100% coverage, zero manual labour*

**Goal:** every file fully tagged — every ID3 field filled, every field
**correct** — with quality/spam filtering, and the *right* artwork and year:
the remix's, not the original's.

**Sub-goals:**

1. **Coverage + accuracy** — `megadj audit` is the ground-truth gate: art +
   title + artist + album + genre + year must be present *and correct* on
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
**Docs:** [new-music-intake skill](../.claude/skills/new-music-intake/SKILL.md)

**Vibe:** Picard, if Picard had a web browser, a fingerprint matcher, and a
budget of four cents.

---

## 📼 CrateDeck — *the Crate: organize, sync, verify every DJ USB*

**Goal:** every DJ USB drive — mounted or in a drawer — identified on sight,
kept byte-identical to its mirror, verified down to the byte-grid level, and
answered in one glance: **is this stick safe for tonight?**

This is the USB-crate organization project, and it's a project in its own
right. It has [its own doc set](../cratedeck/README.md) (brief, PRD,
architecture, build plan, acceptance).

| | |
|---|---|
| **Status** | ✅ shipped (v0.1) — dashboard + CLI + fleet features |
| **The registry** | every drive ever seen is a card with a photo and a name; unplug it and it becomes a **ghost** that remembers everything |
| **The fleet** | cross-drive coverage matrix (which stick has this track?), per-playlist redundancy audit (what dies with a drive?), and drive-vs-drive diff |
| **The sync** | `usb_sync.py` injects new tracks into the rekordbox device DB (pyrekordbox), detects BPM (librosa), and **hand-builds ANLZ beatgrid/waveform files** at the hash-computed paths hardware actually reads |
| **The verify** | `usb_verify.py` deep gate: dual-DB agreement (OneLibrary vs legacy `export.pdb` live rows), audio existence, ANLZ-at-hash-path, grid math (duration × BPM ≈ beat count), playlist integrity, cross-drive hash parity |
| **The interlock** | rekordbox running? everything locks — exit code 3, red banner, no exceptions. Never bypassed. |
| **The interfaces** | `bun run deck` (dashboard) · `deckctl` (CLI: `status/drives/report/run/coverage/redundancy/diff`, `--json` for agents) |

**Commands:** `bun run deck`, `bun run cratedeck/src/deckctl.ts …`
**Docs:** [cratedeck/README.md](../cratedeck/README.md) ·
[deckctl guide](../cratedeck/deckctl.md) ·
[USB pipeline](usb-sync.md) ·
[docs/cratedeck/](cratedeck/)

**Vibe:** mission control for a drawer full of identical-looking sticks.

---

## 🧭 Coming next (from the roadmap)

The full parking lot lives in [ideas.md](ideas.md); these are the named
major features it's pointing at:

### CrateDeck v1.x
- **Gig mode & preflight** — one click: drive marked out-for-gig → pass/fail
  checklist (sync, grids, integrity, space) → history harvest on return (§B12, F35)
- **Set intelligence** — harvest player-written history from the drives:
  most-played, never-played, set reconstruction (§B11)
- **Assisted legacy-export runbook** — CrateDeck walks you through the
  once-per-generation XDJ-XZ export dance, auto-detecting each stage (§C18a)
- **Scheduled unattended sync** — sync→mirror→verify as one job with
  notifications, safe under the interlock (§C22)

### GetDat v2
- **SoundCloud as a first-class source** — favorites sync, 320 kbps streams,
  reposts and playlists (§K57)
- **Bandcamp + long-tail platforms** (§K58)
- **1001tracklists mining → discovery queue** — "played everywhere, not in
  your library" (§K59)
- **`megadj drop`** — the one-shot: drop a folder or URL → clean → analyze →
  tag → rekordbox-ready (§K61)
- **LOWQ upgrade queue** — re-resolve every low-quality track at today's best
  format, verify by fingerprint before swapping (§D24, L62)

### FullTags v2
- **Acoustic fingerprint ledger** — Chromaprint per file: cross-format dupe
  detection, verified swaps, untagged-file identification (§L62)
- **Key detection that beats rekordbox** — libKeyFinder (90% on dance music
  vs rekordbox's ~60%), Camelot tags + harmonic-mix panel (§I51)
- **Full-depth tag schema** — BPM, Initial Key, producer credits, label,
  source, energy, vibe — every DJ-useful frame, idempotently (§J53)
- **Essentia mood & vibe suite** — danceability, valence–arousal, embeddings
  — research-grade, offline, pip-installable (§I45)
- **Structure-aware grids & cues** — intro/drop/outro detection → auto-placed
  memory cues, phrase-aware grids (§I46)

### The agentic layer
- **megadj MCP server** — expose the archive + deckctl as MCP tools so any
  agent can answer "what's on the XZ?" or "run a checksum" with the interlock
  enforced (§O82)
- **Weekly agent prep loop** — headless one-shot that preps the drives on a
  schedule (§O83)

### The dream
- **Hit predictor & set-builder copilot** — calibrated on what actually got
  played; proposes sequences, never auto-exports (§M64, M66)

---

## The pipeline in one command each

```bash
megadj sync                    # GetDat: pull new music
megadj fetch && megadj audit   # FullTags: perfect the metadata
bun run deck                   # CrateDeck: see every drive, sync + verify
```
