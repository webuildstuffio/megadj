# CrateDeck — Architecture

v1 · 2026-09-03 · [Brief](01-product-brief.md) · [PRD](02-prd.md) → **Architecture** → [Build Plan](04-build-plan.md)

---

## 1. Shape

One Bun process, two planes:

```
cratedeck/
  server/     Bun + TypeScript — HTTP API, SSE, detector, job engine, SQLite
  web/        frontend — Vite + Preact + TS, built to static assets the server serves
  shared/     types + protocol shared by both planes
  data/       runtime state (gitignored): SQLite DB, images, benchmarks, logs
  config.toml user config: image provider key, master drive name, port labels
```

`bun run deck` (root package.json script) starts the server on
`127.0.0.1:7742` ("CRates" upside down-ish, mnemonic only) and serves the
built web assets. Dev mode: `bun run deck:dev` runs Vite dev server proxying
API. No auth, no TLS — localhost is the trust boundary.

**Why not reuse usb_sync's Python for everything?** Detection (polling
diskutil/ioreg every 1s), SSE streaming, and a persistent registry are
natural Bun/TS. The deep rekordbox/ANLZ/pdb logic stays in the proven Python
tools, invoked as subprocess jobs. Boundary is explicit: TS owns state +
orchestration; Python owns deep verification. No logic duplicated except two
small ports (ANLZ existence check, pdb live-row count) that are needed for
the *fast* path and are golden-tested against the Python originals.

## 2. Server internals

```
server/
  index.ts            bootstrap: config, db open, detector start, router
  config.ts           config.toml + env, validated
  db.ts               bun:sqlite wrapper, migrations
  detector/
    volumes.ts        diskutil list -plist poll → mount/unmount events
    usb.ts            ioreg USB tree → locationID, port path, serials
    ports.ts          port identity: stable path key + user labels
    index.ts          1s tick, diff, emit events (EventEmitter)
  drives/
    identity.ts       volume UUID → drive record; fallback fingerprint; lineage
    scan.ts           light scan: manifest, sizes, mtimes, folder composition
    rekordbox.ts      DB copy → /tmp, pyrekordbox subprocess read, pdb rows
    anlz.ts           hash-path existence check (TS port, golden tests)
  jobs/
    engine.ts         queue (per-drive concurrency 1), progress, logs, cancel
    verify.ts         usb_verify.py wrapper
    mirror.ts         usb_mirror.py wrapper
    benchmark.ts      pure-TS read bench (seq + 4k random, size-capped)
    checksum.ts       xxhash64 ledger, store + compare modes
    interlock.ts      rekordbox running? → refuse mutations
  api/
    router.ts         route table
    sse.ts            /events stream (drive events, job progress)
    routes/*.ts       drives, drives/:id/detail, search, jobs, ports, config
  io/
    guard.ts          THE write-guard: allow-list of everything server may touch
```

### Detection design

- `diskutil list -plist` every 1s (cheap, ~ms). Diff by disk identifier.
- For each USB volume: `diskutil info -plist <disk>` → VolumeUUID,
  VolumeName, FilesystemType, ContainerTotal/Used, DeviceIdentifier.
- `ioreg -p IOUSB -a -l` (or `system_profiler SPUSBDataType -json`) →
  locationID, product string, serial number, vendor; the port identity is
  the tree path (hub chain + port index) — stable across reboots; locationID
  alone is not (can shift). Map tree paths → user labels from config.
- Mount/insert races: a newly appeared disk may take seconds to mount; emit
  `appeared` then `mounted` separately; drives UI shows "mounting…".
- Eject: listen for volume disappearance (diskutil diff) — do not hook
  DiskArbitration from Bun (native); polling diff is robust and enough.

### Rekordbox read path (never touch the live DB)

1. Copy `PIONEER/rekordbox/exportLibrary.db` (+ `-wal`, `-shm` if present)
   to `data/scratch/<drive>/<ts>/`. Copy is read-safe.
2. `uv run --with pyrekordbox python - cratedeck/server/drives/rb_read.py`
   subprocess (same pattern as the skill scripts) dumps JSON: tracks,
   playlists, counts, dates. Device-library SQLCipher key derivation is
   handled by pyrekordbox — no key material lives in this repo.
