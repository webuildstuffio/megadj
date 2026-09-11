# CrateDeck — PRD

v1 · 2026-09-03 · Brief merged into this doc (Sep 9 cleanup) · **PRD** → [Architecture](03-architecture.md) · [Acceptance](acceptance.md)

**Status:** ✅ Core shipped (v0.1, 2026-09-04) — F1–F9 implemented in
`cratedeck/` (registry, detection, images, rekordbox introspection via the
Python seam, jobs + interlock, health reports, timeline, search, cockpit UI);
health report is the newest addition (`src/report.ts`, `GET /drives/:id/report`).
Acceptance evidence per feature: [acceptance.md](acceptance.md). Remaining
v1.x items (gig mode, radar, dossiers UI) are tracked in
[../../ideas.md](../ideas.md).

This doc is the product + feature SSOT for CrateDeck. Every feature has an
ID used by the architecture and acceptance evidence. All F1–F9 shipped in
v0.1 (2026-09-04) — every feature's acceptance evidence lives in
[acceptance.md](acceptance.md); the four still-manual items are
real-hardware checks listed there.

---

## The problem, honestly

A working DJ owns a shelf of USB drives that carry gig-critical rekordbox
libraries. Right now the only ways to answer "what's on this stick and is it
healthy?" are:

1. Plug it in, open Finder, squint.
2. Open rekordbox (slow, and it mutates DBs just by looking).
3. Ask an agent to run the megadj verify scripts by hand.

None of these answer the real questions fast:

- Which drive is this? (they all look the same in a drawer)
- Is it in sync with the master library?
- Does every track have a beatgrid, or will the XZ show nothing?
- When did I last verify it? Did anything corrupt since?
- Which physical port is it in, and does that matter?

The megadj repo already solved the _hard_ half — byte-accurate rekordbox
device-library reads, ANLZ validation, hardware-gate verification, mirror
tooling. What's missing is a **face**: a single always-on page that turns
that machinery into something you can glance at.

## Vision

> A local web page that shows every drive you've ever plugged in as a card —
> with its photo, its name, its playlists, its health, its sync state, its
> history — even when it's unplugged. Plug a stick in and it lights up.
> Unplug it and it becomes a ghost that remembers everything.

One command (`bun run deck`), one page, zero accounts, localhost only.

## Who it's for

**Primary user:** a working DJ — one person, multiple venues' worth of gear,
values glanceability over configuration, allergic to busywork. This is not a
SaaS; it's the cockpit of a one-DJ operation. Secondary: any visiting DJ who
borrows a stick and needs to know what's on it in 5 seconds.

## Personality & feel

Playful-pro DJ tool, not enterprise storage admin. Drive cards feel like
record crates: big photo, sticker-like badges (READY / STALE / GHOST / /!\
ATTN), a "spinning" state while jobs run. Flat design, no gradients, dark
default. Copy is terse and confident ("Last verified 2d ago — clean").
Status colors: green ready, amber stale, red attention, gray ghost.

## Kill criteria

If the registry/ghost layer doesn't earn its keep within two real gig cycles
(drives still getting mixed up), simplify to a verify-badge page only.

---

## F1 — Drive registry & ghost persistence (the spine)

**What:** a local registry of every USB drive ever detected. On first sight
of a volume, CrateDeck creates a `drive` record: volume name, volume UUID
(macOS `diskutil info -plist`), capacity, filesystem, device serial when
exposed, first-seen timestamp. On every subsequent sighting it updates
`last_seen_at`, increments `plug_count`, and appends an event.

**Ghost mode:** when a drive is not mounted, its card stays visible, dimmed,
rendered from last-known snapshot data: contents summary, playlists,
readiness badge as of last verify, "last seen 6d ago via port Left-rear".

**Identity:** primary key = volume UUID. Fallback fingerprint when UUID is
missing (cheap sticks): `name + capacity + fs`. Collisions resolve through a
manual merge dialog ("is this the same drive as X?").

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      restarts of the app and across unplug.

