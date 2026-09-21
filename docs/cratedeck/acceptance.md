# CrateDeck — Acceptance Status

**Status:** 🟡 BLOCKED — code gates are verified; three hardware checks remain.
The release-policy decision in issue #29 closed 2026-09-15 with the `v0.2.0`
tag pushed. Their tracking issue (#175) closed NOT_PLANNED 2026-09-16 — the
checks stay manual-by-design; run them from the recipes below when the gig
drives are at hand and record the results in this file.

Tracks the PRD (F1–F10) and build-plan milestone acceptance items. Evidence
here is **code-verified only** (file/route/test existence in `cratedeck/`).
Items marked ☐ require real-hardware runs (gig drives) — those stay manual
by design ("real gig drives stay manual — the Python tools already carry
that trust", architecture §9). Last audited: 2026-09-17.

## Milestones

| Milestone                    | Scope                             | Status                                                                          |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| M0 — Skeleton & spine        | registry, detection, ghosts, page | ✅ shipped                                                                      |
| M1 — Photo & identity        | image search/confirm, rename      | ✅ shipped                                                                      |
| M2 — Rekordbox introspection | Python seam, scan, playlists      | ✅ shipped                                                                      |
| M3 — Jobs, interlock, sync   | verify/mirror/bench/checksum      | ✅ shipped                                                                      |
| M4 — Ports, timeline, search | port strip, timeline, search      | ✅ shipped                                                                      |
| M5 — Polish, dossier, radar  | reports, dossier export           | ✅ shipped                                                                      |
| M6 — Hardening & docs        | failure modes, rotation, docs     | ✅ verified (SIGKILL recovery + retention caps; release tag tracked separately) |

## Evidence map (code)

- **F1 registry & ghosts** — `src/registry.ts`, `src/db.ts` (drives/events/
  snapshots tables), ghost rendering in `web/app/App.tsx`
- **F2 detection & ports** — `src/detect/detect.ts` (FSEvents + diskutil), port
  route `GET /ports`, `python/usb_tree.py`
- **F3 photo identity** — `src/image/store.ts`, picker in
  `web/products/cratedeck/PhotoTab.tsx`, cached under `data/images/`
- **F4 rekordbox introspection** — `src/rb.ts` (the seam) +
  `python/rb_read.py`, light scan in `src/scan.ts`
- **F5 sync status** — master/mirror parity in `src/report/report.ts`
  (`mirror parity` checks, superset tolerance)
- **F6 jobs & interlock** — `src/jobs/engine.ts`, `src/bench.ts`, `GET /jobs`,
  interlock route + banner
- **F7 health & corruption** — `src/report/report.ts` (dual-DB gate, grids, space,
  bitrot ledger, junk), junk detection in `src/scan.ts`
- **F8 timeline** — events table + `GET /drives/:id/timeline`,
  `web/products/cratedeck/TimelineTab.tsx` (day grouping, event icons, kind chips)
- **F9 cockpit UI** — hash-routed two-pane UI: `web/app/router.ts` (deep
  links), `web/products/cratedeck/DriveRail.tsx` (cards incl. ghosts),
  `web/products/cratedeck/DrivePage.tsx` (tabs: `PlaylistsTab`, `HealthTab`,
  `TimelineTab`), `web/ui/JobsDock.tsx`, interlock banner, and
  `web/ui/toast.tsx`. No drawer — the rail is always visible and the canvas
  is the drive page.
- **F10 extras** — dossier export (`GET /drives/:id/export` incl. report),
  deckctl CLI (`cratedeck/src/deckctl.ts`, agent-facing with interlock
  exit codes); gig mode was closed NOT_PLANNED (#140); new-music radar
  shipped (#148, see below)
- **F10 radar (SHIPPED 2026-09-16, #148)** — archive-vs-drive delta over
  one pure engine (`cratedeck/src/fleet/radar.ts`, folded-path + artist-title
  fallback): `/api/fleet/radar`, `deckctl radar`, `deck_radar` MCP, Fleet
  ⌗ Radar tab. Copy-only (`megadj shelf-sync`); per-drive `snapshotAt`
  freshness; never-scanned/light-scan drives read "unknown", never
  current. v1.1 "run as job" stays out of scope.

## Sep 2026 UI redesign (verified end-to-end)

Drawer replaced by an always-visible left rail + main canvas, hash-routed
(`web/app/router.ts`). Redesigned: SVG icon set (`web/ui/icons.tsx`), design
tokens (`web/styles/`), drive rail cards (health ring, role chips, space bar,
ghost styling), Overview hero + grouped checks, Playlists browser (search/
sort/folders), Health tab (SVG bench chart, stat cards, folder bars),
Timeline (icons, day grouping, kind chips), Photo tab (search/clear),
JobsDock (progress/ETA/cancel/history), toasts, ⌘K search with keyboard nav,
inline rename. Bug-fixed during the pass: jobs initial load, unknown-drive
404 + "Drive not found" card, swallowed 423 errors, `prompt()` rename,
stale rail nicknames (10s poll), `resolveMountPoint` respecting
`CRATEDECK_VOLUMES`, plaintext-DB fallback in `rb_read.py`. Verified via
fixture server + Chrome DevTools Protocol DOM checks; screenshots reviewed.

## Shipped-later surface (pointer)

Fleet superpowers (B6/B7/B8), automation (B17), the MCP server + agent
surface (B12 preflight, N75/N78 players, O82b archive reads, O83 prep,
O85 plugin, O87 origin attribution, O88 agent notes), and the CLI gates
are all shipped — status and evidence live in
[product-state-2026-09-07.md](../product-state-2026-09-07.md),
capability surface in [../surface-parity.md](../surface-parity.md); the
three open hardware checks were tracked in
[#175](https://github.com/webuildstuffio/megadj/issues/175), closed
NOT_PLANNED 2026-09-16 — the recipes remain below.

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
- [x] Build plan M6: SIGKILL recovery is regression-tested against a real
      child-process crash; snapshot/event retention is bounded on both the
      write path and database reopen (`test/issue-33-crash-recovery.test.ts`).
- [x] Release: the policy in issue #29 was executed 2026-09-15 — packages
      report `0.2.0` and the repository carries the matching `v0.2.0` tag
      (pushed to origin; local `git tag -l` and `git ls-remote --tags`
      both verified).