3. `export.pdb` live-row count: TS port of `pdb_live_rows` (page-tail walk,
   0x24 stride, presence bitmask, tombstone filter) — validated against
   Python output in tests, plus ground truth from Aug-25 log (3,177).
4. ANLZ existence: for sampled tracks compute the hash folder (TS port of
   `anlz_paths.py`, same golden tests) and stat the ANLZ files.

### Job engine

- SQLite-backed queue: `jobs(id, drive_id, kind, status, progress, log_path,
  created_at, started_at, finished_at, result_json, error)`.
- One job per drive, N drives in parallel; app restart reaps orphans
  (marks `interrupted`, never auto-resumes destructive-ish work).
- Progress from Python tools: parse their stdout milestones (usb_mirror's
  5% lines / progress bar protocol already prints parseable lines).
- Interlock is enforced **inside the engine**, not the UI: before any job
  with `mutating: true` or `touches_drive: true`, `pgrep -x rekordbox` must
  be empty, else `JobError.REKORDBOX_RUNNING`. UI renders locked state from
  the same check via SSE.

### Write guard (the only place disk writes happen)

`io/guard.ts` allow-list: `data/`, `scratch/`, image cache, and — only for
explicit user-approved copy actions (v1.1) — a configured drive path. Every
write goes through it; a unit test walks the codebase and fails if `fs`
write calls occur outside guard usage. This is the enforcement of the
megadj safety religion (never write to drives; never touch DBs live).

## 3. Data model (SQLite via bun:sqlite)

```sql
drives(id TEXT PK,             -- uuid or fingerprint hash
       volume_uuid TEXT UNIQUE, name TEXT, nickname TEXT, photo_path TEXT,
       capacity_bytes INT, fs TEXT, vendor TEXT, model TEXT, usb_serial TEXT,
       role TEXT DEFAULT 'unknown',     -- master|mirror|library|unknown
       first_seen_at INT, last_seen_at INT, plug_count INT,
       mounted INT, predecessor_id TEXT)

mounts(id TEXT PK, drive_id TEXT, port_key TEXT, mounted_at INT, unmounted_at INT)

ports(port_key TEXT PK,          -- stable tree path
      label TEXT,                -- user-facing "Left rear"
      last_drive_id TEXT, last_seen_at INT)

snapshots(id TEXT PK, drive_id TEXT, taken_at INT, kind TEXT,  -- light|full
          data_json TEXT)        -- manifests, playlists, counts, coverage

verifications(id TEXT PK, drive_id TEXT, ran_at INT, verdict TEXT,
              result_json TEXT, job_id TEXT)

benchmarks(id TEXT PK, drive_id TEXT, ran_at INT,
           seq_mbps REAL, rand4k_mbps REAL, bytes_read INT)

checksum_ledger(drive_id TEXT, path TEXT, size INT, mtime INT, xxh64 TEXT,
                first_seen INT, last_ok INT,
                PRIMARY KEY(drive_id, path))

events(id TEXT PK, drive_id TEXT, at INT, kind TEXT, data_json TEXT)

jobs(id TEXT PK, drive_id TEXT, kind TEXT, status TEXT, progress REAL,
     log_path TEXT, result_json TEXT, error TEXT,
     created_at INT, started_at INT, finished_at INT)

settings(key TEXT PK, value_json TEXT)
```

Light-scan snapshots are also re-derivable from ghost cards; DB size kept
sane by pruning > 50 snapshots per drive (keep first, last, and all that
precede a verification).

## 4. API surface (all under `/api`)

```
GET  /drives                      cards (mounted + ghosts, badges)
GET  /drives/:id                  full detail (tabs data)
GET  /drives/:id/timeline         events page
GET  /drives/:id/export           JSON dossier download
POST /drives/:id/name             rename
POST /drives/:id/photo            set from library/{upload,url}
POST /drives/:id/merge            resolve identity collision
GET  /ports                       port tree + labels
POST /ports/:key/label            label a port
POST /drives/:id/jobs             enqueue {kind: scan|verify|mirror|benchmark|checksum}
GET  /jobs?active=1               job tray
GET  /jobs/:id                    status/progress/log tail
POST /jobs/:id/cancel
GET  /search?q=                   cross-drive track/playlist search
GET  /images/search?q=            proxy to configured provider
GET  /events                      SSE: drives, jobs, interlock
GET  /interlock                   rekordbox running? (also pushed via SSE)
```

