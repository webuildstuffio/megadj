# CrateDeck — Product Brief

**One dashboard for every DJ USB drive you own — mounted or not.**

Status: Draft v1 · 2026-09-03 · Owner: REDACTED · Repo: megadj/megadj
Companion docs: [02-prd.md](02-prd.md) · [03-architecture.md](03-architecture.md) · [04-build-plan.md](04-build-plan.md)

---

## 1. The problem, honestly

REDACTED owns ~8 USB drives that carry gig-critical rekordbox libraries. Right now
the only ways to answer "what's on this stick and is it healthy?" are:

1. Plug it in, open Finder, squint.
2. Open rekordbox (slow, and it mutates DBs just by looking).
3. Ask an agent to run the megadj verify scripts by hand.

None of these answer the real questions fast:

- Which drive is this? (they all look the same in a drawer)
- Is it in sync with the master library?
- Does every track have a beatgrid, or will the XZ show nothing?
- When did I last verify it? Did anything corrupt since?
- Which physical port is it in, and does that matter?

The megadj repo already solved the *hard* half — byte-accurate rekordbox
device-library reads, ANLZ validation, hardware-gate verification, mirror
tooling. What's missing is a **face**: a single always-on page that turns
that machinery into something you can glance at.

## 2. Vision

> A local web page that shows every drive you've ever plugged in as a card —
> with its photo, its name, its playlists, its health, its sync state, its
> history — even when it's unplugged. Plug a stick in and it lights up.
> Unplug it and it becomes a ghost that remembers everything.

One command (`bun run deck`), one page, zero accounts, localhost only.

## 3. Who it's for

**Primary user:** REDACTED — one person, multiple venues' worth of gear, values
glanceability over configuration, allergic to busywork. This is not a SaaS;
it's the cockpit of a one-DJ operation. Secondary: any visitor DJ who borrows
a stick and needs to know what's on it in 5 seconds.

## 4. Jobs to be done

| # | Job | Today | With CrateDeck |
|---|---|---|---|
| J1 | "Tell me what this stick in my hand is" | plug in, browse folders | card lights up with photo + name in ~2s |
| J2 | "Is it safe to play this drive tonight?" | hope / run scripts by hand | PASS/FAIL readiness badge with the same gates the verify tool uses |
| J3 | "What's different between my two main drives?" | run `usb_verify.py`, read logs | in-sync badge + one-glance diff (files, DB, ANLZ, playlists) |
| J4 | "Which stick has the party playlist?" | plug in each and look | search across **all** known drives, including unplugged (last-known data) |
| J5 | "Is the new YTMusic batch on the drives yet?" | run sync, check output | new-music radar: downloads vs each drive, one click to queue the sync |
| J6 | "Did this stick get slower / is it dying?" | nothing — until it fails | benchmark history, bitrot ledger, SMART/health signals |
| J7 | "Where do I plug the exporter so drives behave?" | guess | port map — labeled physical ports, drive-to-port history |

## 5. What it does (the 10x version)

1. **Drive registry with faces.** Every drive ever seen is persisted locally
   (SQLite) with: name, nickname, photo (product image), capacity, model,
   serial/UUID, first/last seen, total plugging sessions. Unplugged drives
   render as dimmed "ghost" cards — invisible state made visible again.
2. **Photo identification.** Type "SanDisk Ultra 128GB", CrateDeck searches
   product images (Brave/Exa — whichever API key is configured), shows a
   click-to-confirm grid, stores the chosen image next to the drive forever.
   Manual upload/paste works with zero API keys.
3. **Full rekordbox introspection per drive** (when mounted): tracks,
   playlists + entry counts, % of tracks with beatgrids/waveforms, ANLZ
   coverage at hash-computed paths, OneLibrary + legacy export.pdb row
   counts, DB freshness, export age.
4. **Sync & verification, one click.** Master ⇄ mirror diff, deep verify
   (the existing 10x gate), mirror run — all surfaced as jobs with live
   progress. **Safety interlock: if rekordbox is running, every write action
   is visibly disabled with the reason.**
5. **Health & corruption.** Space usage (treemap by folder), file counts,
   read benchmark with history, checksum ledger that detects bitrot between
   visits, optional SMART status, FAT32 consistency check (read-only) with
   plain-language verdict.
6. **History & timeline.** Every plug/unplug, sync, verify, benchmark, and
   name change is an event. Per-drive timeline + "last known good" stamp.
7. **Port map.** Which physical port each drive is in right now (macOS USB
   device tree), with human labels ("MBP left rear") and per-port history.

## 6. What makes it 10x (differentiators)

- **Ghost persistence** — everything rekordbox never shows you: unplugged
  drives still browsable from last-known state.
- **Hardware-gate readiness** — uses the exact `export.pdb` == OneLibrary ==
  ANLZ-at-hash-path logic proven in `usb_verify.py`; the badge means what
  the XZ will actually see, not what a database claims.
- **Reuse, not rewrite** — deep checks shell out to the battle-tested
  megadj Python tooling; TS handles detection, storage, and UI. One codebase
  of truth for "is this drive good".
- **Physical-world modeling** — photos, ports, drawer labels: software that
  acknowledges drives exist in a drawer, not just in /Volumes.

## 7. Scope

**In (v1):** registry + ghost persistence, detection & port mapping, image
picker (search + manual), drive detail (playlists, grids, DB/pdb counts,
space), sync status vs master, verify/mirror/benchmark jobs with interlocks,
health ledger + bitrot checks, timeline, one-page UI, localhost only.

**Out (v1):** writing to drive DBs directly (that stays in the skill
tooling), multi-user/auth, non-macOS, cloud sync, rekordbox Mac-library
management, automatic background writes of any kind.

## 8. Success looks like

- "What's on this stick?" answered in < 5 seconds, from the couch.
- Zero gig-night surprises: every drive card shows a readiness badge dated
  after its last change.
- All 8 real drives named, photographed, and accounted for within the first
  session.
- The agent + scripts workflow becomes: glance at CrateDeck → act only when
  a badge isn't green.

## 9. Personality & feel

Playful-pro DJ tool, not enterprise storage admin. Drive cards feel like
record crates: big photo, sticker-like badges (READY / STALE / GHOST / /!\
ATTN), a "spinning" state while jobs run. Flat design, no gradients, dark
default. Copy is terse and confident ("Last verified 2d ago — clean").
Status colors: green ready, amber stale, red attention, gray ghost.

## 10. Key risks & kills

| Risk | Mitigation |
|---|---|
| Writing to drives while rekordbox runs | hard interlock, red banner, jobs refused at API layer |
| Cheap sticks report no serial/UUID | identity = volume UUID, fallback fingerprint (name+capacity+fs), manual merge UI |
| Image search APIs flake/rate-limit | provider abstraction, manual upload always available, image cached forever once chosen |
| Deep verify slow on 4k-file drives | cached results keyed by DB mtime; jobs async with progress; light checks instant |
| macOS API changes break detection | thin detection module, golden-fixture tests |

**Kill criteria:** if the registry/ghost layer doesn't earn its keep within
two real gig cycles (drives still getting mixed up), simplify to a verify
badge page only.

## 11. Route to v1

Brief (this) → PRD (feature specs + acceptance criteria) → Architecture
(processes, data model, detection internals) → Build Plan (milestones M0–M6,
file tree, tests). Build lands inside `megadj` as `cratedeck/` — it shares
state with the skill scripts and inherits the repo's existing verify
machinery.
