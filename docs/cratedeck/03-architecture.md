# CrateDeck — Architecture

v2 · 2026-09-03 · [Brief](01-product-brief.md) · [PRD](02-prd.md) → **Architecture** → [Build Plan](04-build-plan.md)

> v1→v2 changes: killed the TS ports of `pdb_live_rows`/ANLZ hashing (that's
> the divergence bug class that bit us Aug-25 — one Python seam instead of
> two implementations), collapsed ~25 server files into 10, replaced the 1s
> poll loop with FSEvents-on-/Volumes + lazy detail, merged detector into one
> module and the Python boundary into one module.

---

## 1. Shape

**One Bun process, one Python seam, one page.**

_Note (2026-09-05 audit): the original 10-file server has grown to 19 TS
files in `src/` (`report.ts`, `images.ts`, `fleet.ts`, `fleet-db.ts`,
`deckctl.ts`, `auto_schedule.ts`, `verify_help.ts`, `walk.ts`, `badges_view.ts`;
`fmt.ts` moved to shared; `python/usb_tree.py` added); the single-seam,
guard, and downward-dependency rules are unchanged and still hold._

```
cratedeck/
  src/            Bun + TS — the whole server (one dir, no nesting)
  python/         rb_read.py — the ONLY bridge into rekordbox-land (+ usb_tree.py for ports)
  web/            Preact + Vite page (built assets served by the server)
  shared/         types.ts + badges.ts + fmt.ts — imported by both sides
  testdata/       fixtures (synthetic drive tree, fixture DBs, recorded plists)
  data/           runtime state (gitignored): SQLite, images, logs, scratch
  config.toml     user config (sample committed)
```

`bun run deck` → `127.0.0.1:7742`. Dev: `bun run deck:dev` (Vite proxying).
Localhost is the trust boundary; no auth, no TLS.

**The one architectural rule:** TypeScript owns _state and orchestration_;
Python owns _rekordbox truth_ — through a single seam (`src/rb.ts` ↔
`python/rb_read.py` / the skill's `usb_verify.py` / `usb_mirror.py`). The
skill's `anlz_paths.py` and `usb_verify.py::pdb_live_rows` are the canonical
implementations and are **imported directly** by the bridge — never ported,
never duplicated. If a fast path ever needs one of them in TS, that's a bug
in the design, not a task.

## 2. The server files (+ the Python seam)

_The original ten, still the load-bearing core:_

```
src/
  index.ts      wire-up: config → db → detect → jobs → http; static files
  config.ts     config.toml + env, validated once at boot
  db.ts         bun:sqlite: schema v1, migrations, every query (one place)
  detect.ts     "what's plugged where" — volumes, USB, ports (one concern)
  registry.ts   drive identity, ghosts, snapshots, timeline events
  scan.ts       light scan: manifest, sizes, folders, space, junk (orphan ._*, zero-byte)
  rb.ts         THE Python seam: rekordbox reads + verify/mirror job wrappers
  bench.ts      benchmark + checksum ledger (pure TS, Bun.CryptoHasher)
  jobs.ts       queue, progress, interlock (rekordbox running? → refuse)
  verify_report.ts  usb_verify.py output → structured, explained verdicts (pure)
  guard.ts      THE write allow-list — every disk write goes through it
```

_Added since (same dependency rules): `report.ts` (health/SSOT verdicts),
`images.ts` (photo providers), `fleet.ts` + `fleet-db.ts` (§B6–B8 engine +
persistence), `deckctl.ts` (agent CLI), `auto_schedule.ts` (§B17 mount-scan
/ weekly-verify intent — pure, never runs anything), `verify_help.ts`
(verify-doc SSOT for server + deckctl), `walk.ts` (one shared fs walker),
`badges_view.ts` (badge presentation)._

Dependency direction is strictly downward: `index → {api-ish files} →
domain files → db/guard`. `rb.ts` is the only file allowed to spawn
processes. `guard.ts` is the only file allowed to write outside `data/`.

## 3. Detection: event-driven, not polled

- **Heartbeat:** `fs.watch` (FSEvents) on `/Volumes` → mount/unmount fires in
  < 1s with zero polling. A 5s `diskutil list -plist` diff runs as a safety
  net (FSEvents misses nothing on macOS mounts, but the net is cheap).
- **Detail is lazy and event-time, not loop-time:** when a volume appears,
  one `diskutil info -plist <disk>` (UUID, name, fs, capacity) + one
  `ioreg -p IOUSB -a -l -n <usb device>` (locationID, serial, port chain)
  — ~50ms, once per mount. No ioreg in any loop.
- **Port identity:** the USB tree path captured at mount (hub chain + port),
  user-labeled in config. If a drive shows up on an unlabeled port, the UI
  prompts "name this port". Port history = mount events; no separate port
  machinery.
- **States:** `mounting…` (appeared, not yet mounted) → `mounted` → `ghost`
  (unmounted, rendered from last snapshot). Yank-detection = volume
  disappears without eject: logged as `unplugged (dirty)`.

## 4. The Python seam (`src/rb.ts` → `python/`)

**Reads** (scan-level): copy `exportLibrary.db` (+wal/shm) to
`data/scratch/`, then `uv run python python/rb_read.py <copy>` → one JSON:
tracks, playlists + counts, dates, coverage. `rb_read.py` imports the
skill's canonical modules (`anlz_paths.py` for hash-path existence checks,
`usb_verify.pdb_live_rows` for the legacy-pdb count) — same repo, direct
import, zero duplication.

