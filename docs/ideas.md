# megadj — Ideas & Future Backlog

\*Compiled 2026-09-04 · grounded in the actual repo state: megadj archive/ingest,
the rekordbox-usb-sync pipeline, CrateDeck v1 (built), and open items in
`(local ops log)`.
Expanded same day with an open-source ecosystem research pass (§I–§L);
second pass same day added §N (XDJ-XZ / Pioneer / house & techno) and §O
(agentic megadj for Codex / Claude Code operators).
Status note (2026-09-04 docs audit): A1 (drive report) shipped —
`cratedeck/src/report.ts` + `GET /drives/:id/report` + drawer Report tab +
`cratedeck/test/report.test.ts`; A2 DONE (tools consolidation, `a4ace28`);
A5 (acceptance doc) done — `docs/cratedeck/acceptance.md`.
**Post-audit revision (2026-09-04): §0 added (do-now items gate everything),
cold backup promoted from §G, C18c explicitly unbuilt, I52 deleted, §M
added (AI cool-list + Mac-DJ irritants), sequencing rewritten as a gated
straight line.\***

How to read: each idea lists **why now** (the specific repo fact that motivates
it) and rough **effort** (S/M/L). Nothing here is committed scope — this is the
parking lot. Hard non-goals from the product brief stay non-goals (see §H).

**The deal (2026-09-04 audit):** this backlog is capped. A new idea goes in
only when an old one comes out or ships — a 60+-item list on one project of
many is planning becoming more fun than finishing. §0 comes before everything
and blocks everything else. The sequencing at the bottom is conditional on
real-world inputs (gig frequency), not vibes.

---

## §0 — Do now, before anything else

Nothing in this document matters while these are open. §0 blocks §A–§L.

0a. **Evacuate the dying SSD.** It has a hardware clock; every other item
here has a calendar. This is item zero, full stop. Copy to a healthy
disk first, triage contents later. (`rsync -av --progress` to a new
disk, then `usb_verify.py`-style hash spot-check on what matters.)
0b. **Cold backup of the master library.** _Promoted from §G40 in the
audit_ — it was misfiled as a wild swing when it's actually the cure
for the disease §B7 diagnoses: some tracks exist on exactly one
physical device. B2 or R2 of `Contents/` + the archive DB via rclone
(`rclone sync --backup-dir` for versioning) is read-only, violates no
repo rule, and is a weekend. Kills the single-point-of-failure class
forever. _Why this wasn't obvious: it's the only item that protects
against all drives failing at once, which is the only failure that
ends the archive._
0c. **OLDUSB verdict.** 264 OLDBACKUP-only files (10.1 GB) exist nowhere
but OLDUSB. One session: adopt into master (via `megadj adopt` +
ingest) or declare them dead in the sync log. Do it _before_ 0b so
the cloud backup captures the decision, not the ambiguity.
0d. **Build the redundancy audit (§B7) + coverage matrix (§B6).** The two
cheapest items in the doc — pure queries over snapshots already
collected — and the only ones that tell you the _actual_ damage
radius of the next drive failure. If only four things ever ship from
this doc, it's 0a–0d.

**Reality gate — the input that decides the rest of this doc:** how often
do you actually play? The sequencing section is now conditional on it.

- **~Monthly or more:** preflight (B12), redundancy (B7), grid/cue work
  (I46) and keys (I51) are load-bearing infrastructure. The AI layer is a
  real edge. Build §B and §I as written.
- **A few times a year:** half of §B and all of §F35 are elaborate
  cosplay. The honest roadmap is: 0a–0c, full tags (J53), fingerprints
  (L62), done. Revisit this doc after the next gig — and start the
  incident log below.
- **The missing input:** there is no record of what has actually gone
  wrong at a gig — no incident log, no "couldn't find a track in the
  booth" count, no sets-per-month. Add one line per gig to the sync log
  (`## YYYY-MM-DD gig — venue, what bit us`). One real incident outranks
  any idea in this file.

---

## Research notes — open-source landscape worth knowing (2026-09-04)

Repos and projects discovered during the research pass that map directly onto
ideas below:

