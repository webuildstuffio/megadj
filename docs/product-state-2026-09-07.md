# megadj — Product & Roadmap State

**Status:** ✅ CURRENT — the honest state of the whole product as of
2026-09-11 (Sep 11 intake folded in), project by project, with the roadmap
as it stands now (not as it was proposed). Durable meta-lessons from the
Sep 5–7 build window live in [agent-playbook.md](agent-playbook.md)
§Meta-lessons; this page is the "where are we". It owns current status and
metrics; other docs should link here rather than duplicate them.

---

## The one-paragraph answer

megadj is a three-project pipeline — **GetDat** (download) → **FullTags**
(enrich) → **CrateDeck** (organize/verify/sync) — run by one person on one
Mac, feeding a shelf master (the archive-grade HDD that never leaves the
desk) plus a master + mirror pair of Pioneer-format DJ USBs. All three
cores are shipped and _measured_: the archive's 131 ledgered tracks (the
88-track original plus the three Sep 10/11 intake batches) are fully
processed — fingerprint, key, mood, energy in the files; beats, phrase
cues, mood mirrors in the DB (cues 2,043 markers); the write-gate
discipline has passed one ladder
(key, 80.7%) and blocked two others (BPM phase-lock, saturated genre head)
— which is the system working. CrateDeck finished its gig-night gate
(preflight, player-compat verdicts) and its agent surface (37-tool MCP
server, weekly digest, notes feed, plugin). What remains is deliberately
sequenced: two operational tasks (the rekordbox key gauntlet, the §0
backup/evacuation items) and a short list of next builds (memory-cue
writes, vocal density, similarity, the C18a runbook).

```
GetDat ──▶ FullTags ──▶ CrateDeck ──▶ the booth
download    perfect       organize, verify,     play on
& archive   metadata      sync DJ USB drives    Pioneer
```

## State by project

### 🗄️ The shelf master — **first full archive sweep complete (Sep 9 2026)**

The 4 TB shelf HDD (config `library.shelf_drive`, default `SHELF1`) is now
the strict archive of every DJ drive: the master stick's full `Contents/` +
`PIONEER/` analysis, plus the Sep 9 three-stick sweep (BANGERS library
1,452/1,452 files byte-verified, 5 rescued mixes, one empty stick
confirmed empty) and the second Sep 9 sweep (BACKUP2: 2,259/2,259 — 2,023
covered, 234 preserved as `[BACKUP2]` twins, 179 fresh, 4.87 GB;
1GB Yellow confirmed empty). Divergent rips are preserved as
`[drive]`-suffixed twins
— dedupe is a later, human-gated pass. The sweep is now one command:
`megadj shelf-archive [volume …] [--trashes] [--deep]` (additive,
junk-filtered, MD5-verified, `--json` verdict; log:
[usb-sync-log.md](usb-sync-log.md)). Every sweep auto-records a
`shelf_sweeps` row in the archive DB — `megadj shelf-sweeps` prints the
latest verdict per drive — so coverage state is queryable, not just
markdown. rekordbox's master DB lives on the
shelf (`PIONEER/Master/master.db`) — SHELF1 must be attached for
rekordbox to open.

**Archive tier ≠ gig tier (Sep 10, role-aware checks):** the shelf is
STORAGE — its empty `PIONEER/rekordbox/` tree is correct and no device
export is ever needed. The check stack derives from one typed table,
`cratedeck/shared/check_matrix.ts` (SSOT; mechanics and war story:
[agent-playbook.md](agent-playbook.md) §Rekordbox detail). A shelf card
shows only archive-relevant checks and reads "master library lives here ·
sticks sync from this"; a FAILED verify shows on every tier until re-run.

### 🎧 GetDat — download & archive — **core shipped, single-source**

