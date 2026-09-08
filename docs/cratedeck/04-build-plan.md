# CrateDeck — Build Plan

v1 · 2026-09-03 · [Brief](01-product-brief.md) · [PRD](02-prd.md) · [Architecture](03-architecture.md) → **Build Plan**

**Status:** ✅ M0–M5 shipped (v0.1, 2026-09-04) — dashboard live at
`bun run deck`; test suite in `cratedeck/test/` (badges, config, db, guard,
scan-detect, report, e2e). M6 hardening is partially done (docs shipped;
kill -9 resilience + the `cratedeck-v0.1.0` tag remain — see
[acceptance.md](acceptance.md)).
_Shipped-structure note: the per-milestone file lists below were the plan —
the real layout evolved (hash-routed `DriveRail`/`DrivePage` tabs instead of
a drawer; `deckctl` CLI added; see
[03-architecture.md](03-architecture.md) §2/§8 and
[acceptance.md](acceptance.md) for what actually exists)._

Milestones M0–M6. Each ends runnable + committed. Tests ride along with the
code they cover (no "testing phase" at the end). Estimated with focus and
the existing megadj tooling as leverage: the Python tools already solve the
hard verification problem — we're building the face and the memory.

---

## M0 — Skeleton & spine (foundation) ✅

**Goal:** `bun run deck` serves a page with a list of drives from SQLite,
detection events flow, ghosts persist. Spine: config loader, bun:sqlite
WAL + v1 migrations, diskutil poll-diff detector, uuid identity
(first-seen / rebind / ghost), static server + `/api` router + `/events`
SSE, drive grid from `GET /drives`.

Tests: db migrations; identity (new/rebind/ghost); detector diff on fixture
plists; badge rules.
**Done when:** a stick plugged/unplugged appears/disappears live, ghost card
remembers after app restart, all on one page.

## M1 — Photo & identity (make cards personal) ✅

**Goal:** search → confirm → persist image; rename; manual upload path.
Image-provider abstraction (Brave/Exa) behind a proxy route + manual
picker/upload/drag; cache under `data/images/<drive>/` (thumb + original);
config `[images] provider/key` or `CRATEDECK_IMAGE_KEY`; no key → manual
mode with a hint.

Tests: provider contract (mock fetch), cache write, upload type/size guard.
**Done when:** all real drives can be named + photographed in one sitting,
photos survive offline.

## M2 — Rekordbox introspection (the brain) ✅

**Goal:** mounted drive detail = real rekordbox truth. Light scan
(manifest walk, sizes, folder composition) + THE Python seam (`rb.ts` →
`rb_read.py`, importing the skill's canonical `anlz_paths.py` +
`pdb_live_rows`); fixture DB/pdb/diskutil corpus under `cratedeck/testdata/`.

Tests: bridge golden tests (rb_read.py JSON vs fixture values incl. the
Aug-25 ground truth 3,177 pdb live rows); scan on fixture tree; zero-write
assertion (drive mtimes unchanged after full scan).
**Done when:** each drive's detail shows correct tracks/playlists/pdb delta;
scans leave drives untouched.

## M3 — Jobs, interlock, sync status (the muscles) ✅

**Goal:** verify/mirror/benchmark/checksum as jobs (queue, per-drive
concurrency, logs, cancel, orphan reaper); rekordbox interlock enforced
client + server; master diff → IN SYNC / BEHIND / DIVERGED badges; jobs
tray + interlock banner in the UI.

Tests: engine lifecycle incl. yank-mid-job; interlock refusal (mocked pgrep);
benchmark determinism on tmpfs fixture; checksum bitrot detection (flip a
byte in fixture); syncstatus on fixture manifests (superset tolerance).
**Done when:** with rekordbox open everything is visibly locked; closed, a
verify runs to a verdict badge; the mirror badge matches a manual
`usb_mirror --verify-only`.

## M4 — Ports, timeline, search (the world model) ✅

**Goal:** port map (ioreg tree, stable port keys, labels), per-drive
timeline + export, cross-drive search over snapshots.

Tests: port key stability across fixture topology variants; timeline
ordering; search hit on ghost snapshot; export JSON round-trip.
**Done when:** "which stick has a given playlist and when was it last plugged in?" is
one search away, with the answer's port labeled.

## M5 — Polish, dossier, radar (the 10x coat) ✅

- New-music radar (megadj archive.db vs drive snapshots) + copy-sync-command
- Gig mode (out-for-gig note) + dossier one-pager (print-styled HTML)
- Badge finalization (READY/STALE/ATTN/GHOST rules, `shared/badges.ts`)
- UI pass: dark flat theme, card hierarchy, empty/loading states, keyboard
  (⌘K search), favicon, `bun run deck` one-liner in root README
- Perf: light scan ≤ 5s on 4k files; page interactive < 1s; SSE reconnect

Tests: badge matrix table-test; radar diff correctness; dossier snapshot
render. **Done when:** the owner's actual drives all show correct real-world
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
