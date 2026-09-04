# megadj — Ideas & Future Backlog

*Compiled 2026-09-04 · grounded in the actual repo state: megadj archive/ingest,
the rekordbox-usb-sync pipeline, CrateDeck v1 (built), and open items in
`(local ops log)`.
Expanded same day with an open-source ecosystem research pass (§I–§L).
Status note (2026-09-04 docs audit): A1 (drive report) shipped —
`cratedeck/src/report.ts` + `GET /drives/:id/report` + drawer Report tab +
`cratedeck/test/report.test.ts`; A2 partially landed (`tools/` consolidation
in 3604b7e); A5 (acceptance doc) done — `docs/cratedeck/acceptance.md`.*

How to read: each idea lists **why now** (the specific repo fact that motivates
it) and rough **effort** (S/M/L). Nothing here is committed scope — this is the
parking lot. Hard non-goals from the product brief stay non-goals (see §H).

---

## Research notes — open-source landscape worth knowing (2026-09-04)

Repos and projects discovered during the research pass that map directly onto
ideas below:

| Project | What it is | Why it matters here |
|---|---|---|
| [fragmede/rekordbox-pdb](https://github.com/fragmede/rekordbox-pdb) | **Read AND write** Python library for `export.pdb`/`exportExt.pdb` — dependency-free, byte-verified, validated by opening edited sticks in rekordbox | Moves legacy-pdb editing from "impossible" to "validate then adopt" (→ C18c). Rust port: `rekordbox_pdb` crate |
| [Deep-Symmetry/crate-digger](https://github.com/Deep-Symmetry/crate-digger) | Java + Kaitai spec for pdb/ANLZ; the canonical format docs | Reference for parser edge cases; djl-analysis.deepsymmetry.org docs |
| [Holzhaus/rekordcrate](https://github.com/Holzhaus/rekordcrate) | Rust parser for pdb, ANLZ, and `*SETTING.DAT` files | ANLZ cross-checks; SETTING.DAT parsing for a "player settings diff" idea |
| [Essentia models](https://essentia.upf.edu/models.html) (MTG/UPF) | Pretrained TF/ONNX models: MusiCNN auto-tagging, mood classifiers (happy/party/aggressive/sad/relaxed/acoustic/electronic), danceability, DEAM valence-arousal, MUSE embeddings | The whole AI vibe layer (§I) — ONNX weights mean no TF dependency |
| [openmirlab/all-in-one-infer](https://github.com/openmirlab/all-in-one-infer/) | `pip install all-in-one-infer` — structure analysis (intro/verse/drop/outro), beats, downbeats, tempo + demucs stems, PyPI-only | Structure-aware grids and auto cue placement (→ I46) |
| [yizhilll/MERT](https://github.com/yizhilll/MERT) + [MU-LLaMA](https://github.com/shansongliu/MU-LLaMA) | Music understanding encoder (95M/330M); MERT+LLaMA music QA/captioning | Embeddings for similarity/dedupe; LLM track captioning (→ I49, I50) |
| [mixxxdj/libkeyfinder](https://github.com/mixxxdj/libkeyfinder/) | The KeyFinder algorithm, GPL; 76% overall / **90% on dance music** vs rekordbox's own metadata at ~60% (Dubspot 2026 test) | Key detection that beats rekordbox → tag + DB injection (→ I51) |
| [scdl-org/scdl](https://github.com/scdl-org/scdl/) | SoundCloud downloader — **as of v3 it is literally a yt-dlp wrapper** | megadj already runs yt-dlp → SoundCloud sources are config work (→ K57) |
| [acoustid/chromaprint](https://github.com/acoustid/chromaprint) + [dupsonic](https://github.com/zas/dupsonic/) / soundalike | Acoustic fingerprinting; dupsonic = fast Rust single-binary incremental dupe scanner | Cross-format dedupe, LOWQ-upgrade verification, untagged-file ID (→ L62) |
| [beetbox/beets](https://github.com/beetbox/beets) v2.4 + [beetcamp](https://github.com/snejus/beetcamp) | The music-tagger ecosystem; Bandcamp autotag/acquire plugin | Borrow plugin ideas; Bandcamp source (→ J55, K58) |
| [gmunumel/track-list-extractor](https://github.com/gmunumel/track-list-extractor) · [1001-tracklists-api](https://github.com/leandertolksdorf/1001-tracklists-api) | 1001tracklists scrapers (Python) | Discovery: mine DJ sets → download queue (→ K59) |
| [Quickie Music](https://quickiemusic.com/) | SaaS: drop folder → AI clean names, BPM/key, genre split → tagged ZIP + `.m3u8` for rekordbox. $4/mo | Competitive proof the "one-shot prep" UX has value; megadj already owns every component (→ K61) |

---

## A. Finish what's already in flight (this week)

1. **Drive dossier & health report — ✅ SHIPPED 2026-09-04.**
   `cratedeck/src/report.ts` computes the dual-DB gate, grid coverage, and
   one-JSON dossier per drive; live at `GET /drives/:id/report`, folded into
   the `/drives/:id/export` dossier, rendered in the drawer's Report tab,
   covered by `cratedeck/test/report.test.ts`. Remaining sliver: a
   print-styled HTML one-pager (idea #37).
2. **Consolidate `tools/` — ✅ mostly done** (commit `3604b7e` folded the
   art/genre passes into the production pipeline; the new-music-intake skill
   now references the committed `tools/art_final.ts`, `tools/ai_genres.ts`,
   `tools/tag_audit.ts`, `tools/final_audit.py` — all verified present).
   Remaining: decide whether `tools/wav_tag_fill.ts` graduates into `ingest`
   or stays a one-off.
3. **Close the 2026-09-03 sync-log checklist.** All four pending items are
   concrete, small, and unblock everything else:
   - `usb_verify.py` hardware gate (pdb live rows == OneLibrary, both drives)
   - `usb_mirror.py --verify-only --hash-parity` post-export drift check
   - Update `~/rekordbox-exports/STATUS-FINAL.md` counts
   - **Dying SSD evacuation** — the one genuinely urgent physical item.
4. **OLDUSB verdict.** 264 OLDBACKUP-only files (10.1 GB) never made it to the
   master. One review session: adopt (via `megadj adopt` + ingest) or
   explicitly declare them dead in the sync log. Ambiguity here is the risk.
5. **CrateDeck acceptance doc — ✅ DONE 2026-09-04:**
   `docs/cratedeck/acceptance.md` now exists with code-verified evidence per
   PRD feature; remaining ☐ items are the real-hardware checks.

---

## B. CrateDeck: the fleet superpowers (v1.0 finish line)

These are the PRD features that *only exist because the app sees all drives at
once* — the moat. Roughly in value order:

6. **Coverage matrix.** Track × drive grid from existing snapshots:
   *which stick has this track?* / *which tracks exist on exactly one drive?*
   (one drive failure from gone forever). Pure query over
   `drives.last_snapshot_json` — no new scanning.
7. **Redundancy audit.** "Every track in playlist *Party* is on ≥2 drives —
   PASS" with gaps listed. Directly consumes #6. This is the feature that
   would have caught the OLDUSB situation in #4 automatically.
8. **Fleet diff.** Drive-vs-drive and drive-vs-master (via `rekordbox.xml`)
   clean added/removed/changed list. Reuses the manifest-diff logic already
   proven in `usb_mirror.py --verify-only`.
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
    grid coverage, integrity, bench trend, free space, *firmware-relevant
    notes* (e.g. PRO DJ LINK had a security advisory in 7.2.17 — worth a
    "players on old firmware" line). One click before every gig.
13. **Benchmark sparklines + anomaly alerts.** `bench.ts` already stores
    seq/rand4k history. Render the sparkline; alert when a drive's read speed
    drops >40% between runs (the brief's vNext item, and it's ~free).
14. **Port map & loan tracking.** ioreg topology at mount → user-labeled ports
    ("MBP left rear", "hub slot 2"); port history per drive; "lent to _" flag
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

18. **Automate the legacy-export dance.** The XDJ-XZ-facing `export.pdb` still
    requires the manual human loop: XML → rekordbox UI import → drag playlists
    → analysis → USB export. Ideas, in escalating ambition:
    a. *Assisted runbook* — CrateDeck drives the human: checklist UI with
       per-step done-buttons, auto-detecting each stage's completion (pdb
       row counts, playlists3*.sync mtimes) so you can't miss a step.
    b. *rekordbox scripting* — watch for a stable AppleScript/CLI surface in
       rekordbox 7.x; automate import/export trigger.
    c. **Legacy-pdb editing — upgraded from "long shot" to real candidate
       (research update 2026-09-04).** `fragmede/rekordbox-pdb` is a
       dependency-free Python read/**write** library for `export.pdb` +
       `exportExt.pdb`, byte-verified against real exports, cross-checked
       against the crate-digger Kaitai parser, and validated by opening
       edited sticks in rekordbox itself. It documents the exact write-path
       rules we'd need (row heaps, presence bitmasks, tombstones — the same
       structures `pdb_live_rows` already walks). Adoption path:
       keep drives read-only until a validation harness proves it —
       clone a real drive image → edit with the library → re-open in
       rekordbox → rekordbox re-export → `usb_verify.py` ALL PASS → then and
       only then allow "add tracks/playlist to legacy DB" as a CrateDeck
       job behind the interlock. That would delete the entire manual
       XML/export dance for new-music batches. The repo rule ("never write
       device DBs outside rekordbox") stays until this harness exists —
       update the rule *in the skill doc* the day it does.
19. **Grid quality upgrade pass.** Generated grids are constant-BPM; the
    2026-09-03 rekordbox re-analysis fixed the first 294. Add a CrateDeck
    "grid provenance" field (rekordbox-native vs synthetic) to snapshots and
    a queue view: *these N tracks still have synthetic grids* → prioritize a
    re-analysis export. On stage, a drifting track with a straight grid is
    the exact failure this repo exists to prevent. (See also I46: make the
    synthetic grids *phrase-aware* instead of constant.)
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
    + spectral features → an energy 0–10 and a rough vibe tag per track,
    written to ID3 and shown in CrateDeck. Enables "warm-up vs peak time"
    filtering that rekordbox can't do natively. Cheap because analysis
    already runs during ingest. **(Superseded/leveled-up by §I: pretrained
    models make this dramatically better than hand-rolled features.)**
28. **Genre governance.** `ai_genres.ts` (in flight) + MusicBrainz genres +
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
    inventory first: a drive could be *both* a rekordbox export and an Engine
    library — CrateDeck should describe both. Keep the Python seam rule: one
    `engine_read.py`, no TS ports.
32. **Spotify-on-CDJ era readiness.** rekordbox 7.2.16–7.2.18 added Spotify
    sign-in on CDJ/XDJ with streaming tracks visible in EXPORT mode (but not
    loadable via USB). Implication for the fleet model: track *sources* per
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
    Design the merge key *now* (drive UUID + event ULIDs) so this stays cheap
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
    tool *come to you* instead of waiting for a glance.

---

## G. Wilder swings (parking lot)

40. **Cold cloud backup of the master.** The redundancy audit (#7) will show
    the uncomfortable truth: some tracks exist on exactly one physical device.
    Backblaze B2 / R2 cold storage of `Contents/` (or at least the DBs +
    playlists + a manifest) = the one-drive-failure problem finally dies.
    Read-only restore path, zero drive writes — compatible with every rule.
41. **PRO DJ LINK listener.** CDJs on the same network broadcast status
    (beat, BPM, deck load) — a passive listener could log *actual* live
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
44. **Serato crate export.** Non-goal to *read* Serato, but a one-way
    *export* of playlists as Serato crates costs almost nothing and helps
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
    demucs stems. Pipe segment boundaries into the existing ANLZ generator:
    - **memory cues auto-placed at intro/drop/outro, downbeat-aligned** —
      the single biggest on-hardware quality-of-life jump available
    - phrase-aware synthetic grids (the current constant-BPM grid gets
      downbeat anchoring; tempo curve from the analyzer instead of a flat line)
    - "drop only" browsing structure on CDJs via cue placement convention
    This is the killer feature of the whole section. Effort M-L.

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
    ("warm late-night house groover, long intro, vocal drop") written to the
    comment tag and shown in CrateDeck. This is the "AI analyzer" dream in
    its most useful, least gimmicky form. Effort S-M.

51. **Key detection that beats rekordbox.** Dubspot's 2026 lab test:
    libKeyFinder scored 76% overall / **90% on dance music**; rekordbox's own
    metadata ~60%. Options: `keyfinder-py` bindings (stale but working),
    libkeyfinder via a tiny C++ build, OpenKeyScan (CNN-based, modern), or
    Essentia's built-in `Key` algorithm as the cheap baseline. Write
    Initial Key + Camelot to tags (§J), inject `key_id` into device DB rows,
    and add a **harmonic-mix panel** in CrateDeck: pick a track, see the
    Camelot-compatible candidates already on the same drive. Effort S-M.

52. **Personal affinity model.** Once §I embeddings + #11 play histories
    exist: train a tiny classifier on played-vs-never-played → a "will I
    play this" score per library track, refreshed monthly. Surfaces what's
    worth exporting and what's dead weight in the archive. Park until #11
    has harvested a few real sets.

---

## J. Full-depth tagging (ID3 and beyond)

The tagging side of the request: make every file *fully* tagged — not just
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

54. **Artwork standardization.** Consolidate `art_final.ts` into ingest:
    target 1400×1400 (or 600×600) JPEG, type-3 front-cover frame, consistent
    quality; keep the AI-artwork fallback path. Feeds both ID3 `APIC` and
    the ANLZ `PWAV`-adjacent artwork pipeline rekordbox reads. Effort S.

55. **Borrow the beets ecosystem, don't adopt it.** beets v2.4's plugin ideas
    map 1:1 to backlog items: `badfiles` (→ #30 integrity), `duplicates`
    (→ #25/L62), `fetch`/`lastgenre` (→ #26/#28), `edit` (batch tag fixes as
    a CLI flow). Keep megadj single-CLI (workspace rule) — steal ideas, not
    the dependency. If a wall is hit, beets can be run *on* the archive as an
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
      confirm same recording, *then* delete the old — no more trust-in-URL
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

## H. Explicit non-goals (unchanged — say no)

- ❌ Writing device DBs outside rekordbox (`export.pdb`/`exportLibrary.db`
  injection stays in the proven pipeline only) — *note: C18c defines the
  validation harness that would someday amend this rule, deliberately*
- ❌ Editing tags/cues/grids *on drives*; rekordbox owns creation
  (analysis-derived tags live in the *files* and our own DB/ANLZ pipeline)
- ❌ Cloud sync, accounts, multi-user, telemetry (§I models run locally)
- ❌ Audio playback/scrubbing in CrateDeck
- ❌ Mobile app (a localhost PWA-ish responsive pass is fine; native is not)
- ❌ Becoming a general DJ library manager — describe & verify, don't create
- ❌ Aggressive scraping of flaky sources: personal-use rate-limited only,
  cache-first, never a hosted service

---

## Suggested sequencing (opinionated)

1. **Now:** A1–A5 (ship in-flight work, close the sync-log checklist, SSD
   evacuation) — everything else is noise while a drive is dying.
2. **Next:** B6–B9 (coverage matrix, redundancy audit, fleet diff, global
   search) — the fleet moat, all pure reads over data already collected.
3. **Then:** C18a (assisted legacy-export runbook) + C21 (diff mirror) +
   D24 (LOWQ upgrade) — kills the three biggest recurring manual pains.
4. **AI track (parallel, high payoff):** I51 (keys) → J53 (full tags) →
   I45 (Essentia moods) → I46 (structure-aware grids/cues) → I50 (vibe
   notes). Each is independently shippable; together they're the "AI DJ
   librarian" identity. K61 (`megadj drop`) packages the result.
5. **Sources:** K57 (SoundCloud) → K58 (Bandcamp) → K59 (1001TL mining).
6. **Ongoing background:** B17 (auto-scan on mount), B13 (alerts), D30
   (archive integrity cron), L62 (fingerprint ledger) — set-and-forget
   reliability.
7. **When it earns it:** E31 (Engine read), F35 (gig mode), G40 (cold
   backup), C18c (pdb write harness — only with the validation gauntlet).
