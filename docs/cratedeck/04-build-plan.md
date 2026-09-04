# CrateDeck — Build Plan

v1 · 2026-09-03 · [Brief](01-product-brief.md) · [PRD](02-prd.md) · [Architecture](03-architecture.md) → **Build Plan**

**Status:** ✅ M0–M5 shipped (v0.1, 2026-09-04) — dashboard live at
`bun run deck`; test suite in `cratedeck/test/` (badges, config, db, guard,
scan-detect, report, e2e). M6 hardening is in progress; the remaining
acceptance evidence lives in [acceptance.md](acceptance.md).

Milestones M0–M6. Each ends runnable + committed. Tests ride along with the
code they cover (no "testing phase" at the end). Estimated with focus and
the existing megadj tooling as leverage: the Python tools already solve the
hard verification problem — we're building the face and the memory.

---

## M0 — Skeleton & spine (foundation)

**Goal:** `bun run deck` serves a page with a list of drives from SQLite,
detection events flow, ghosts persist.

```
cratedeck/
  package.json            name cratedeck, scripts: dev, build, start
  config.sample.toml
  shared/types.ts         Drive, Snapshot, Job, Event, Badge types
  shared/badges.ts        badge computation (shared server/client)
  server/
    index.ts              bootstrap, static serving, /api router, /events SSE
    config.ts             config.toml + env load/validate
    db.ts                 bun:sqlite, WAL, migrations v1 (schema from arch §3)
    detector/volumes.ts   diskutil poll + diff → mounted/unmounted events
    drives/identity.ts    uuid → drive row, first-seen, ghost on unmount
  web/
    index.html  main.tsx  App.tsx (drive grid from GET /drives + SSE)
    DriveCard.tsx         photo/name/badges, ghost styling
```

Tests: db migrations; identity (new/rebind/ghost); detector diff on fixture
plists; badge rules.
**Done when:** a stick plugged/unplugged appears/disappears live, ghost card
remembers after app restart, all on one page.

## M1 — Photo & identity (make cards personal)

**Goal:** search → confirm → persist image; rename; manual upload path.

```
server/images/providers.ts     ImageProvider, BraveImages, ExaImages, proxy route
server/api/routes/images.ts    GET /images/search (provider proxy), POST photo
web/ImagePicker.tsx            modal: search box, grid, confirm; or upload/drag
web/DriveCard.tsx              + rename (inline), photo display
```

Config: `[images] provider/key` (or `CRATEDECK_IMAGE_KEY`). Cache under
`data/images/<drive>/` (thumb + original). No key → picker shows manual
mode with a hint.

Tests: provider contract (mock fetch), cache write, upload type/size guard.
**Done when:** all 8 real drives can be named + photographed in one sitting,
photos survive offline.

## M2 — Rekordbox introspection (the brain)

**Goal:** mounted drive detail = real rekordbox truth.

```
server/drives/scan.ts          light scan: manifest walk, sizes, folder composition
server/drives/rekordbox.ts     THE Python seam: DB copy→scratch, rb_read.py JSON
server/python/rb_read.py       imports skill's anlz_paths.py + pdb_live_rows (canonical)
server/api/routes/drives.ts    GET /drives/:id (detail), /drives/:id/timeline
web/DriveDrawer.tsx            Overview + Playlists tabs
```

Fixtures under `cratedeck/testdata/`: mini FAT32-shaped tree,
`fixture_device.db` (pyrekordbox-created), `fixture.pdb` snippets, recorded
diskutil/ioreg outputs.

Tests: bridge golden tests (rb_read.py JSON vs fixture values incl. the
Aug-25 ground truth 3,177 pdb live rows); scan on fixture tree; zero-write
assertion (drive mtimes unchanged after full scan). No TS ports exist to
test — the Python canonicals are imported, not duplicated.
**Done when:** DJMASTER detail shows correct tracks/playlists/pdb delta;
scans leave drives untouched.

## M3 — Jobs, interlock, sync status (the muscles)