- [x] Unplug it → card becomes ghost with last-known data + timestamp.
- [x] Two identical empty sticks get distinct identities via UUID.
- [x] Reformatting a stick (new UUID) creates a new drive; old card remains
      as an archived predecessor (lineage link), never silently merged.

## F2 — Live detection & port map

**What:** poll the macOS USB + volume state (diskutil + ioreg; see
architecture). Changes emit events: `mounted`, `unmounted`, `port_changed`.
Physical port identity comes from the USB topology path
(`AppleUSB20XHCIPort` / locationID) mapped to stable port names the user can
label ("MBP left rear", "hub slot 2").

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      in their current slots, history of which drive was where.

- [x] Hub-attached sticks resolve to the hub port, not the Mac root.

## F3 — Photo identification & naming

**What:** each drive gets a human name ("Resident Crate", "Weekend Banger") and a
photo. Sources:

1. **Product image search** — type a model, get an image grid. Provider
   abstraction with two implementations: Brave Image Search and Exa; the
   active provider + API key live in `cratedeck/config.toml` or env. No key?
   UI says so and still allows manual.
2. **Manual** — file picker, drag-drop, or paste URL.

Images are downloaded, normalized (square thumb + original), stored under
`cratedeck/data/images/<uuid>/`, and never re-fetched.

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      click to confirm → photo persists on the card forever (offline OK).

- [x] No API key → manual upload path fully works.
- [x] Rename anytime; history keeps old names.

## F4 — Drive detail: full rekordbox introspection

