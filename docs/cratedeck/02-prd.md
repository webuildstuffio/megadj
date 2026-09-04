# CrateDeck — PRD

v1 · 2026-09-03 · [Brief](01-product-brief.md) → **PRD** → [Architecture](03-architecture.md) → [Build Plan](04-build-plan.md)

This doc turns the brief into concrete, testable features. Every feature has
an ID used by the architecture and build plan.

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

**Acceptance:**
- [ ] Plug a never-seen stick → card appears within 2s, persisted across
      restarts of the app and across unplug.
- [ ] Unplug it → card becomes ghost with last-known data + timestamp.
- [ ] Two identical empty sticks get distinct identities via UUID.
- [ ] Reformatting a stick (new UUID) creates a new drive; old card remains
      as an archived predecessor (lineage link), never silently merged.

## F2 — Live detection & port map

**What:** poll the macOS USB + volume state (diskutil + ioreg; see
architecture). Changes emit events: `mounted`, `unmounted`, `port_changed`.
Physical port identity comes from the USB topology path
(`AppleUSB20XHCIPort` / locationID) mapped to stable port names the user can
label ("MBP left rear", "hub slot 2").

**Acceptance:**
- [ ] Mount/unmount reflected in UI ≤ 2s (poll interval 1s).
- [ ] Port map page shows a tree: Mac → bus → hub → labeled ports, drives
      in their current slots, history of which drive was where.
- [ ] Hub-attached sticks resolve to the hub port, not the Mac root.

## F3 — Photo identification & naming

**What:** each drive gets a human name ("OLDBACKUP", "Party Crate") and a
photo. Sources:
1. **Product image search** — type a model, get an image grid. Provider
   abstraction with two implementations: Brave Image Search and Exa; the
   active provider + API key live in `cratedeck/config.toml` or env. No key?
   UI says so and still allows manual.
2. **Manual** — file picker, drag-drop, or paste URL.

Images are downloaded, normalized (square thumb + original), stored under
`cratedeck/data/images/<uuid>/`, and never re-fetched.

**Acceptance:**
- [ ] Search "SanDisk Ultra Fit 128GB" with a configured key → ≥ 8 results,
      click to confirm → photo persists on the card forever (offline OK).
- [ ] No API key → manual upload path fully works.
- [ ] Rename anytime; history keeps old names.

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

**Acceptance:**
- [ ] DJMASTER detail matches known ground truth: 3,054+ core tracks,
      YTMusic Liked playlist, party folder tree, pdb vs OneLibrary delta.
- [ ] Zero writes to the drive during any scan (tests assert mtime/bytes
      unchanged).
- [ ] SQLCipher read works without the key present in any repo file
      (pyrekordbox handles device key derivation; see architecture).

## F5 — Sync status vs master

**What:** for each mounted drive, diff against the master definition
(DJMASTER or a configured reference):
- audio file manifest diff (new/missing/variant counts — reuse manifest
  logic from usb_mirror)
- DB parity: track/playlist counts
- ANLZ parity: hash spot-check sample + full option
- verdict: `IN SYNC` / `BEHIND (n files)` / `DIVERGED` / `UNKNOWN (stale scan)`

**Acceptance:**
- [ ] DJMIRROR reads IN SYNC or BEHIND with exact counts, matching a
      manual `usb_mirror.py --verify-only` run.
- [ ] Superset tolerance: extra mirror-only files don't fail the badge
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

**Acceptance:**
- [ ] Job lifecycle: queued → running (progress %, MB/s, ETA) → done/failed
      with persisted log; survive page reloads; one job per drive at a time.
- [ ] With rekordbox running, every mutating job is refused at the API and
      rendered locked in UI. Read-only scans also refuse (they copy DBs —
      technically safe but surprises kill drives; policy: all off).
- [ ] Benchmark numbers persist and render as history.

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

**Acceptance:**
- [ ] A deliberately zero-byte'd file in a test fixture surfaces as ATTN
      with the exact path.
- [ ] Case-collision detector reproduces the Aug-25 phantom-missing-file
      class of bug on synthetic fixtures.
- [ ] Badge rules documented and unit-tested (not vibes).

## F8 — Timeline & history

**What:** append-only event log per drive: mounted/unmounted (with port),
scans, verify/mirror/benchmark/checksum runs + results, name/photo changes,
sync-state transitions. UI: per-drive timeline tab + global "recent activity"
feed. Export: JSON dump button per drive (the "save details from last known
time" requirement — ghosts are exportable).

**Acceptance:**
- [ ] Any question "what happened to this stick?" answerable from the
      timeline with timestamps.
- [ ] Export JSON re-imports on a fresh machine.

## F9 — One-page cockpit UI

**What:** single page, dark, flat:
- top bar: rekordbox interlock banner, global activity pulse, search
- shelf: all drives as crate cards — photo, name, badges (role, capacity,
  in-sync, readiness, grids %), ghost cards dimmed
- click a card → detail drawer (F4/F5/F7/F8 tabs)
- side: port map mini-tree; jobs tray with live progress
- global search: tracks/playlists across all known drives incl. ghosts

**Acceptance:**
- [ ] All 8 real drives visible on one screen at 1440×900 without scrolling
      (grid adapts).
- [ ] Search a playlist name returns every drive holding it, ghost or not.
- [ ] Interlock banner appears within 2s of rekordbox launching; job buttons
      disable instantly.

## F10 — Extras that fall out nearly free

- **New-music radar:** megadj archive DB (`~/.local/state/megadj/archive.db`)
  vs each drive — "12 downloaded tracks not on DJMASTER" + button to copy
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