**Jobs** (deep): `verify` = `usb_verify.py --drives <d>`, `mirror` =
`usb_mirror.py` — spawned with cwd = repo root, progress parsed from their
existing stdout milestones. The Aug-25-proven tools stay the engines;
CrateDeck is the face.

**Interlock:** `pgrep -x rekordbox` non-empty → `rb.ts` refuses every call
(reads included — policy: during rekordbox operation, hands off), jobs.ts
marks queued work `locked`, SSE pushes `interlock:on`. One function, one
truth, checked at the seam — not scattered through the UI.

## 5. Data model (bun:sqlite, WAL)

```sql
drives(id TEXT PK, volume_uuid TEXT UNIQUE, name TEXT, photo_path TEXT,
       capacity_bytes INT, fs TEXT, vendor TEXT, model TEXT, usb_serial TEXT,
       role TEXT,                       -- master|mirror|library|unknown
       first_seen_at INT, last_seen_at INT, last_port_key TEXT,
       plug_count INT, mounted INT, last_snapshot_json TEXT,  -- ghost fuel
       predecessor_id TEXT)             -- reformat lineage

events(id TEXT PK, drive_id TEXT, at INT, kind TEXT, data_json TEXT)
       -- mounted/unmounted(dirty?), port, scan, job-done, rename, photo...

snapshots(drive_id TEXT, taken_at INT, kind TEXT, data_json TEXT,
          PRIMARY KEY(drive_id, taken_at))    -- pruned to first/last/pre-verify

benchmarks(drive_id TEXT, ran_at INT, seq_mbps REAL, rand4k_mbps REAL)
ledger(drive_id TEXT, path TEXT, size INT, mtime INT, hash TEXT, last_ok INT,
       PRIMARY KEY(drive_id, path))           -- bitrot detection

jobs(id TEXT PK, drive_id TEXT, kind TEXT, status TEXT, progress REAL,
     log_path TEXT, result_json TEXT, error TEXT,
     created_at INT, started_at INT, finished_at INT)

settings(key TEXT PK, value_json TEXT)
```

Design choices: ghost rendering reads `drives.last_snapshot_json` (one row,
no join); full snapshot history is for the timeline, pruned to keep the DB
tiny; jobs double as verification history (`result_json` holds the verdict —
no separate verifications table). Checksum = `Bun.CryptoHasher` blake2b256,
zero deps.

