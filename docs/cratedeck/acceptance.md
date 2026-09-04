# CrateDeck — Acceptance Status

Tracks the PRD (F1–F10) and build-plan milestone acceptance items. Evidence
here is **code-verified only** (file/route/test existence in `cratedeck/`).
Items marked ☐ require real-hardware runs (gig drives) — those stay manual
by design ("real gig drives stay manual — the Python tools already carry
that trust", architecture §9). Last audited: 2026-09-04.

## Milestones

| Milestone                    | Scope                             | Status        |
| ---------------------------- | --------------------------------- | ------------- |
| M0 — Skeleton & spine        | registry, detection, ghosts, page | ✅ shipped    |
| M1 — Photo & identity        | image search/confirm, rename      | ✅ shipped    |
| M2 — Rekordbox introspection | Python seam, scan, playlists      | ✅ shipped    |
| M3 — Jobs, interlock, sync   | verify/mirror/bench/checksum      | ✅ shipped    |
| M4 — Ports, timeline, search | port strip, timeline, search      | ✅ shipped    |
| M5 — Polish, dossier, radar  | reports, dossier export           | ✅ shipped    |
| M6 — Hardening & docs        | failure modes, rotation, docs     | ☐ in progress |

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
- **F8 timeline** — events table + `GET /drives/:id/timeline`, drawer tab
- **F9 cockpit UI** — hash-routed two-pane UI: `web/router.ts` (deep
  links), `web/DriveRail.tsx` (cards incl. ghosts), `web/DrivePage.tsx`
  (tabs: `PlaylistsTab`, `HealthTab`, `TimelineTab`), `web/JobsDock.tsx`,
  interlock banner, `toast.tsx`
- **F10 extras** — dossier export (`GET /drives/:id/export` incl. report),
  deckctl CLI (`cratedeck/src/deckctl.ts`, agent-facing with interlock
  exit codes); gig mode + new-music radar remain → [../ideas.md](../ideas.md) B/F

## Test coverage

`cratedeck/test/`: `badges`, `config`, `db`, `e2e` (live server: interlock,
drives list, SPA shell), `guard` (write allow-list), `scan-detect`,
`report` (dual-DB gate fail path, grid coverage thresholds, bitrot, mirror
superset/behind, artwork coverage, space/df, NFC+casefold).

## Open acceptance items (need real hardware, not tests)

- [ ] PRD F5: DJMIRROR badge matches a manual `usb_mirror.py
--verify-only` run on the live drive
- [ ] PRD F4: DJMASTER detail vs known ground truth (3,054+ core tracks,
      YTMusic Liked, event playlist tree) after the 2026-09-03 export settles
- [ ] PRD F9: all real drives on one screen at 1440×900 without scrolling
- [ ] Build plan M6: kill -9 random-point resilience pass; SQLite/log
      rotation check; tag `cratedeck-v0.1.0`