- **Working today:** `megadj sync` from YouTube Music (liked songs,
  playlists) — 256 kbps-first with graceful fallback, polite pacing,
  permanent-failure classification, SQLite state so nothing ever
  re-downloads; `LOWQ` flag on <250 kbps. `megadj ingest` for external
  folders (probe/score/quarantine, zip expand-delete, MusicBrainz fill,
  WAV→AIFF conversion). Three fix-all rounds this window closed 21 bugs
  (sync/downloader, fetch/audit/artwork/enrich), each with a regression
  test.
- **Measured state:** the archive DB is the pipeline's spine — tracks,
  beats, mood, cues, and runs tables all live and populated; the audit
  gate (now requiring mood + energy) passes 123/123 on the Sep intake.
- **The gap:** one source. SoundCloud is config work (yt-dlp impersonation
  landed upstream in Feb 2026); Bandcamp is blocked upstream (yt-dlp
  #17506). The quality ratchet is real: `megadj upgrade` (D24) re-fetches
  below-floor (LOWQ) tracks at best quality and swaps ONLY when the new
  file probes at the expected bitrate AND carries the same acoustic
  fingerprint — a different recording is refused, the old file never
  leaves on failure (regression-tested in `src/commands/upgrade.test.ts`).

### 🏷️ FullTags — enrich — **the analysis ladder executed; gates did their job**

- **Working today:** one schema (`FullTag`/`TagPatch`), one atomic writer
  (mp3/m4a/wav/flac/aiff, all format gotchas), file-first ground-truth
  readers, the full art ladder, four-vote genre ladder, AI conf-gated
  fallbacks with provenance stamps, standalone CLI + `audit --json`
  gate — and the offline analysis stages: chromaprint fingerprints,
  beat_this BPM, OpenKeyScan key, Essentia ONNX mood/dance/valence,
  energy 2.0 blend, MusicBrainz folksonomy harvest. 98 tests across 11
  files; megadj's commands are thin shims over it.
- **Measured state (the real archive — 131 ledgered tracks; the audit
  gate currently covers the 123-track Sep intake at 123/123):**

  | Ledger / field              | Where                | Coverage                   |
  | --------------------------- | -------------------- | -------------------------- |
  | Fingerprint (TXXX:ACOUSTID) | in files             | 131/131, idempotent        |
  | Key (TKEY + TXXX:CAMELOT)   | in files             | 131/131, gate-passed 80.7% |
  | Beats + downbeats           | archive DB `beats`   | 131/131                    |
  | Mood/dance/VA (TXXX:MOOD)   | in files + DB mirror | 131/131, idempotent        |
  | Energy 2.0 (TXXX:ENERGY)    | in files             | 131/131                    |
  | Phrase cues (8-bar)         | archive DB `cues`    | 131/131 → 2,043 cues       |

- **Blocked on purpose:** TBPM tag writes (beat_this phase-locks
  ~2.2–2.6% off RB; re-gate 16/24 < 80%) and genre-head writes
  (saturated 0.87–1.0 on every genre; no ONNX export of the effnet head
  exists upstream anyway). Both verdicts are wins of the gate system,
  and both fields already deliver their value DB-side.
- **The gap:** structure labels (all-in-one-infer) and vocal density
  (demucs) — the next analysis stages, both gated the same way;
  similarity (sqlite-vec over the fingerprint ledger).

### 📼 CrateDeck — organize, verify, sync — **v0.1 + gig-night gate + agent surface**

- **Working today:** the dashboard (registry + ghosts, photos, ports,
  timeline, health reports, dossier export), the fleet superpowers
  (coverage matrix, redundancy audit, drive diff), automation
  (mount → light scan, weekly auto-verify), the deep verify gate
  (dual-DB agreement, audio existence, ANLZ-at-hash-path, grid math,
  playlist integrity, cross-drive parity), the rekordbox interlock
  (exit code 3, enforced client + server side), `deckctl` CLI — and the
  new gig-night/agent layer: **B12 preflight** (worst-status-wins
  verdict, exit 1 for cron/agents), **N75/N78 player-compat verdicts**
  (public Pioneer matrix × measured dual-DB rows), **N76 firmware
  advisories**, **O83 weekly digest** (`deckctl prep`), the
  **37-tool MCP server** (22 `deck_*` + 15 `archive_*`, readonly archive
  handle), **O87 attribution**, **O88 notes feed**, and the **O85
  plugin** packaging. Three fix-all rounds closed 14 CrateDeck bugs
  (progress/ETA/regexes/role-inference/SSE storms) with regression tests;
  the knip gate now blocks dead exports.
- **Measured state:** 27 server TS files, 37 MCP tools (census-verified),
  snapshots capped 20/drive, events 2000/drive; `overall()` never fakes
  healthy; bitrot verdicts come only from real checksum runs.
- **The gap:** three acceptance items need one real-hardware session
  (mirror-badge ground truth, detail-vs-known counts, 1440×900 one-screen);
  M6 SIGKILL resilience and retention caps are now regression-tested, while
  the `cratedeck-v0.1.0` tag remains a separate release task. C18a assisted
  legacy-export runbook and C21/C22 differential mirror + one-click sync
  are the remaining Move-1 builds.

### 🤖 The agent surface — **first-class, both halves**

The O-layer goal — "agents are first-class operators" — is substantively
done: `bun run mcp` exposes the whole product (37 tools) over stdio
JSON-RPC with readonly annotations, mutating-tool flags, and the interlock
in the tool layer; the archive half reads megadj's own DB through a
physically readonly handle; every job carries attribution; `deckctl prep`
gives headless loops a digest; the plugin installs the whole surface into
Claude Code (`claude plugin validate` passes). Open remainder: **O84**
(the inbox-to-crate agent on top of `megadj drop`, which shipped Sep 7)
and the optional `claude -p` cron wrapper for the weekly digest.

---

## The roadmap, as it stands now

The proposal's three moves, honestly re-scored after the window:

| Move                                          | Was proposed                                            | Actually happened                                                                                                                                                                    | What's left                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **1 — Harden the moat** (CrateDeck v1.x)      | preflight, player verdict, runbook, differential mirror | preflight ✅, player verdict ✅, firmware notes ✅, automation ✅, ⌘K ✅                                                                                                             | **C18a** assisted legacy-export runbook · **C21/C22** differential mirror + one-click sync · the 4 hardware-acceptance items |
| **2 — Complete the metadata** (FullTags v1.x) | key → BPM → fingerprints → moods, gated                 | **all five P1 items executed**: key ✅ written, fingerprints ✅, mood ✅, BPM → pivoted to beats ledger ✅, MB genre harvest ✅ — two write-gates failed honestly and stayed blocked | structure labels (gated) · vocal density · similarity · **RB key gauntlet** (operational)                                    |
| **3 — Agentify** (the O layer)                | MCP server, safety rails, weekly loop                   | **both MCP halves ✅** (37 tools), rails ✅, attribution ✅, notes ✅, prep ✅, plugin ✅                                                                                            | **O84** inbox-agent · `claude -p` digest cron · (K61 `megadj drop` underneath it)                                            |

The original 90-day line collapsed: "Weeks 3–5" (key/BPM) and "Weeks 5–7"
(fingerprints) happened in one evening once the gates were built, and
"Weeks 10–13" (O82b/O83) shipped within the same window. The line is no
longer time-boxed by the proposal — it's ordered by the queue below.

### The queue, in order

1. **SHELF1 dedupe pass** (new, do it while the sticks are fresh in mind):
   390 `[bangers]` twins + 291 same-size/different-bytes pairs await
   fingerprint-verified verdicts — compare quality, keep one, move the
   other to the archive. Never delete without explicit OK.
2. **RB key gauntlet — next drive mount, do it FIRST** (30 s): disable
   Key analysis → Reload Tags → verify TKEY survives. Keys are in the
   files; this is what makes them durable. Everything else on drives
   waits for this.
3. **§0 survival items** (they outrank all building, per ideas.md):
   0a SSD evacuation · 0c orphan verdict · 0b cold backup · 0d
   redundancy data (one real scan per drive closes issue #4 too).
4. **rekordbox memory-cue WRITE pass** — phrase cues from the ledger
   onto hardware, behind the interlock + gauntlet (the deliberate next
   gate).
5. **Vocal density** (demucs-infer, ~3 s/track) → **similarity**
   (sqlite-vec over the 88-fingerprint ledger; MuQ-MuLan as the
   embedding step-up).
6. **C18a runbook → C21 differential mirror → C22 one-click sync**
   (finishes Move 1).
7. **O84 inbox-to-crate agent** on top of `megadj drop` (K61) — the
   last O-item that needs new code.
8. **Palate cleansers whenever:** M69 format cmd, M70 litter clean,
   M71 port-speed badge, M74 playlist exporter.

### Parked / blocked (standing decisions, not open questions)

- **TBPM writes** — blocked until the phase-lock class is fixed upstream
  (watch `livechord-beat-refiner`); the beats ledger already delivers the
  value.
- **Genre-head writes** — blocked (saturated head, no ONNX export
  upstream); genres already come from SC/MB votes.
- **C18b/c legacy-pdb writes** — parked with a written gauntlet; the
  asymmetry still says don't.
- **Struck:** Engine DJ, Serato (P2: Pioneer only); I52 affinity model;
  synced lyrics; setlist.fm.
- **§H non-goals unchanged:** no cloud, no accounts, no telemetry, no
  mobile, no general DJ-library manager, no aggressive scraping.

---

## Scorecard (proposal §7, re-measured)

| Metric                       | Target                                 | Now                                                                                                                                                                     |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata completeness        | 100% art/title/artist/album/genre/year | ✅ 123/123 on the Sep intake under the upgraded audit gate (also requires mood + energy); 131 ledgered total                                                            |
| Key accuracy vs ground truth | ≥80% agreement                         | ✅ 80.7% measured on all 88 — and written                                                                                                                               |
| Grid agreement               | >98%                                   | Independent cross-check shipped (46 ok / 40 off / 2 octave vs beat_this); the >98% bar properly applies to RB-native grids after re-analysis — honest: not yet measured |
| Gig-day answer time          | <60 s, one click                       | preflight ✅ shipped; latency unmeasured until the first real hardware session                                                                                          |
| Mirror cost                  | weekly mirror in minutes               | mirror + verify shipped (`usb_mirror.py`); C21's differential changed-only pass unstarted                                                                               |
| Hands-off reliability        | weekly digest, zero triggers           | `deckctl prep` ✅; cron wrapper optional, not wired                                                                                                                     |
| Redundancy                   | every gig playlist ≥2 drives           | engine ✅; live verdicts await real scans per drive                                                                                                                     |
| Zero manual labour           | ingest→tagged→staged hands-free        | ✅ `megadj drop` shipped Sep 7 (download → ingest → beats → mood → cues → organize, one command)                                                                        |

**Verdict:** Move 2 is functionally complete (with two honest blocks),
Move 3 is functionally complete (with O84 left), Move 1 is two builds +
one hardware session from done. The product's center of gravity has
shifted from _building capabilities_ to _operating them_ — the next
sessions are about hardware truth (gauntlet, acceptance items, real
scans) and the last glue (C18a/C21, O84).

---

_Evidence: [fulltags-roadmap.md](fulltags-roadmap.md)
rev 6.2 (gates + execution log) ·
[archive/roadmap-proposal.md](archive/roadmap-proposal.md) (the executed
three-move proposal this page re-scores) · [ideas.md](ideas.md) §0 (the
gate that outranks all of it)._
