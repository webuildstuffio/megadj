# CrateDeck — Acceptance Status

Tracks the PRD (F1–F10) and build-plan milestone acceptance items. Evidence
here is **code-verified only** (file/route/test existence in `cratedeck/`).
Items marked ☐ require real-hardware runs (gig drives) — those stay manual
by design ("real gig drives stay manual — the Python tools already carry
that trust", architecture §9). Last audited: 2026-09-06 (pass 3; B12/N75/
N76/O82b/O83/O85/O87/O88 evidence added).

## Milestones

| Milestone                    | Scope                             | Status                                           |
| ---------------------------- | --------------------------------- | ------------------------------------------------ |
| M0 — Skeleton & spine        | registry, detection, ghosts, page | ✅ shipped                                       |
| M1 — Photo & identity        | image search/confirm, rename      | ✅ shipped                                       |
| M2 — Rekordbox introspection | Python seam, scan, playlists      | ✅ shipped                                       |
| M3 — Jobs, interlock, sync   | verify/mirror/bench/checksum      | ✅ shipped                                       |
| M4 — Ports, timeline, search | port strip, timeline, search      | ✅ shipped                                       |
| M5 — Polish, dossier, radar  | reports, dossier export           | ✅ shipped                                       |
| M6 — Hardening & docs        | failure modes, rotation, docs     | 🔶 partial (docs shipped; kill -9 + tag pending) |

## Evidence map (code)

- **F1 registry & ghosts** — `src/registry.ts`, `src/db.ts` (drives/events/
  snapshots tables), ghost rendering in `web/App.tsx`
- **F2 detection & ports** — `src/detect.ts` (FSEvents + diskutil), port
  route `GET /ports`, `python/usb_tree.py`
- **F3 photo identity** — `src/images.ts`, picker in `web/`, cached under
  `data/images/`
- **F4 rekordbox introspection** — `src/rb.ts` (the seam) +
  `python/rb_read.py`, light scan in `src/scan.ts`
- **F5 sync status** — master/mirror parity in `src/report.ts`
  (`mirror parity` checks, superset tolerance)
- **F6 jobs & interlock** — `src/jobs.ts`, `src/bench.ts`, `GET /jobs`,
  interlock route + banner
- **F7 health & corruption** — `src/report.ts` (dual-DB gate, grids, space,
  bitrot ledger, junk), junk detection in `src/scan.ts`
- **F8 timeline** — events table + `GET /drives/:id/timeline`, `web/TimelineTab.tsx`
  (day grouping, event icons, kind chips)
- **F9 cockpit UI** — hash-routed two-pane UI: `web/router.ts` (deep
  links), `web/DriveRail.tsx` (cards incl. ghosts), `web/DrivePage.tsx`
  (tabs: `PlaylistsTab`, `HealthTab`, `TimelineTab`), `web/JobsDock.tsx`,
  interlock banner, `toast.tsx`. No drawer — the rail is always visible and
  the canvas is the drive page.
- **F10 extras** — dossier export (`GET /drives/:id/export` incl. report),
  deckctl CLI (`cratedeck/src/deckctl.ts`, agent-facing with interlock
  exit codes); gig mode + new-music radar remain → [../ideas.md](../ideas.md) B/F

## Sep 2026 UI redesign (verified end-to-end)

Drawer replaced by an always-visible left rail + main canvas, hash-routed
(`web/router.ts`). Redesigned: SVG icon set (`web/icons.tsx`), design tokens
(`web/styles.css`), drive rail cards (health ring, role chips, space bar,
ghost styling), Overview hero + grouped checks, Playlists browser (search/
sort/folders), Health tab (SVG bench chart, stat cards, folder bars),
Timeline (icons, day grouping, kind chips), Photo tab (search/clear),
JobsDock (progress/ETA/cancel/history), toasts, ⌘K search with keyboard nav,
inline rename. Bug-fixed during the pass: jobs initial load, unknown-drive
404 + "Drive not found" card, swallowed 423 errors, `prompt()` rename,
stale rail nicknames (10s poll), `resolveMountPoint` respecting
`CRATEDECK_VOLUMES`, plaintext-DB fallback in `rb_read.py`. Verified via
fixture server + Chrome DevTools Protocol DOM checks; screenshots reviewed.

## Fleet superpowers (shipped 2026-09-04 — ideas.md §B6/B7/B8)

- **B6 coverage matrix** — `src/fleet.ts coverage()/trackLocations()` over
  per-track fleet tables (`fleet_tracks`, refreshed by every scan in
  `db.setSnapshot`; full-scan inventory from `python/rb_read.py`). UI:
  Fleet page Coverage tab (`#/fleet/coverage`, Fleet button in the topbar);
  API `GET /api/fleet/coverage` + `GET /api/fleet/track?q=`; CLI
  `deckctl coverage [min]`.
- **B7 redundancy audit** — `src/fleet.ts redundancy()`; per-playlist
  pass/warn/fail with expandable gap lists. UI: Fleet → Redundancy tab;
  API `GET /api/fleet/redundancy`; CLI `deckctl redundancy [min]`.