| Project                                                                                                                                                                                        | What it is                                                                                                                                                                                                                             | Why it matters here                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [fragmede/rekordbox-pdb](https://github.com/fragmede/rekordbox-pdb)                                                                                                                            | **Read AND write** Python library for `export.pdb`/`exportExt.pdb` — dependency-free, byte-verified, validated by opening edited sticks in rekordbox                                                                                   | Moves legacy-pdb editing from "impossible" to "validate then adopt" (→ C18c). Rust port: `rekordbox_pdb` crate                       |
| [Deep-Symmetry/crate-digger](https://github.com/Deep-Symmetry/crate-digger)                                                                                                                    | Java + Kaitai spec for pdb/ANLZ; the canonical format docs                                                                                                                                                                             | Reference for parser edge cases; djl-analysis.deepsymmetry.org docs                                                                  |
| [Holzhaus/rekordcrate](https://github.com/Holzhaus/rekordcrate)                                                                                                                                | Rust parser for pdb, ANLZ, and `*SETTING.DAT` files                                                                                                                                                                                    | ANLZ cross-checks; SETTING.DAT parsing for a "player settings diff" idea                                                             |
| [Essentia models](https://essentia.upf.edu/models.html) (MTG/UPF)                                                                                                                              | Pretrained TF/ONNX models: MusiCNN auto-tagging, mood classifiers (happy/party/aggressive/sad/relaxed/acoustic/electronic), danceability, DEAM valence-arousal, MUSE embeddings                                                        | The whole AI vibe layer (§I) — ONNX weights mean no TF dependency                                                                    |
| [openmirlab/all-in-one-infer](https://github.com/openmirlab/all-in-one-infer/)                                                                                                                 | `pip install all-in-one-infer` — structure analysis (intro/verse/drop/outro), beats, downbeats, tempo + demucs stems, PyPI-only                                                                                                        | Structure-aware grids and auto cue placement (→ I46)                                                                                 |
| [yizhilll/MERT](https://github.com/yizhilll/MERT) + [MU-LLaMA](https://github.com/shansongliu/MU-LLaMA)                                                                                        | Music understanding encoder (95M/330M); MERT+LLaMA music QA/captioning                                                                                                                                                                 | Embeddings for similarity/dedupe; LLM track captioning (→ I49, I50)                                                                  |
| [mixxxdj/libkeyfinder](https://github.com/mixxxdj/libkeyfinder/)                                                                                                                               | The KeyFinder algorithm, GPL; 76% overall / **90% on dance music** vs rekordbox's own metadata at ~60% (Dubspot 2026 test)                                                                                                             | Key detection that beats rekordbox → tag + DB injection (→ I51)                                                                      |
| [scdl-org/scdl](https://github.com/scdl-org/scdl/)                                                                                                                                             | SoundCloud downloader — **as of v3 it is literally a yt-dlp wrapper**                                                                                                                                                                  | megadj already runs yt-dlp → SoundCloud sources are config work (→ K57)                                                              |
| [acoustid/chromaprint](https://github.com/acoustid/chromaprint) + [dupsonic](https://github.com/zas/dupsonic/) / soundalike                                                                    | Acoustic fingerprinting; dupsonic = fast Rust single-binary incremental dupe scanner                                                                                                                                                   | Cross-format dedupe, LOWQ-upgrade verification, untagged-file ID (→ L62)                                                             |
| [beetbox/beets](https://github.com/beetbox/beets) v2.4 + [beetcamp](https://github.com/snejus/beetcamp)                                                                                        | The music-tagger ecosystem; Bandcamp autotag/acquire plugin                                                                                                                                                                            | Borrow plugin ideas; Bandcamp source (→ J55, K58)                                                                                    |
| [gmunumel/track-list-extractor](https://github.com/gmunumel/track-list-extractor) · [1001-tracklists-api](https://github.com/leandertolksdorf/1001-tracklists-api)                             | 1001tracklists scrapers (Python)                                                                                                                                                                                                       | Discovery: mine DJ sets → download queue (→ K59)                                                                                     |
| [Quickie Music](https://quickiemusic.com/)                                                                                                                                                     | SaaS: drop folder → AI clean names, BPM/key, genre split → tagged ZIP + `.m3u8` for rekordbox. $4/mo                                                                                                                                   | Competitive proof the "one-shot prep" UX has value; megadj already owns every component (→ K61)                                      |
| [AlphaTheta library-format notice](https://alphatheta.com/en/information/important-notice-for-customers-using-usb-devices-with-our-dj-equipment/)                                              | Official two-format split: XDJ-XZ, CDJ-3000, RX3, RR, NXS2 = **Device Library** (export.pdb); XDJ-AZ, OPUS-QUAD, OMNIS-DUO, CDJ-3000X = **OneLibrary** only. rekordbox 7.2.11+ writes both on export                                   | Our dual-DB gate maps exactly onto Pioneer's official compatibility matrix (→ N75). Explains why the pdb gate _is_ the hardware gate |
| [CDJ-3000 v3.30 incident](https://djmag.com/tech/alphatheta-shares-guide-fix-playlist-issues-firmware-update)                                                                                  | Firmware pulled after DJs reported missing playlists (3.30 prioritized OneLibrary; rolled back to 3.22)                                                                                                                                | Venue firmware version is a real failure mode → preflight firmware-notes field (→ B12 note)                                          |
| [2026 stems comparisons](https://thedjmixtape.com/virtualdj-stems-vs-serato-stems-vs-rekordbox-stems/)                                                                                         | Blind tests: djay (AudioShake) best vocals on Apple silicon; VirtualDJ 5–6 stems; **rekordbox 7 rated ~3★**; Traktor/Engine pre-render                                                                                                 | Offline demucs stems (I46/I48) can _exceed_ rekordbox's own real-time stems — precomputed analysis is a legitimate edge              |
| [robertlestak/digarr](https://github.com/robertlestak/digarr) · [dean1850/musicdrome](https://github.com/dean1850/musicdrome) · [Snapyou2/re-command](https://github.com/Snapyou2/re-command/) | AI discovery loops: listening history (ListenBrainz/Last.fm) → MusicBrainz+AI similar-artists → scored approval queue → auto-download (ytmusicapi/Soulseek/Streamrip). Musicdrome's rule: _"a wrong file is worse than a missing one"_ | The exact architecture for megadj's discovery engine — taste source → AI → YTMusic resolve with confidence gating (→ N82)            |
| [mxschll/harmonie](https://github.com/mxschll/harmonie)                                                                                                                                        | Essentia embeddings + descriptors + **400 Discogs-style probabilities** in SQLite, HTTP similarity API                                                                                                                                 | Prior art for I45/I49 — possibly runnable as-is beside the archive instead of building from scratch                                  |
| [Claude Code agentic primitives](https://code.claude.com/docs/en/plugins.md) (skills, hooks, subagents, MCP, headless `claude -p`)                                                             | The 2026 agent-CLI taxonomy: SKILL.md for domain logic, hooks for lifecycle automation, MCP for tool exposure, headless one-shots for cron-able agents                                                                                 | megadj already ships skills + deckctl; next step is exposing the archive as MCP tools + agent loops (→ §O)                           |

---

## A. Finish what's already in flight (this week)

_(Post-audit: the hardware-clock items moved up to §0 — SSD evacuation is
0a, OLDUSB verdict is 0c, cold backup is 0b. This section keeps the
remaining in-flight work.)_

1. **Drive dossier & health report — ✅ SHIPPED 2026-09-04.**
   `cratedeck/src/report.ts` computes the dual-DB gate, grid coverage, and
   one-JSON dossier per drive; live at `GET /drives/:id/report`, folded into
   the `/drives/:id/export` dossier, rendered in the drawer's Report tab,
   covered by `cratedeck/test/report.test.ts`. Remaining sliver: a
   print-styled HTML one-pager (idea #37).
2. **Consolidate `tools/` — ✅ DONE** (post-audit 2026-09-04: ingest
   absorbed zip expansion, artwork embedding, and dedupe in `a4ace28`/
   `76b344a`; Sep 2026: all art/genre passes consolidated into
   `fetch_all.ts` — `art_final`, `pack_art`, `sc_art_direct`, `sc_genres`,
   `normalize_genres`, `sync_genres`, `ai_genres` retired; Sep 4 2026:
   ingest module split `probe/art/identity/remix/energy` + `wav-to-aiff`).
3. **WAV artwork in rekordbox — ✅ DONE 2026-09-04** (73/73 via
   `tools/rb_art.py`, thumbnail gotcha fixed; see
   `docs/rekordbox-wav-artwork.md`). Remaining sliver: spot-check covers
   on the XDJ-XZ at the next export.
4. **Close the 2026-09-03 sync-log checklist.** Three pending items remain
   (the fourth, SSD evacuation, is now §0a):
   - `usb_verify.py` hardware gate (pdb live rows == OneLibrary, both drives)
   - `usb_mirror.py --verify-only --hash-parity` post-export drift check
   - Update `~/rekordbox-exports/STATUS-FINAL.md` counts
5. **OLDUSB verdict — now §0c** (promoted; do before the cloud backup).
6. **CrateDeck acceptance doc — ✅ DONE 2026-09-04:**
   `docs/cratedeck/acceptance.md` now exists with code-verified evidence per
   PRD feature; remaining ☐ items are the real-hardware checks.

---

## B. CrateDeck: the fleet superpowers (v1.0 finish line)

These are the PRD features that _only exist because the app sees all drives at
once_ — the moat. Roughly in value order:

6. **Coverage matrix — ✅ SHIPPED 2026-09-04.** `cratedeck/src/fleet.ts`
   (`coverage()` + `trackLocations()`) over new per-track fleet tables
   (`fleet_tracks`/`fleet_playlist_entries`/`fleet_manifest`, refreshed by
   every scan via `db.setSnapshot`); full scan now emits per-track +
   playlist-entry rows (`cratedeck/python/rb_read.py`), light scan emits an
   audio manifest. UI: Fleet page → Coverage tab (`#/fleet/coverage`):
   unique-track/copy totals, at-risk (1-copy) list, "where is this track?"
   lookup (exact path / artist-title / substring). CLI: `deckctl coverage`.
   API: `GET /api/fleet/coverage`, `GET /api/fleet/track?q=`. Covered by
   `cratedeck/test/fleet.test.ts`.
7. **Redundancy audit — ✅ SHIPPED 2026-09-04.** `fleet.ts redundancy()`
   unions playlist entries across drives and verdicts each playlist:
   fail = a track on a single drive, warn = below floor, pass = all ≥N.
   UI: Fleet → Redundancy tab with expandable per-playlist gap lists (every
   gap shows its drive locations). CLI: `deckctl redundancy`. API:
   `GET /api/fleet/redundancy?min_copies=`. Same test coverage.
8. **Fleet diff — ✅ SHIPPED 2026-09-04.** `fleet.ts diff()`: added /
   removed / changed between any two drives; DB tracks define add/remove,
   scan manifests give byte-level changed detection; `artist - title`
   meta-join catches the same track at different paths. UI: Fleet → Diff
   tab (pick two drives, filterable results). CLI:
   `deckctl diff A B`. API: `GET /api/fleet/diff?a=&b=`.
9. **Global search across ghosts.** ⌘K box querying all snapshots — "do I own
   this anywhere, and on which stick?" Already specced (F9); highest daily-use
   feature in the whole app.
10. **Snapshot timeline & "what changed".** Versioned diffs between any two
    scans: "what changed on OLDBACKUP between the Nov 14 gig and now?"
11. **Set intelligence.** Harvest player-written history (`HIST` entries on the
    drives) across the fleet → most-played, never-played, set reconstruction
    with timestamps → export as CSV/markdown/Spotify-searchable track list.
    The data is already sitting on the sticks rotting.
12. **Preflight check.** Pick drives → single pass/fail checklist: sync state,
    grid coverage, integrity, bench trend, free space, _firmware-relevant
    notes_ (e.g. PRO DJ LINK had a security advisory in 7.2.17 — worth a
    "players on old firmware" line). One click before every gig.
13. **Benchmark sparklines + anomaly alerts.** `bench.ts` already stores
    seq/rand4k history. Render the sparkline; alert when a drive's read speed
    drops >40% between runs (the brief's vNext item, and it's ~free).
14. **Port map & loan tracking.** ioreg topology at mount → user-labeled ports
    ("MBP left rear", "hub slot 2"); port history per drive; "lent to \_" flag
    with a due-back note. The brief's pillar 10 (v1.1) — start with just the
    mount-event history, which `registry.ts` already logs.
15. **QR / Dymo labels.** Print a small QR per drive linking to its local
    dossier page. Physical-world glue for ~zero code (the dossier from #1 is
    the payload).
16. **Menu-bar companion.** Tail of the brief's vNext: a tiny SwiftUI/
    `swiftbar`-style menu item showing interlock state + mount events +
    "N drives, 1 needs attention". Alternative cheap version: `bun run deck`
    notification hooks (osascript) on mount/interlock — ship that first.
17. **Watch-folder auto-scan + auto-verify schedule.** FSEvents is already
    event-driven; add "on mount → light scan automatically, full verify
    weekly" with results feeding the readiness badge. Removes the last
    reason to open the page manually.

---

## C. Sync pipeline: kill the remaining manual pain

18. **Automate the legacy-export dance.** The XDJ-XZ-facing `export.pdb`
    still requires the manual human loop: XML → rekordbox UI import → drag
    playlists → analysis → USB export. Ideas, in escalating ambition:
    a. _Assisted runbook_ — CrateDeck drives the human: checklist UI with
    per-step done-buttons, auto-detecting each stage's completion (pdb
    row counts, playlists3*.sync mtimes) so you can't miss a step.
    **This is the right buy.** Priced honestly: it captures ~most of
    the value of automation (no missed steps, auto-detection of stage
    completion) at none of the risk. The dance runs a few times a
    month at most; the runbook makes those few times un-failable.
    b. *rekordbox scripting* — watch for a stable AppleScript/CLI surface
    in rekordbox 7.x; automate import/export trigger.
    c. **Legacy-pdb editing — kept written down and UNBUILT.**
    `fragmede/rekordbox-pdb` is a dependency-free Python read/**write**
    library for `export.pdb`/`exportExt.pdb`, byte-verified and
    validated by opening edited sticks in rekordbox. The gauntlet is
    right: clone a real drive image → edit → re-open in rekordbox →
    rekordbox re-export → `usb_verify.py` ALL PASS, before any rule
    change. But price it honestly: **upside** = deleting a manual dance
    done a few times a month; **downside** = a corrupted library
    discovered at a venue, on hardware, in front of people. The
    asymmetry is terrible unless batch frequency is much higher than
    it is. The gauntlet stands as written; it exists so that if this
    is *ever\* built, it's built safely — not as a to-do.
19. **Grid quality upgrade pass.** Generated grids are constant-BPM; the
    2026-09-03 rekordbox re-analysis fixed the first 294. Add a CrateDeck
    "grid provenance" field (rekordbox-native vs synthetic) to snapshots and
    a queue view: _these N tracks still have synthetic grids_ → prioritize a
    re-analysis export. On stage, a drifting track with a straight grid is
    the exact failure this repo exists to prevent. (See also I46: make the
    synthetic grids _phrase-aware_ instead of constant.)
20. **Full-length waveform fill.** Synthetic PWAV/PWV2 cover the first 30s.
    `usb_sync.py` could generate full-duration previews from the decoded
    audio (librosa is already a dependency). Medium effort, big browse-experience
    win on hardware.
21. **Differential mirror.** `usb_mirror.py` is resumable but
    manifest-first; make it skip-identical-by-(size,mtime,hash-cache) at
    scale so the weekly mirror run is minutes, not hours. The checksum
    ledger (`bench.ts`) becomes the mirror's change detector.
22. **Scheduled unattended sync + notify.** Wrap sync→mirror→verify as one
    CrateDeck job ("Sync everything"), runnable from the UI, with macOS
    notification + timeline entry on completion. With the interlock
    (`pgrep rekordbox → refuse`) this is finally safe to run casually.
23. **Retirement workflow.** When bench trend + age cross thresholds, the
    drive card proposes "retire to cold backup" — a guided, dry-run-first
    migration of its contents to another drive (the brief's v1.2 mirroring,
    scoped to this one flow). Pairs with #4/#19 and the dying-SSD lesson.

---

## D. megadj archive & ingest

24. **LOWQ re-fetch queue.** `megadj list` already flags <250 kbps tracks.
    Add `megadj upgrade` — re-resolve those video IDs at today's best format
    (256 AAC), verify via ffprobe, swap atomically, keep the old file until
    hash-verified. The library only ratchets up in quality. (L62 adds
    fingerprint verification that the replacement is truly the same track.)
25. **Duplicate hunter across the whole estate.** One tool, three inputs:
    archive DB, master manifest, mirror manifest. Catches: byte-variant rips
    at the same path (the Aug-25 class), same-track-different-title, and
    LOWQ/HiQ pairs. The audio-parity logic in `usb_mirror.py` is the seed;
    L62's fingerprints make it content-based, not name-based.
26. **MusicBrainz deepening.** `ingest` fills albums/dates; next: label +
    catalog number + relation credits (producer/remixer) → better composer
    tags, and MBID provenance (already embedded — surface it in CrateDeck
    track tooltips for "where did this metadata come from").
27. **Energy / mood fields.** Ingest v2 touched energy — extend: librosa RMS
    - spectral features → an energy 0–10 and a rough vibe tag per track,
      written to ID3 and shown in CrateDeck. Enables "warm-up vs peak time"
      filtering that rekordbox can't do natively. Cheap because analysis
      already runs during ingest. **(Superseded/leveled-up by §I: pretrained
      models make this dramatically better than hand-rolled features.)**
28. **Genre governance.** `fetch_all.ts`'s genre stage (SC tags + canonical
    map + OpenRouter classifier) + MusicBrainz genres +
    your own conventions → one canonical genre vocabulary file, with an audit
    report of strays. Prevents the folder tree (organize) from forking into
    `Hip-Hop` vs `HipHop` vs `Rap`. Essentia's MusiCNN genre models (§I45)
    can vote alongside LLM/AI genre and MusicBrainz.
29. **Archive → playlist automation.** "Everything ingested since last gig"
    as an auto-generated rekordbox playlist on the next sync — closes the
    loop from download to playable-without-touching-rekordbox.
30. **Archive integrity cron.** Nightly checksum sweep of `~/Music/DJ-Imports`
    vs the archive DB (sizes + blake2b), reporting bitrot/silent truncation
    before it ever reaches a drive. Mirrors the drive-side ledger, so reuse
    the same hash module.

---

## E. Format & platform expansion (careful)

31. **Engine DJ read support.** The brief's vNext item and the right next
    format: Denon Engine DBs are SQLite (no encryption dance), Engine DJ 4.x
    is on Smartlists/stems, and a lot of venue gear runs Engine. Read-only
    inventory first: a drive could be _both_ a rekordbox export and an Engine
    library — CrateDeck should describe both. Keep the Python seam rule: one
    `engine_read.py`, no TS ports.
32. **Spotify-on-CDJ era readiness.** rekordbox 7.2.16–7.2.18 added Spotify
    sign-in on CDJ/XDJ with streaming tracks visible in EXPORT mode (but not
    loadable via USB). Implication for the fleet model: track _sources_ per
    track (local file vs streaming-linked) in snapshots, so the preflight can
    warn "this playlist is 40% Spotify-linked — it won't play from a USB at
    the venue." That check is genuinely valuable right now.
33. **Request Catalog / CoBeat awareness.** rekordbox 7.2.16 added Request
    Catalog + CoBeat support. Not core, but if you play venues using it,
    a "requests received while gigging" capture could feed set intelligence
    (#11). Park until you actually use it.
34. **Multi-machine catalog merge.** Brief vNext: if the dashboard ever runs
    on a second Mac (studio vs laptop), SQLite + snapshot JSONs merge by
    drive UUID with last-writer-wins per field and an event-log union.
    Design the merge key _now_ (drive UUID + event ULIDs) so this stays cheap
    later — `db.ts` already uses UUIDs, just don't regress it.

---

## F. Delight / 10x polish

35. **Gig mode, end to end.** One click: drive marked out-for-gig (date, venue
    note) → preflight runs → on return, "history harvest" pulls the set into
    the timeline → tour history per drive renders as a passport stamp wall.
    Pure UI over existing events, huge emotional payoff.
36. **Crate-card physicality.** Cards subtly reflect real state: dust on
    ghosts (last seen >60d), a crack on ATTN drives, wobble animation while
    a job runs. On-brand, zero data work.
37. **Dark-mode print dossier.** The dossier (#1) in a print stylesheet —
    folded into a borrowed stick's bag. The brief calls this the "5-second
    answer for a borrowed stick."
38. **Voice/shortcuts integration.** "Hey Deck, is OLDBACKUP ready?" — a
    one-route JSON API (`GET /verdict/:drive`) + a Shortcuts app action.
    Almost free given the report module exists.
39. **Weekly digest.** Monday-morning markdown/email digest: drives needing
    attention, new music not yet exported, sync state, any bitrot. Makes the
    tool _come to you_ instead of waiting for a glance.

---

## G. Wilder swings (parking lot)

40. **Cold cloud backup of the master — ✅ PROMOTED to §0b (2026-09-04
    audit).** The redundancy audit (#7) diagnoses the single-device
    problem; B2/R2 via rclone cures it — read-only, no rule violations, a
    weekend of work. It was misfiled here as a wild swing when it's the
    only protection against _all_ drives failing at once. Kept in §G
    solely so numbering stays stable.
41. **PRO DJ LINK listener.** CDJs on the same network broadcast status
    (beat, BPM, deck load) — a passive listener could log _actual_ live
    playback into the timeline, making set intelligence (#11) automatic even
    without history harvesting. Needs venue-network cooperation; park.
42. **Counterfeit-capacity test as a first-class job.** Write-verify a
    bounded random pattern across claimed capacity (manual, warned, per the
    brief). Catches fake sticks before they eat a library.
43. **Rekordbox master library introspection (read-only).** Beyond
    `rekordbox.xml`: the Mac `master.db` (19 MB, decrypted via
    pyrekordbox) would give live collection state for diffing without
    asking you to re-export XML. Risk: schema drift; keep it strictly
    read-only and behind the same seam discipline.
44. **Serato crate export.** Non-goal to _read_ Serato, but a one-way
    _export_ of playlists as Serato crates costs almost nothing and helps
    guest DJs. Only if a guest DJ actually asks.

---

## I. AI & audio analysis (the vibe layer)

The big unlock from the research pass: **pretrained models have made
"AI analyzer" a pip-install away**, and megadj's pipeline is the perfect
consumer — it already decodes audio, already writes tags, already injects DB
rows. All models below run offline/local; nothing in the cloud, matching the
product principles. Everything computed here feeds three sinks: **ID3/TXXX
tags** (§J), **the archive DB**, and **the rekordbox/ANLZ injection path**.

45. **Essentia mood & vibe suite.** ONNX models from the MTG Essentia
    collection, run per track at ingest:
    - mood classifiers: happy / party / aggressive / sad / relaxed /
      acoustic / electronic (MusiCNN + VGGish/YAMNet variants, pick by AUC)
    - `danceability` and `aggressiveness` scalar classifiers
    - DEAM **valence–arousal** regression → a 2D emotion plane per track
      (plots as a scatter in CrateDeck — the "vibe map")
    - MUSE embedding (200-d) stored in the archive DB for later similarity
      Effort M (Python side only; `uv run --with essentia` like the existing
      librosa pattern). This replaces idea #27's hand-rolled RMS features with
      research-grade ones.

46. **Structure-aware grids & cues (all-in-one-infer).** `pip install
all-in-one-infer` gives beats, downbeats, tempo, and **functional
    segment labels** (intro / verse / drop / chorus / break / outro) plus
    demucs stems. Pipe segment boundaries into the existing ANLZ generator: - **memory cues auto-placed at intro/drop/outro, downbeat-aligned** —
    the single biggest on-hardware quality-of-life jump available - phrase-aware synthetic grids (the current constant-BPM grid gets
    downbeat anchoring; tempo curve from the analyzer instead of a flat line) - "drop only" browsing structure on CDJs via cue placement convention
    **Honest label: the genuine 10x item and the likeliest to eat a
    month.** It earns the complexity because constant-BPM synthetic grids
    are a real on-stage failure mode (a drifting track with a straight
    grid fights the beatjump logic). Scope it in slices: cue placement
    alone is shippable in a weekend; the tempo-curve grid upgrade is the
    month-long part and can land later. Effort M-L.

47. **Auto hot-cue archetypes.** rekordbox 7's in-app "learning" places cues
    by your habits; replicate offline with segment labels: cue A = intro,
    B = first drop, C = break, D = outro across the whole library, so every
    track behaves the same on hardware. Falls out of I46 nearly free.

48. **Mixability metrics from stems.** demucs-infer (dependency of I46) gives
    vocal/instrumental separation — compute vocal-presence ratio → a
    "vocal density" tag (instrumental / light vocal / full vocal) which is
    exactly the field DJs filter by but no tag source provides. Note: stems
    files themselves stay out of scope (CDJs can't play them); this is an
    analysis-side metric only.

49. **Embeddings & "sounds like".** MERT-95M (or reuse MusiCNN MUSE
    embeddings from I45 — much cheaper) per track → kNN similarity in the
    archive DB → CrateDeck "find tracks like this" + "never-played tracks
    closest to what you actually play." sqlite-vec or plain blob +
    cosine scan is fine at 3–10k tracks. Effort M.

50. **LLM track captioning (vibe notes).** Feed Essentia tags + structure
    labels + metadata to a local/small LLM (the ask-models MCP pattern, or
    MU-LLaMA-style locally) → a one-line vibe description per track
    ("warm late-night house groover, long intro, vocal drop") written to
    the comment tag and shown in CrateDeck. **Honest bet, from the audit:
    you'd read these twice and never filter by them.** Keep only as a
    `megadj drop` garnish (one line in the CLI output) unless it proves
    itself; do not build infrastructure for it. Effort S.

51. **Key detection that beats rekordbox.** Dubspot's 2026 lab test:
    libKeyFinder scored 76% overall / **90% on dance music**; rekordbox's own
    metadata ~60%. Options: `keyfinder-py` bindings (stale but working),
    libkeyfinder via a tiny C++ build, OpenKeyScan (CNN-based, modern), or
    Essentia's built-in `Key` algorithm as the cheap baseline. Write
    Initial Key + Camelot to tags (§J), inject `key_id` into device DB rows,
    and add a **harmonic-mix panel** in CrateDeck: pick a track, see the
    Camelot-compatible candidates already on the same drive. Effort S-M.
    _(The audit's verdict: best payoff-per-risk in the AI section —
    verifiable against ground truth, writes a field hardware already
    reads, immediate mixing value.)_

52. ~~**Personal affinity model.**~~ **DELETED (2026-09-04 audit).** A
    trained "will I play this" classifier was fantasy until B11 harvests
    real set histories — and if that day comes, its bounded sibling now
    lives at M64 (hit predictor). This slot is intentionally empty; a
    new idea takes this number when an old one ships.

---

## J. Full-depth tagging (ID3 and beyond)

The tagging side of the request: make every file _fully_ tagged — not just
title/artist, but the complete DJ-useful frame set, idempotently, with one
pass. One mutagen pass (Python side), one schema, everything else reads it.

53. **The full frame schema.** Define once in the skill docs, apply in
    `ingest` + `upgrade`:
    - `TBPM` (integer BPM, already), `TKEY` (Initial Key, from I51)
    - `TCOM` composer + `TIPL`/`IPLS` producer/remixer credits (MusicBrainz
      relations — extends idea #26)
    - `TPUB` label, `TMED` source (YTM/SoundCloud/Bandcamp/CD rips)
    - `TXXX` custom: `MBID` (already embedded), `ACOUSTID` (L62),
      `ENERGY`, `VALENCE`, `AROUSAL`, `DANCEABILITY`, `VOCAL_DENSITY`,
      `SOURCE_URL`, `VIBE` (the I50 one-liner), `CAMELOT`
    - `COMM` comment = vibe line + camelot, so it shows on any player screen
      Effort S. This is what "full tagging" means operationally.

54. **Artwork standardization.** Extend `fetch_all.ts`'s art stage: target
    1400×1400 (or 600×600) JPEG, type-3 front-cover frame, consistent
    quality; keep the AI-artwork fallback path. Feeds both ID3 `APIC` and
    the ANLZ `PWAV`-adjacent artwork pipeline rekordbox reads. Effort S.

55. **Borrow the beets ecosystem, don't adopt it.** beets v2.4's plugin ideas
    map 1:1 to backlog items: `badfiles` (→ #30 integrity), `duplicates`
    (→ #25/L62), `fetch`/`lastgenre` (→ #26/#28), `edit` (batch tag fixes as
    a CLI flow). Keep megadj single-CLI (workspace rule) — steal ideas, not
    the dependency. If a wall is hit, beets can be run _on_ the archive as an
    escape hatch since files are standard.

56. **Synced lyrics (low priority).** LRCLIB open lyrics API → USLT/SYLT
    frames. Hardware players won't show them; value is archive search and
    future crate tools. Only if bored.

---

## K. Scrapers, sources & discovery

megadj's soul is acquisition-with-taste. The research shows the multi-source
road is shorter than expected because **yt-dlp already covers most of it** —
scdl v3 is literally a yt-dlp wrapper now, and multidl proves the rest with
per-platform JSON extractors.

57. **SoundCloud as a first-class source.** Since megadj drives yt-dlp
    directly, SoundCloud support is mostly config + normalization:
    - favorites sync (`-f` model in scdl) mirrors the existing
      liked-songs design — same archive DB, new `source=sc`
    - Go+ 320 kbps streams via OAuth token header (`Authorization: OAuth`)
    - reposts, playlists, artist pages as syncable sources
    - scdl (4063★) remains the reference for URL-type detection and ID3
      conventions; the wrapper itself can be ignored
      Effort S-M. This is the single biggest library-expansion lever.

58. **Bandcamp + long-tail platforms.** beetcamp (beets plugin) proves
    Bandcamp's `data-tralbum` JSON is scrapeable for full-quality streams;
    multidl documents audiomack, hearthis.at, ReverbNation, archive.org,
    Jamendo extractors. Add as `megadj sync --source bandcamp` style
    sources one at a time, gated by the same probe/quality pipeline. Effort
    S per platform. Bandcamp first (best audio, artist-friendly).

59. **1001tracklists mining → discovery queue.** Scrape tracklists of DJs
    and shows you actually follow (track-list-extractor is a clean FastAPI
    wrapper; 1001-tracklists-api a BeautifulSoup lib; both small):
    - "track appears in N sets in the last 90 days" ranking
    - diff against archive → "played everywhere, not in your library" queue
    - one keypress: enqueue for download via #57/#58/YTM
      This turns megadj from an archiver into a discovery engine. Effort M
      (respect the site: rate-limit, cache, personal use only).

60. **setlist.fm mining (low priority).** Free API key, clean Python client
    (`setlist-fm-client`). Only useful for non-DJ gig mining; park.

61. **Quickie-style one-shot mode (`megadj drop`).** Quickie Music charges
    $4/mo for: drop a folder → AI name cleanup, BPM/key detection, genre
    split → tagged files + `.m3u8` → "rekordbox-ready." megadj already owns
    every component (ingest, BPM, keys via I51, genres via #28, artwork,
    playlists, even ANLZ generation which Quickie can't do). Glue them into
    one command: `megadj drop <folder-or-url>` → clean → analyze → tag →
    organize → optional "stage for next drive sync." Local, free, better.
    Effort S-M (pure composition). Also a natural public demo of the repo's
    capabilities someday.

---

## L. Fingerprints, dedupe & identity

62. **Acoustic fingerprint ledger (Chromaprint/AcoustID).** Store a
    chromaprint fingerprint per archive file (via `fpcalc`, one Homebrew
    dep, or pyacoustid). Unlocks, in order of value:
    - **cross-format dupe detection** — same recording at different
      bitrate/format/path (the LOWQ/HiQ pair case, name-blind)
    - **verify `megadj upgrade` swaps** (#24): re-fingerprint the new file,
      confirm same recording, _then_ delete the old — no more trust-in-URL
    - **untagged-file identification** via the free AcoustID lookup API
      (`megadj adopt` gets smarter)
    - drive-side audit: fingerprint sampled files on a stick vs archive —
      catches the wrong-byte-variant-on-mirror class forever
      Reference tools: dupsonic (Rust, incremental, LSH, single binary) and
      soundalike — usable as-is, or steal the incremental-scan design. Effort
      S-M.

63. **Fingerprint the mirror.** Once #62 exists, a `--fingerprint-sample N`
    flag on `usb_mirror.py --verify-only` that content-checks N random files
    per drive per run instead of trusting size+mtime alone. Closes the last
    "identical bytes ≠ identical audio" gap. Effort S.

---

## M. Cool AI things & annoying-Mac-DJ problems (2026-09-04 addendum)

Born from the audit: the fun-but-dangerous section gets a dedicated home,
plus a list of the everyday Mac-DJ irritations nobody builds for.

### AI ideas (the cool list)

64. **Listening-based hit predictor.** Essentia DEAM + danceability +
    embedding (I45) → a "will the floor like this" score calibrated on
    which of your tracks actually got played (needs B11 history harvest).
    Sibling of the deleted I52 but bounded: one number, no model
    training, just a regression you can sanity-check. Parked until
    history exists — listed so it's not forgotten.
65. **Auto DJ-friendly renamer.** YTM filenames are garbage
    (`(Official Audio)`, ft. soup, emoji, `&` vs `and`). An LLM pass at
    ingest normalizes to a strict `Artist - Title (Remixer)` convention,
    verified against MusicBrainz, with a diff view before apply. FAT32-
    safe length checks built in (the case-collision lesson, applied
    upstream). Effort S.
66. **Set-builder copilot.** Give it: target gig length, venue vibe, the
    drive contents. It proposes ordered sequences using BPM/key-compat +
    energy arcs (valence-arousal from I45), rendered as a CrateDeck panel
    with drag edits. Never auto-exports; proposes only. This is the
    ChatGPT-for-crate-digging feature, and unlike I50 it produces an
    artifact you act on. Effort M.
67. **"Find the double-drop" detector.** Scan the library for pairs of
    tracks whose grids + keys align so well they can be layered (acapella
    over instrumental). Classic mashup hunting, done by embeddings +
    grid math instead of memory. Pure analysis over data §I already
    computes. Effort M.
68. **Voice memo → crate.** After a gig, AirDrop the phone voice memos
    ("that ID at 1am was...") → Whisper transcribes → LLM resolves
    fuzzy titles → cross-checked against 1001TL mining (K59) and
    SoundCloud search → candidate queue in the archive DB. Closes the
    "what was that track" loop with zero typing. Effort M.

### Annoying things for DJs on Mac (the irritation list)

69. **The format-eject dance.** Every DJ knows: macOS wants to APFS-format
    new sticks, CDJs want FAT32 with an MBR partition scheme, and Disk
    Utility hides the "Master Boot Record" dropdown three dialogs deep.
    `megadj format <volume>` — one command, correct FAT32/GPT answers for
    target players (XZ/CDJ-3000 vs OPUS-QUAD), refuses to touch a volume
    with a rekordbox tree on it, prints the exact `diskutil` invocation
    for review. Effort S.
70. **macOS metadata litter audit.** `._*` AppleDouble files, `.DS_Store`,
    `.Spotlight-V100`, `.Trash` on FAT32 sticks — CDJs choke or slow-walk
    on these, and Finder recreates them every mount. Extend the existing
    scan junk detection with a **one-click clean** (guard.ts-gated,
    allow-listed files only) plus a `defaults write com.apple.desktopservices`
    hint sheet so Finder stops polluting in the first place. Effort S.
    (PRD F7 already counts orphans — this finishes the thought.)
71. **"Why is my transfer 8 MB/s?" — port-speed truth serum.** macOS never
    tells you a stick landed in a USB 2 port, or that a hub is capping
    the bus. CrateDeck already captures the USB topology at mount (F2) —
    surface negotiated speed as a loud card badge + a "this drive would
    be 4× faster in the other port" note in the port map. Zero new
    hardware access; it's presentation of data already collected. Effort S.
72. **Sleep/wake drive-mace.** macOS aggressively spins down USB drives;
    the first CDJ-track-onload after idle stalls. A tiny optional launchd
    helper keeps gig drives awake while mounted (`caffeinate -i` scoped
    to the volume, auto-clears on eject). Include the honest caveat:
    wears flash slightly, use on gig day only. Effort S.
73. **Finder-bait guard.** Accidentally dragging the `PIONEER/` folder to
    Finder instead of `Contents/` is a classic library-mangling move.
    A Finder symlink farm is risky (FAT32 has no symlinks) — instead:
    CrateDeck detects a drive mounted with `PIONEER/` at unexpected depth
    or a `Contents/`-less PIONEER tree and screams. Cheap heuristic,
    catches the mistake _before_ the sync run does, when it's still
    fixable. Effort S.
74. **Bulk-playlist → folder audio exporter.** iOS/venue-CDR/guest-DJ
    reality: someone wants "just the party playlist" as plain files.
    Export any playlist (drive DB or archive) → sorted, renamed, tagged
    folder + optional `.m3u8`. Reuses ingest machinery in reverse; the
    Quickie competitor feature K61 in mirror-image. Effort S.

---

## N. XDJ-XZ / Pioneer ecosystem / house & techno (2026-09-04 research addendum)

Grounded in the official AlphaTheta compatibility notice + the 2026 stems
comparisons. The repo's XDJ-XZ is the reason the dual-DB gate exists — the
ecosystem research confirms the architecture is aimed at the right wall.

75. **Hardware compatibility matrix as data (Device vs OneLibrary).**
    AlphaTheta's notice gives the official split: XDJ-XZ, CDJ-3000, RX3,
    RR, XDJ-1000MK2, XDJ-700, NXS2 generation = **Device Library**
    (export.pdb); XDJ-AZ, OPUS-QUAD, OMNIS-DUO, CDJ-3000X = **OneLibrary
    only**. Encode it as a config file (`players.toml`), not code:
    CrateDeck reads it and annotates every drive with "plays on: XZ ✓,
    AZ ✗" style badges derived from the _actual_ DB rows measured (pdb
    live rows == OneLibrary rows == the gate we already compute). When
    the fleet gains a CDJ-3000X or AZ, the matrix makes the gap visible
    before a gig, not at the venue. Effort S — mostly data entry.

76. **Preflight firmware-notes field.** The CDJ-3000 v3.30 incident
    (firmware pulled after DJs' playlists vanished; OneLibrary
    prioritized over Device Library; rolled back to 3.22) is the newest
    recurring nightmare class. Preflight (B12) gains a manual,
    per-player firmware field + a link-check against AlphaTheta's
    notice page, plus a rule of thumb rendered in the UI: _drive shows
    on the player but playlists are empty → check which library format
    that firmware prioritizes._ Effort S.

77. **XDJ-XZ-specific export profile.** The XZ reads Device Library
    only, supports FAT32/exFAT/HFS+ (NTFS no; GUID partition map no;
    case-sensitive HFS+ no), and firmware updates require FAT/FAT32 +
    MBR. Today this knowledge lives in humans and skill docs. Encode it:
    `megadj format --profile xdj-xz` (M69) defaults to exactly the right
    scheme, and CrateDeck flags a drive formatted case-sensitively or
    GUID-partitioned as incompatible. Effort S.

78. **"Which players will this stick actually work on?" — the fleet
    answer.** Combine N75's matrix + the measured dual-DB state + format
    profile into a per-drive verdict: _Device Library current ✓, pdb ==
    OneLibrary ✓ → works on XZ + CDJ-3000 generation; OneLibrary-only
    content → AZ/OPUS/3000X only._ This is the thing rekordbox cannot
    tell you at all and the single clearest expression of what megadj is
    for. Falls out of B12 + N75 nearly free. Effort S.

79. **Genre-normalized house/techno taxonomy.** The 400-Discogs-styles
    model (harmonie) + Essentia genre classifiers give every track a
    machine-vote (`tech-house`, `deep-house`, `peak-time techno`) to
    arbitrate against the LLM genre (already shipped) and MusicBrainz.
    Output: one normalized genre + a styles[] array in the archive DB,
    feeding smarter "more like this" in the crate copilot (M66) and the
    1001TL discovery ranking (K59). Replaces the ad-hoc SC-tag voting
    in `tools/sc_genres.ts` with something principled. Effort M.

80. **Energy-arc presets per genre.** House/techno sets live on
    energy curves, not just BPM. With I45's valence-arousal + danceability
    per track, define presets ("warm-up", "peak", "afterhours") as
    valence/energy envelopes, and have the crate copilot (M66) assemble
    against a chosen envelope. This is the "play a warm-up set" button,
    grounded in measured track features rather than vibes. Effort M.

81. **Stems-as-metadata (offline, exceeding rekordbox's own).** The 2026
    comparisons rate rekordbox 7's real-time stems ~3★ while offline
    demucs/AudioShake-class models lead blind tests. megadj's pipeline is
    offline by design: render stems at ingest (I46 demucs pass), store
    vocal-density + instrumental-ness (I48), and _later_ (explicitly
    parked, non-goal today) consider pre-rendered stem files for players
    that support them (Engine-style). The near-term win is analytical:
    every track gets instrumental/acapella/drum ratings that CDJs can't
    compute but DJs constantly need. Effort M.

---

## O. Agentic megadj (Codex / Claude Code as first-class operators)

The 2026 agent-CLI taxonomy (skills, hooks, subagents, MCP, headless
one-shots) maps onto megadj with almost no new code — the CLI and deckctl
already exist. These ideas make agents _safe, useful operators_ of the
library, not gimmicks.

82. **megadj MCP server.** Expose the archive + deckctl as MCP tools:
    `search_tracks`, `track_stats`, `drive_status`, `drive_report`,
    `enqueue_job` (scan/verify/checksum only — never mirror/format),
    `playlist_diff`. Any MCP client (Claude Code, Codex, Cursor) can
    then answer "what's on the XZ", "what did I ingest last week", "run
    a checksum on DJMIRROR" in natural language, with the interlock
    enforced inside the tool layer. Bun + the official MCP SDK; the
    tools are thin wrappers over existing functions. Effort M.

83. **Weekly agent prep loop (headless).** A cron-able one-shot:
    `claude -p "run the megadj weekly prep skill"` style — or a plain
    shell entry that calls deckctl + fetches a digest. It runs: archive
    integrity sweep (D30) → drive scan deltas → redundancy check (B7) →
    new-music-not-yet-exported report → posts a markdown digest (file
    or notification). The agent writes _nothing_; it only reads and
    reports. This is the weekly digest (F39) implemented by an operator
    that never gets bored. Effort S-M.

84. **Inbox-to-crate agent.** "Dump this folder/zip/URL list, get clean
    tagged files": combine `megadj drop` (K61) with an agent loop that
    handles the judgment calls (dupe resolution, genre arbitration,
    artwork picks) by asking the human only when confidence is low.
    The agent drives `ingest --dry-run`, presents the plan, executes on
    approval. Skills already exist for intake; this wraps them in a
    conversation. Effort M.

85. **Skill/plugin packaging.** megadj ships 3 skills today. Package the
    set as an installable Claude Code plugin (skills + hooks + MCP
    manifest) so the _whole DJ-ops surface_ installs into any Claude
    Code instance: interlock-aware job skills, the intake runbook, the
    discovery queue. Also the natural open-source artifact if this repo
    ever goes public. Effort S once 82 exists.

86. **Agent safety rails (the non-negotiable half).** Whatever the
    agent layer looks like: mutating tools (mirror, format, anything
    touching drives) are either absent from the MCP surface or gated
    behind an explicit confirm-tool-call pattern; the interlock check
    lives in the tool layer, not the prompt (prompts are suggestions,
    exit codes are law); every agent-initiated action lands in the
    timeline events log with the agent's session id. The doc's existing
    non-goals all still apply to agents, twice over. Effort S.

---

## H. Explicit non-goals (unchanged — say no)

- ❌ Writing device DBs outside rekordbox (`export.pdb`/`exportLibrary.db`
  injection stays in the proven pipeline only) — _C18c's validation
  gauntlet is written down precisely so this rule only ever changes
  deliberately and safely; until then, unbuilt._
- ❌ Editing tags/cues/grids _on drives_; rekordbox owns creation
  (analysis-derived tags live in the _files_ and our own DB/ANLZ pipeline)
- ❌ Cloud sync, accounts, multi-user, telemetry (§I models run locally)
- ❌ Audio playback/scrubbing in CrateDeck
- ❌ Mobile app (a localhost PWA-ish responsive pass is fine; native is not)
- ❌ Becoming a general DJ library manager — describe & verify, don't create
- ❌ Aggressive scraping of flaky sources: personal-use rate-limited only,
  cache-first, never a hosted service

---

## Suggested sequencing (rewritten after the 2026-09-04 audit)

The old version had six parallel tracks — which is not an answer. This one
is a straight line, gated by §0 and by the **reality gate** (gig frequency)
defined there.

**Phase 1 — survival (§0, blocks everything):**
SSD evacuation (0a) → cloud backup (0b) → OLDUSB verdict (0c). Nothing
else in this repo gets a single commit while 0a is open. 0d (redundancy
audit + coverage matrix) rides along because it's two cheap pure queries.

**Phase 2 — the moat (§B):**
B6–B9 (coverage matrix, redundancy, fleet diff, global search) — **B6–B8
✅ SHIPPED 2026-09-04** (`cratedeck/src/fleet.ts` + Fleet page +
`deckctl coverage|redundancy|diff`; needs one scan per drive with
rekordbox closed to load inventories). All pure reads over data already
collected. If you do Phase 1 + Phase 2 and stop, the project has done its
job.

**Phase 3 — the manual-pain killers:**
C18a (assisted export runbook — the right buy per the audit), C21
(differential mirror), D24 (LOWQ upgrade), J53 (full tag schema),
L62 (fingerprint ledger). Each independently shippable.

**Phase 4 — the AI edge (only if the reality gate says monthly+):**
I51 (keys — best payoff per risk) → I45 (Essentia moods) → I46 sliced:
_auto cue placement first (weekend-scale), tempo-curve grids later_
(month-scale) → K61 (`megadj drop` packages it). M66/M67 (set copilot,
double-drop detector) after B11 history exists. I50 stays a garnish.

**Phase 5 — sources & irritants (background, whenever):**
K57 SoundCloud → K58 Bandcamp → K59 1001TL mining; M69–M74 Mac-DJ fixes
are all S-effort — slot them between any two phases as palate cleansers.

**Deliberately unbuilt:** C18b/c (the pdb write gauntlet — written down,
priced, and parked), I52 (deleted), K56 (lyrics), K60 (setlist.fm), E44
(Serato export). The cap rule stands: something ships or leaves before
something new enters.

**Stop condition:** if two consecutive months produce zero gigs and zero
incidents in the log, the honest move per §0's reality gate is to finish
Phase 1, keep the nightly backup running, and freeze the rest of the doc.

**Addendum tracks (2026-09-04 research pass):**

- **§N is cheap and fleet-true:** N75–N78 (player matrix, firmware notes,
  XZ format profile, "works on which players" verdict) slot into Phase 2
  alongside §B — all small, all derived from the dual-DB gate that
  already ships. N79–N81 (genre taxonomy, energy arcs, stems-as-metadata)
  join Phase 4 after I45/I46 exist.
- **§O joins when the moat is live:** O82 (MCP server) after B6–B9,
  O83 (headless weekly agent) any time after D30/B7 exist — it's the
  cheapest reliability win in the doc. O85/O86 last (packaging and
  rails harden once the surface is stable).
- **Dedupe note:** O83 supersedes F39 (weekly digest) as the preferred
  implementation; M64/N80 feed M66. K59 discovery should adopt the
  digarr/musicdrome pattern (taste source → AI score → confident
  YTMusic resolve → approval queue) rather than raw scraping alone.