**What (mounted):** read-only parse of the device library (working copy in
/tmp, never the live DB — the skill's rule, enforced in code):

- track count, total duration, per-folder composition (genre/artist dirs)
- playlists: names, entry counts, parents (folder tree)
- coverage: % tracks with ANLZ present at hash-computed path
  (canonical `anlz_paths.py`, imported by the Python bridge), % with
  beatgrid (PQTZ), % with waveform (PWAV)
- OneLibrary vs legacy `export.pdb` live-row counts (canonical
  `pdb_live_rows` from `usb_verify.py`, imported by the bridge) — the
  hardware gate
- DB last-modified, export.pdb last-written, rekordbox running? (interlock)

**What (ghost):** last cached snapshot with an "as of" stamp; a "rescan"
button appears only when mounted.

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      playlists, pdb vs OneLibrary delta.

- [x] Zero writes to the drive during any scan (tests assert mtime/bytes
      unchanged).
- [x] SQLCipher read works without the key present in any repo file
      (pyrekordbox handles device key derivation; see architecture).

## F5 — Sync status vs master

**What:** for each mounted drive, diff against the master reference
(configured in `config.toml`):

- audio file manifest diff (new/missing/variant counts — reuse manifest
  logic from usb_mirror)
- DB parity: track/playlist counts
- ANLZ parity: hash spot-check sample + full option
- verdict: `IN SYNC` / `BEHIND (n files)` / `DIVERGED` / `UNKNOWN (stale scan)`

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      manual `usb_mirror.py --verify-only` run.

- [x] Superset tolerance: extra mirror-only files don't fail the badge
      (configurable strictness).

## F6 — Jobs: verify, mirror, benchmark, checksum

**What:** long operations run as background jobs with progress, log tail,
and history. Wrappers around the existing Python tools:

- `verify` — `usb_verify.py --drives <d>` (the 10x gate)
- `mirror` — `usb_mirror.py` (master→mirror)
- `benchmark` — read test: sequential (dd-style, capped 512MB) + random
  4k; stores MB/s with timestamp → sparkline per drive
- `checksum` — xxHash ledger of all audio files; stored; subsequent runs
  detect changed/corrupt files (bitrot ledger)

**Interlock (hard rule):** before spawning any job that touches a drive,
check `pgrep rekordbox`; if running, the API refuses with
`REKORDBOX_RUNNING` and the UI shows the jobs as locked with a red banner.
Verify/mirror additionally refuse if the target drive is the wrong role
(mirror run on master, etc.) unless overridden in config.

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      with persisted log; survive page reloads; one job per drive at a time.

- [x] With rekordbox running, every mutating job is refused at the API and
      rendered locked in UI. Read-only scans also refuse (they copy DBs —
      technically safe but surprises kill drives; policy: all off).
- [x] Benchmark numbers persist and render as history.

## F7 — Health & corruption

**What per drive:**

- space: capacity/used/free + treemap of `Contents/` top folders
- benchmark history (F6) with trend arrow
- bitrot ledger: files changed since last checksum run, benign (tags) vs
  suspect (random bytes) via re-hash
- FAT32 sanity: orphaned `._*` resource-fork files count, case-collision
  detection (NFC+casefold — the skill's rule), zero-byte files
- SMART (optional, when supported): via `smartctl` if installed; absent →
  show "n/a" not a failure
- verdict badge: READY / STALE (verify old / changes since) / ATTN
  (corruption signals) / GHOST (unplugged)

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      with the exact path.

- [x] Case-collision detector reproduces the Aug-25 phantom-missing-file
      class of bug on synthetic fixtures.
- [x] Badge rules documented and unit-tested (not vibes).

## F8 — Timeline & history

**What:** append-only event log per drive: mounted/unmounted (with port),
scans, verify/mirror/benchmark/checksum runs + results, name/photo changes,
sync-state transitions. UI: per-drive timeline tab + global "recent activity"
feed. Export: JSON dump button per drive (the "save details from last known
time" requirement — ghosts are exportable).

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      timeline with timestamps.

- [x] Export JSON re-imports on a fresh machine.

## F9 — One-page cockpit UI

**What:** single page, dark, flat:

- top bar: rekordbox interlock banner, global activity pulse, search
- shelf: all drives as crate cards — photo, name, badges (role, capacity,
  in-sync, readiness, grids %), ghost cards dimmed
- click a card → drive page in the main canvas (F4/F5/F7/F8 tabs); the
  drive shelf stays visible as a left rail (Sep 2026 redesign — no drawer)
- side: port map mini-tree; jobs tray with live progress
- global search: tracks/playlists across all known drives incl. ghosts

**Acceptance:** evidence in [acceptance.md](acceptance.md).

      (grid adapts).

- [x] Search for a playlist name returns every drive holding it, ghost or not.
- [x] Interlock banner appears within 2s of rekordbox launching; job buttons
      disable instantly.

## F10 — Extras that fall out nearly free

- **New-music radar:** megadj archive DB (`~/.local/state/megadj/archive.db`)
  vs each drive — "12 downloaded tracks not on the master" + button to copy
  the sync command (v1: copy; v1.1: run as job).
- **Gig mode:** one click marks a drive "out for gig" (plugged at a venue —
  date + note); timeline shows its tour history.
- **Drive dossier:** printable/HTML one-pager per drive (the 5-second
  "what's on this?" answer for a borrowed stick).
- **Age & wear estimates:** first-seen date, TB written estimate (from
  mirror/benchmark runs), write-cycle naivety shown honestly as estimate.

## Non-functional requirements

- **Localhost only.** Server binds 127.0.0.1. No telemetry, no external
  calls except configured image-search provider.
- **Read-only guarantee:** the app never writes to mounted volumes'
  rekordbox paths; its only disk writes are its own data dir + explicit
  user-initiated copies. Enforced by a single IO module with allow-lists +
  tests.
- **Performance:** page interactive < 1s; mount detection ≤ 2s; light scan
  (manifest+DB mtimes) ≤ 5s on 4k-file drive; deep verify is a job, not a
  page load.
- **Robustness:** app restart keeps all state (SQLite + files); a killed
  job resumes-or-fails-clean; drives yanked mid-job handled gracefully.
- **Stack:** Bun + TypeScript end to end; SQLite via `bun:sqlite`; no
  heavyweight frameworks — Vite+Preact or plain DOM. Python reused via
  subprocess only for deep tools.

## Metrics (self-hosted, from the event log)

- time-to-identify a drive (target: glance, < 5s)
- % drives with readiness badge fresher than their last change (target: 100%)
- bitrot caught before a gig (any catch is a win)
- registry completeness: named + photographed drives / total (target: 8/8)