## 6. API (all under `/api`, one file)

```
GET  /drives                     cards (mounted + ghosts + badges)
GET  /drives/:id                 detail tabs data
GET  /drives/:id/timeline        events
GET  /drives/:id/export          JSON dossier (ghost memories, downloadable)
POST /drives/:id/name | /photo | /merge
GET  /ports · POST /ports/:key/label
POST /drives/:id/jobs {kind} · GET /jobs · GET /jobs/:id · POST /jobs/:id/cancel
GET  /search?q=                  cross-drive (ghosts included)
GET  /images/search?q=           provider proxy
GET  /events                     SSE: mounts, job progress, interlock
```

Job dedupe: one queued/running job per (drive, kind).

## 7. Images

`ImageProvider { search(q) }` — `brave` | `exa`, chosen in config, key from
config or `CRATEDECK_IMAGE_KEY`; fetched server-side, cached forever under
`data/images/<drive>/` (square thumb + original). No key → manual
upload/drag/URL only, UI says why. Chosen image is permanent; providers are
never re-queried for that drive.

## 8. Frontend

Preact + Vite. Two-pane layout driven by a **zero-dep hash router**
(`web/router.ts`, `#/drives/:id/:tab`) — deep links and browser
back/forward work with no router dependency. `DriveRail` (all drives,
ghosts dimmed) → `DrivePage` (Overview / Playlists / Health / Timeline /
Photo tabs: `PlaylistsTab`, `HealthTab`, `TimelineTab`) · `JobsDock` ·
interlock banner · toast notifications (`toast.tsx`) · `icons.tsx`. SSE
with auto-reconnect. Badge rules live in `shared/badges.ts`, computed
server-side, rendered client-side — badge and data can never disagree.
Dark, flat, crate-card metaphor; spinning state while a job runs.

_(2026-09-04 audit note: original plan was a single page with a
`DriveDrawer` drawer; shipped as rail + routed page, which scales better
with five tabs and deep-linkable drive state.)_

## 9. Testing

- **Fixtures:** synthetic FAT32-shaped tree, pyrekordbox-created fixture
  device DB, pdb snippets, recorded diskutil/ioreg outputs.
- **Bridge golden tests:** `rb_read.py` output vs known-fixture values
  (incl. the Aug-25 ground truth: 3,177 pdb live rows) — proves the seam,
  no cross-language port matrix to maintain.
- **Detector:** replay fixture diffs; FSEvents simulated by dir create in
  tmp; state machine tests for mounting→mounted→ghost.
- **Interlock + guard:** mocked pgrep; test that walks for raw fs writes
  outside `guard.ts` (structural enforcement).
- **E2E:** Bun test against a live server on a fixture data dir: card →
  scan → verify(mock) → unplug → ghost → search → export.
- Real gig drives stay manual — the Python tools already carry that trust.

## 10. Failure modes

| Failure                        | Behavior                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| Drive yanked mid-job           | job → `interrupted`, partials kept, drive ghosts on next event |
| rekordbox launched mid-session | running read-only job finishes; new work locked via SSE banner |
| Image provider down            | search 502s; manual path unaffected                            |
| SQLite corruption              | WAL + nightly `data/backup.sqlite`; images relink by UUID      |
| FSEvents misses (edge)         | 5s diff net catches it; UI unaffected                          |
| Server killed mid-scan         | boot-time scratch sweep; job → `interrupted`                   |

## 11. Security

Bind 127.0.0.1 only. API key never leaves the server. Uploads size/type
capped. Subprocess args are UUIDs from our DB, never user strings. The
structural guarantee: `guard.ts` allow-lists every writable path (`data/`,
scratch); a repo test fails if any file outside `guard.ts` performs a
write. The app is incapable of writing to a gig drive except through one
auditable, logged, user-initiated path.