**Goal:** verify/mirror/benchmark/checksum as jobs; rekordbox interlock
enforced; in-sync badges vs master.

```
server/jobs/engine.ts          queue, per-drive concurrency, logs, cancel, orphan reaper
server/jobs/verify.ts          usb_verify.py wrapper (progress from stdout)
server/jobs/mirror.ts          usb_mirror.py wrapper
server/jobs/benchmark.ts       pure-TS seq+4k read bench (capped)
server/jobs/checksum.ts        xxhash64 ledger (store + compare)
server/jobs/interlock.ts       pgrek rekordbox → refuse; pushed via SSE
server/api/routes/jobs.ts      enqueue/status/cancel + jobs tray feed
server/drives/syncstatus.ts    master diff → IN SYNC / BEHIND / DIVERGED
web/JobsTray.tsx  InterlockBanner.tsx  DriveDrawer health tab (space treemap, bench sparkline)
```

Tests: engine lifecycle incl. yank-mid-job; interlock refusal (mocked pgrep);
benchmark determinism on tmpfs fixture; checksum bitrot detection (flip a
byte in fixture); syncstatus on fixture manifests (superset tolerance).
**Done when:** with rekordbox open everything is visibly locked; closed, a
verify runs to a verdict badge; DJMIRROR badge matches a manual
`usb_mirror --verify-only`.

## M4 — Ports, timeline, search (the world model)

**Goal:** port map, per-drive timeline + export, cross-drive search.

```
server/detector/usb.ts + ports.ts   ioreg tree, stable port keys, labels
server/api/routes/ports.ts          GET /ports, POST label
server/drives/timeline.ts           events feed (already being written by M0–M3)
server/api/routes/search.ts         cross-drive search over snapshots
web/PortMap.tsx  Timeline.tsx  SearchBox.tsx  DriveDrawer (timeline tab)
```

Tests: port key stability across fixture topology variants; timeline
ordering; search hit on ghost snapshot; export JSON round-trip.
**Done when:** "which stick has a given playlist and when was it last plugged in?" is
one search away, with the answer's port labeled.

## M5 — Polish, dossier, radar (the 10x coat)

**Goal:** feel + the nearly-free extras.

- New-music radar (megadj archive.db vs drive snapshots) + copy-sync-command
- Gig mode (out-for-gig note) + dossier one-pager (print-styled HTML)
- Badge finalization (READY/STALE/ATTN/GHOST rules, `shared/badges.ts`)
- UI pass: dark flat theme, card hierarchy, empty/loading states, keyboard
  (⌘K search), favicon, `bun run deck` one-liner in root README
- Perf: light scan ≤ 5s on 4k files; page interactive < 1s; SSE reconnect

Tests: badge matrix table-test; radar diff correctness; dossier snapshot
render. **Done when:** REDACTED's actual 8 drives all show correct real-world
state on one screen, and the workflow "glance → act only when not green"
works without opening a terminal.

## M6 — Hardening & docs

- Boot-time orphan cleanup; SQLite backup rotation; log rotation
- Failure-mode table from architecture §9 each gets a test
- Update repo README + docs/usb-sync.md to point at CrateDeck; ops-log entry
- Tag `cratedeck-v0.1.0`

**Done when:** kill -9 at random points never corrupts state; docs make a
cold-start obvious; the tool has survived one real sync cycle.

---

## Sequencing & parallelism

M0 → M1 → M2 are strictly sequential (spine → identity → truth).
M3 and M4 can interleave after M2. M5/M6 last. A second agent could take M4's
port/timeline track while M3 is in flight, merging via `shared/types.ts` —
but one agent end-to-end is fine given the repo context lives in one head.

## Definition of done (per feature, from PRD)

Every PRD acceptance checkbox gets either a test or a manual checklist item
recorded in `docs/cratedeck/acceptance.md` as milestones land.

## Out of scope guardrails (say no to scope creep)

No write-actions to drives beyond explicit user-approved copy (v1.1+), no
auth/cloud/multi-user, no non-macOS, no rekordbox Mac-library editing, no
replacing the Python tools — wrap them.