- **B8 fleet diff** — `src/fleet.ts diff()`; added/removed from DB tracks,
  byte-level changed from scan manifests, `artist - title` meta-join for
  moved tracks. UI: Fleet → Diff tab; API `GET /api/fleet/diff?a=&b=`;
  CLI `deckctl diff A B`.
- Tests: `test/fleet.test.ts` (engine + DB round-trips). Data loads on the
  next full scan of each drive with rekordbox closed.

## Automation (shipped 2026-09-05 — ideas.md §B17, commit `aa64e04`)

- **Auto light-scan on mount** — `src/auto_schedule.ts`
  (`shouldAutoScan`: fresh mount + no fresh snapshot → enqueue scan);
  config `[automation] auto_scan_on_mount` (default on).
- **Weekly auto-verify** — `shouldAutoVerify`: never-verified, or last
  verify older than `verify_interval_days` (default 7, 0 = off); results
  feed the readiness badge. Max one auto-verify attempt per drive per
  sweep; interlock applies as to every job.

## Agent surface (shipped 2026-09-05)

- **MCP server** — `src/mcp.ts`: stdio JSON-RPC exposing deckctl's surface
  — **21 tools** (`deck_status/drives/report/coverage/redundancy/diff/
jobs/run/cancel/explain` + `deck_preflight` (B12), `deck_players` (N78),
  `deck_note`/`deck_notes` (O88), and the O82b archive half:
  `archive_search_tracks/track_stats/ingest_status/lowq_queue/
source_diff/grid_cross_check/mood_profile`); readonly tools carry
  `readOnlyHint: true`; mutating tools flagged `destructive`; the
  rekordbox
  interlock is enforced client-side _and_ server-side (423 on enqueue).
  Run: `bun run mcp`.
- **Shared HTTP client** — `src/deckapi.ts`: server auto-start, drive
  resolution, `waitForJob`; one source of truth for deckctl + mcp.
- **Verify reports** — `src/verify_report.ts` (+ tests): structured
  deep-verify results feeding the readiness badge.
- **CLI verification gates** — `megadj doctor [--json]` (exit 1 if any
  required dependency/config check fails — usable as a script gate) and
  `megadj init` (scaffolds `cratedeck/config.toml`, auto-filling drive
  names from mounted volumes).

## Gig-night + agent surface (shipped 2026-09-05, pass 2–3)

- **B12 preflight** — `src/preflight.ts` + `deckctl preflight` +
  `GET /api/preflight`: worst-status-wins verdict per drive
  (not-ready/attention/unknown/ready); unknowns never fake ready;
  exit 1 when not ready so cron/agents gate on the code. Includes the
  N75 player-compat check (fully blocked drive = not-ready) and the N76
  firmware advisories (`firmware_advisories`, informational).
- **N75/N78 player-compat matrix** — `src/players.ts`, `deckctl players
  [drive]`, `deck_players` MCP tool: Device-vs-OneLibrary verdicts from
  MEASURED dual-DB rows; user-extendable via config.toml
  `[players.players]`.
- **O82b archive MCP half** — `src/archive.ts` (opened `readonly: true`)
  + 7 `archive_*` tools incl. `archive_grid_cross_check` (rev 6 beats
  ledger vs RB BPM×duration: ok/off/octave) and `archive_mood_profile`
  (rev 6.2 mood-ledger picker data). Missing archive DB degrades to
  `available:false`.
- **O83 weekly prep** — `src/weekly_prep.ts`, `deckctl prep [--out
  FILE] [--json]`: markdown digest over preflight + redundancy +
  archive reads.
- **O87 attribution + O88 agent notes** — `jobs.origin`
  ("web"/"deckctl"/"auto"/"mcp:<session>") on job rows + timeline
  events; `deck_note` lands dismissable severity-toned timeline cards
  (`src/notes.ts`, 600-char cap, human dismissal flips `dismissed_at`).
- **O85 plugin packaging** — `plugin/` bundles the MCP server +
  SessionStart hook + skills as an installable Claude Code plugin
  (`claude plugin validate` passes).

## Test coverage

`cratedeck/test/`: `badges`, `config`, `db`, `e2e` (live server: interlock,
drives list, SPA shell — skips the shell assertion when `web/dist` isn't
built), `fleet` (coverage/redundancy/diff engine + persistence), `guard`
(write allow-list), `scan-detect`, `verify_report`,
`report` (dual-DB gate fail path, grid coverage thresholds, bitrot, mirror
superset/behind, artwork coverage, space/df, NFC+casefold).

## Open acceptance items (need real hardware, not tests)

- [ ] PRD F5: the mirror badge matches a manual `usb_mirror.py
--verify-only` run on the live drive
- [ ] PRD F4: drive detail vs known ground truth (track counts,
      playlists) after the latest export settles
- [ ] PRD F9: all real drives on one screen at 1440×900 without scrolling
- [ ] Build plan M6: kill -9 random-point resilience pass; SQLite/log
      rotation check; tag `cratedeck-v0.1.0`
