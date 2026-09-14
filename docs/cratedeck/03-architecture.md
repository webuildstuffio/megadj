# CrateDeck — Architecture

**Status:** 📚 REFERENCE — current architecture.

v3 · 2026-09-14 · [PRD](02-prd.md) → **Architecture** → [Acceptance](acceptance.md)

> v3 records the shipped domain-store, route, job-runtime, CLI-command, and
> feature-folder splits. The stable façades remain small; executable schemas,
> route registries, and interface censuses stay with their producers.

---

## 1. Shape

**One Bun process, one Python seam, one page.**

The server is intentionally flat inside `src/`, but split by concern. File
counts are not architecture and are therefore not recorded here.

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

## 2. Server ownership (+ the Python seam)

```
src/
  index.ts            composition root + top-level HTTP dispatcher
  *_routes.ts         archive, booth, fixes, hygiene, and drive-job routes
  db.ts               stable persistence façade
  db_core.ts          connection, base schema, migrations, retention
  db_{activity,drives,library,bench,ledger}.ts
                      domain-owned query stores
  jobs.ts             stable job façade and queue state
  job_{runtime,execution}.ts / *_jobs.ts
                      execution legs, progress, cancellation, family jobs
  detect.ts / registry.ts / scan.ts
                      mount truth, drive identity, and read-only scans
  rb.ts               THE Python seam for rekordbox reads and job wrappers
  deckctl*.ts         one-way CLI command modules
  mcp*.ts             MCP registration, schemas, and transport
  guard.ts            allow-list for mounted-drive writes
```

Pure engines (`report*`, `coverage`, `preflight*`, `players`,
`verify_report`, `verify_help`) sit below the HTTP/CLI/MCP spokes. Shared
infrastructure (`walk`, `badges_view`, `images`, `auto_schedule`,
`archive_sweep`) does not own product policy. Every capability is registered
in [surface parity](../surface-parity.md) or carries an explicit exemption.

Dependency direction is strictly downward: composition/transport → domain
engines → persistence and guarded I/O. `rb.ts` owns the rekordbox Python
seam. Mounted-drive writes go through `guard.ts`; local app state, explicit
CLI exports, and the atomic booth-config rewrite are separate reviewed
boundaries.

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

The executable DDL and additive migrations live in `db_core.ts`; domain
tables and queries live in the `db_*` stores behind the `db.ts` façade. The
canonical schema map is [Data stores and schema ownership](../data-model.md).

Design choices: ghost rendering reads the last snapshot stored with the drive;
snapshot and event retention are bounded by producer constants; jobs carry
their own result history; checksum rows use blake2b256. Exact columns are not
copied into this document.

## 6. API (all under `/api`)

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

`index.ts` owns top-level dispatch; `archive_routes.ts`, `booth_routes.ts`,
`drive_job_routes.ts`, `fixes_routes.ts`, and `hygiene_routes.ts` own cohesive
route families. The list above is the stable core shape, not a route census.
The exact live surface is derived and pinned in
[surface parity](../surface-parity.md).

Job dedupe: one queued/running job per (drive, kind).

## 7. Images

`ImageProvider { search(q) }` — `brave` | `exa`, chosen in config, key from
config or `CRATEDECK_IMAGE_KEY`; fetched server-side, cached forever under
`data/images/<drive>/` (square thumb + original). No key → manual
upload/drag/URL only, UI says why. Chosen image is permanent; providers are
never re-queried for that drive.

## 8. Frontend

Preact + Vite. `web/app/` owns composition and the zero-dependency hash router;
`web/products/` owns CrateDeck, GetDat, and FullTags canvases; `web/ui/` owns
shared components; `web/styles/` owns per-concern stylesheets. Deep links and
browser back/forward work without a router dependency. SSE reconnects and
coalesces job updates. Badge rules live in `shared/badges.ts`, computed
server-side and rendered client-side so badge and data cannot disagree.

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

Bind `127.0.0.1` only. Non-loopback Host/Origin requests are rejected. API
keys never leave the server. Uploads are body-limited, content-typed, decoded
under bounded dimensions, and assigned server-owned destinations. Subprocess
arguments are resolved identifiers or validated paths, never raw route text.
`guard.ts` allow-lists mounted-drive writes; local SQLite/config/export writes
remain explicit reviewed seams. No write path targets the user-managed playing
USB.