POSTs are idempotent where meaningful; jobs dedupe per (drive, kind) while
one is already queued/running.

## 5. Frontend

Vite + Preact + TypeScript, ~6 components, no router (one page + drawers):
`DriveCard`, `DriveDrawer` (tabs: Overview / Playlists / Health / Timeline),
`PortMap`, `JobsTray`, `InterlockBanner`, `SearchBox`. SSE client with
auto-reconnect. Design per brief §9: dark, flat, crate-card metaphor, badge
vocabulary READY/STALE/ATTN/GHOST consistent everywhere. State: tiny store
(`@preact/signals`), no Redux-sized ceremony.

Badge logic lives in `shared/badges.ts` — same code server-side (compute)
and client-side (render), so a badge can never disagree with its data.

## 6. Image search providers

```
ImageProvider { search(q): {id, thumb, full, source}[] }
BraveImages(config.key)   — api.search.brave.com/res/v1/images/search
ExaImages(config.key)     — exa /search with image extras
ManualOnly                — always present; UI falls back with a hint
```
Provider chosen by config (`provider = "brave" | "exa"`), key from
`config.toml` or `CRATEDECK_IMAGE_KEY`. Images fetched server-side (no CORS
pain), thumb 512px square + original cached under `data/images/<drive>/`.
Chosen image is permanent — providers never queried again for that drive.

## 7. Config (`cratedeck/config.toml`, gitignored sample committed)

```toml
[server]
port = 7742

[library]
master_drive = "DJMASTER"        # reference for sync status
mirror_drive = "DJMIRROR"

[images]
provider = "brave"                 # brave | exa
# key = "..."                      # or env CRATEDECK_IMAGE_KEY

[jobs]
verify_timeout_min = 30
benchmark_bytes = 536870912        # 512MB
```

## 8. Testing strategy

- **Golden fixtures:** tiny synthetic USB tree (FAT32-shaped) + fixture
  exportLibrary.db (pyrekordbox-created, committed ~20KB) + fixture
  export.pdb snippets → deterministic tests for rekordbox.ts, anlz.ts, pdb
  rows.
- **Cross-validation:** CI job runs TS ports vs Python originals on
  fixtures; byte-equal outputs required (guards the Aug-25 divergence bug
  class forever).
- **Detector:** replay fixtures of diskutil/ioreg output (recorded once per
  real topology change); poller is pure diff logic in tests.
- **Interlock & guard:** pgrep mocked; guard allow-list tested by scanning
  for raw fs writes.
- **E2E:** Bun test against a running server on a fixture data dir; card
  appears → scan → verify(mock) → ghost → history flow.
- Real-drive runs stay manual (the gig drives) — the repo's Python tools
  already have the operational confidence.

## 9. Failure modes & posture

| Failure | Behavior |
|---|---|
| Drive yanked mid-job | job marked interrupted; partial results kept; drive ghosted on next tick |
| rekordbox launched mid-verify | current job allowed to finish (read-only), new jobs refused |
| Image provider down | search returns 502; manual path unaffected |
| SQLite corruption | WAL mode + daily `data/backup.sqlite` copy; images unrecoverable? re-link by UUID, photo re-pick |
| Port labels stale after hub change | port_key unknown → UI prompts "name this port" |
| Server killed mid-scan | scratch dir orphan cleaned at boot; job `interrupted` |

## 10. Security posture

Binds 127.0.0.1 only; no cookies/auth by design; image proxy allow-lists
domains (provider APIs only); uploads size-capped (10MB) and type-checked;
subprocess args never built from user strings (drive ids are UUIDs from our
own DB); API key never sent to the client. The write-guard is the real
security boundary — the app is structurally incapable of writing to a
mounted volume outside an explicit, logged, user-initiated action.
