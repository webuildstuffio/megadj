# megadj — Ideas & Future Backlog

**Status:** 🧭 ACTIVE — ordered backlog; GitHub issues are the execution tracker.

_Compiled 2026-09-04, revised through 2026-09-11 · grounded in the actual
repo state (archive/ingest, rekordbox-usb-sync pipeline, CrateDeck v1,
FullTags v0) plus the local operations log kept outside the repo.
`docs/PRINCIPLES.md` is the arbiter: ideas that violate a principle get
struck (E31, E44), ideas that implement one get tagged (§I → P7/P8/P9,
§O → P1)._

How to read: each idea lists **why now** (the specific repo fact that motivates
it) and rough **effort** (S/M/L). Nothing here is committed scope — this is the
parking lot. Hard non-goals from the product brief stay non-goals (see §H).
**The live build order — what to build next — lives in
[product-state-2026-09-07.md](product-state-2026-09-07.md) §The queue**
(the Sep 6 three-move proposal that ordered it was executed and archived at
[archive/roadmap-proposal.md](archive/roadmap-proposal.md)).

**The deal (2026-09-04 audit):** this backlog is capped. A new idea goes in
only when an old one comes out or ships — a 60+-item list is how planning
replaces building. §0 comes before everything and blocks everything else.

---

## §0 — Do now, before anything else

The software deliverables are complete. Two physical outcomes still outrank
the rest of the backlog: evacuate Extra, then establish the first cold backup.
Issue state lives on GitHub; this table only routes to the durable owner.

| ID  | State               | Durable owner / outcome                                                                        |
| --- | ------------------- | ---------------------------------------------------------------------------------------------- |
| 0a  | 🟡 hardware-blocked | [Evacuate Extra runbook](runbooks/0a-evacuate-extra.md); resumable copy plus full verification |
| 0b  | 🟡 decision-blocked | [Cold-backup runbook](runbooks/0b-cold-backup.md); configure the remote, run, and verify       |
| 0c  | ✅ complete         | [BACKUP2 verdict](runbooks/0c-orphan-verdict.md); adopted, covered, and retired intact         |
| 0d  | ✅ shipped          | Coverage and redundancy engines; live state from `deckctl coverage`/`redundancy`               |
| 0e  | ✅ shipped          | Incident logging convention; evidence remains in the local, gitignored `docs/usb-sync-log.md`  |
| 0f  | ✅ superseded       | Generalized by the human-gated [shelf hygiene engine](getdat/shelf-hygiene-2026-09-09.md)             |
| 0g  | ✅ shipped          | Whole-shelf fingerprint scan and quarantine-first restore path                                 |

### Deferred runtime performance pass

**Blocked until a USB drive is mounted.** Rounds 1–2 (landed) took the dev
gate 36s → 7.4s; this targets the runtime paths (scans, sweeps, CLI),
which need a real volume to measure honestly (warm numbers lie by ~50× —
the internal-SSD archive fits the page cache). Harness:
`tools/prof-sweep.ts` (read-only profiler; run cold on a fresh mount,
then warm, compare serial vs pooled). Targets in order: walk.ts parallel
stats (3–8×), archive_sweep fixed-width hashing pool (3–6×, the long
pole of `deckctl prep`), optional bench.ts random-read batching (changes
what the benchmark measures — needs a product call).
   Non-targets (checked, already fast): CLI cold start 50–70ms,
   `fetchWeeklyPrepInput` (already fanned out), preflight/report/fleet
   (sub-ms, in-memory), rb_read.py (~1s = dual-DB read itself).
   Verification protocol: prof cold → apply target → re-run + its pinned
   tests → `bun run check:full` → e2e `deckctl run <drive> scan` +
   `deckctl prep` digest still includes D30.

**Reality gate — the input that decides the rest of this doc:** how often
do you play?

- **~Monthly or more:** preflight (B12), redundancy (B7), grid/cue work
  (I46) and keys (I51) are load-bearing infrastructure; the AI layer is a
  real edge. Build §B and §I as written.
- **A few times a year:** half of §B and all of §F35 would sit idle. The
  honest roadmap is: 0a–0c, full tags (J53), fingerprints
  (L62 — ✅ now shipped), done — then revisit after the next gig.

---

## Research notes — open-source landscape worth knowing (2026-09-04)

One line per project; the per-section entries below carry the mapping:

- **rekordbox-pdb** (read+write pdb, byte-verified) → C18c · **crate-digger** (Java/Kaiti pdb+ANLZ spec) + **rekordcrate** (Rust) → parser references
- **Essentia models** (MusiCNN, mood, DEAM, MUSE) → the §I vibe layer, ONNX, no TF dependency · **all-in-one-infer** → structure/stems (→ I46)
- **MERT / MuQ-MuLan** → embeddings (see Best-models re-check) · **libkeyfinder** (90% on dance) → I51
- **scdl v3 = yt-dlp wrapper** → K57 is config work · **beets + beetcamp** → plugin ideas, Bandcamp (→ J55, K58)
- **chromaprint + dupsonic + soundalike** → L62 dedupe/identity · **1001-tracklists scrapers** → K59
- **AlphaTheta format notice + CDJ-3000 v3.30 incident** → the dual-DB gate and preflight firmware notes (→ N75/B12)
- **2026 stems comparisons** → offline demucs beats rekordbox's real-time stems (→ I46/I48)
- **digarr / musicdrome / re-command** → discovery-loop prior art ("a wrong file is worse than a missing one") (→ N82)
- **harmonie** → Essentia + 400 Discogs-style probabilities in SQLite (→ I45/I49 prior art)
- **Claude Code agentic primitives** → skills/hooks/MCP/headless (→ O82–O88)
- **settag / dupsonic / livechord-beat-refiner** (2026 finds) → closest FullTags competitor, L62 done for us, grid-QA candidate

**Best-models re-check (2026-09-05 verdicts only, full ladder
lives in `docs/fulltags/fulltags-roadmap.md`):**

- **BeatFM (ICME 2025)** — +4.1pt downbeat F1 over beat_this on paper,
  **no public code or weights** (re-verified — the only GitHub "BeatFM"
  is an unrelated 2022 JS radio player) → beat_this stays the pick;
  revisit if weights ship. The paper-SOTA ≠ usable-SOTA trap P5 warns of.
- **MusicFM** — dormant since the Feb 2024 checkpoint fix; still the
  license-clean fallback, but the 2026 strength pick is **MuQ-MuLan**
  (Tencent, MIT code, CC-BY-NC weights): SOTA zero-shot music tagging
  (MagnaTagATune AUC 79.3 vs CLAP 73.9–75.5), beats MERT on MARBLE.
  Personal-use OK per P9.
- **OpenKeyScan correction (rev 3):** the open-source repo
  (`rekordcloud/openkeyscan-analyzer`, MIT) speaks JSON over stdin/stdout
  with CUDA>MPS>CPU auto-select; the localhost `:58721` REST API belongs
  to the **closed desktop app**. Site accuracy claims are marketing
  figures — the ≥80% local gate stands.
- **License ledger (P9):** Essentia models CC BY-NC-SA · libKeyFinder
  GPL · beat_this MIT · chromaprint LGPL · MERT/MuQ CC-BY-NC ·
  MuQ-MuLan MIT code + CC-BY-NC weights · OpenKeyScan MIT · dupsonic
  MIT · all-in-one-infer MIT. All offline/local; track per-model
  licenses in the model-cache manifest (roadmap risk #1).

---

## A. Finish what's already in flight — ✅ ALL RESOLVED (superseded)

Everything here shipped or was promoted by 2026-09-04: the drive dossier +
health report (→ §B1), the `tools/` consolidation (→ `tools/fetch-all.ts` +
`fulltags/`), WAV artwork in rekordbox
([fulltags/rekordbox-wav-artwork.md](fulltags/rekordbox-wav-artwork.md)),
the sync-log checklist gates, the orphan-drive verdict (→ §0c), and the
acceptance doc ([cratedeck/acceptance.md](cratedeck/acceptance.md)). The
live "what's next" list is [product-state-2026-09-07.md](product-state-2026-09-07.md).

---

## B. CrateDeck: the fleet superpowers (v1.0 finish line)

The PRD features that _only exist because the app sees all drives at once_
— the moat. Roughly in value order:

6. **Coverage matrix — ✅ SHIPPED 2026-09-04.** `cratedeck/src/coverage.ts`
   (`coverage()` + `trackLocations()`) over per-track fleet tables
   (`fleet_tracks`/`fleet_playlist_entries`/`fleet_manifest`, refreshed by
   every scan). UI: Fleet page → Coverage tab; CLI `deckctl coverage`;
   API `GET /api/fleet/coverage` + `/api/fleet/track?q=`. Tests:
   `cratedeck/test/fleet.test.ts`.
7. **Redundancy audit — ✅ SHIPPED 2026-09-04.** `fleet.ts redundancy()`:
   per-playlist fail (track on one drive) / warn (below floor) / pass,
   with expandable gap lists. CLI `deckctl redundancy`;
   API `GET /api/fleet/redundancy?min_copies=`.
8. **Fleet diff — ✅ SHIPPED 2026-09-04.** `fleet.ts diff()`: added /
   removed / changed between any two drives (DB tracks + scan manifests +
   `artist - title` meta-join for moved tracks). CLI `deckctl diff A B`;
   API `GET /api/fleet/diff?a=&b=`.
9. **Global search across ghosts — ✅ SHIPPED 2026-09-05.** ⌘K in the
   CrateDeck topbar → `/api/search` over every snapshot ("do I own this
   anywhere, and on which stick?"). The remaining gap is result depth
   (currently snapshot tracks; archive-side join is the natural extension).
10. **Snapshot timeline & "what changed".** Versioned diffs between any two
    scans: "what changed on an old backup drive between the last gig and now?"
11. **Set intelligence.** Harvest player-written history (`HIST` entries on the
    drives) across the fleet → most-played, never-played, set reconstruction
    with timestamps → export as CSV/markdown/Spotify-searchable track list.
12. **Preflight check — ✅ core SHIPPED 2026-09-05 (`deckctl preflight`,
    `cratedeck/src/preflight.ts` + `/api/preflight`).** Single pass/fail
    checklist across all mounted drives: dual-DB currency, grid coverage,
    last-verify age, bench trend + CDJ floor, bitrot ledger, free space,
    mirror parity. Unknowns never fake ready; exit 1 gates cron/agents.
    Includes the N75 player-compat check and N76 firmware advisories
    (informational, never gates). Remaining optional: a UI card.
13. **Benchmark sparklines + anomaly alerts — ✅ SHIPPED (preflight rule +
    HealthTab chart).** The >40% drop-between-runs anomaly rule is live
    in preflight's `benchCheck` and rendered in the drive Health tab.
    Remaining garnish: a literal sparkline on the drive card.
14. **Port map & loan tracking.** ioreg topology at mount → user-labeled ports
    ("MBP left rear", "hub slot 2"); port history per drive; "lent to \_" flag
    with a due-back note. Start with just the mount-event history, which
    `registry.ts` already logs.
15. **QR / Dymo labels.** Print a small QR per drive linking to its local
    dossier page — physical-world glue for ~zero code.
16. **Menu-bar companion.** A tiny SwiftUI/`swiftbar`-style menu item with
    interlock state, mount events, "N drives, 1 needs attention". Cheaper
    first step: `bun run deck` notification hooks (osascript) on
    mount/interlock.
17. **Watch-folder auto-scan + auto-verify schedule — ✅ SHIPPED 2026-09-05.**
    `cratedeck/src/auto_schedule.ts`: on-mount → light scan automatically,
    full verify weekly (commit `aa64e04`), results feed the readiness badge.
    Removes the last reason to open the page manually.

---

## C. Sync pipeline: kill the remaining manual pain

18. **Automate the legacy-export dance.** The XDJ-XZ-facing `export.pdb`
    still requires the manual loop: XML → rekordbox UI import → drag
    playlists → analysis → USB export. Options, escalating:
    a. _Assisted runbook_ — CrateDeck drives the human: checklist UI with
    per-step done-buttons, auto-detecting stage completion (pdb row
    counts, `playlists3*.sync` mtimes). **The right buy:** most of
    automation's value, none of the risk.
    b. _rekordbox scripting_ — watch for a stable AppleScript/CLI surface
    in rekordbox 7.x; automate the import/export trigger.
    c. **Legacy-pdb editing — written down, UNBUILT.**
    `fragmede/rekordbox-pdb` makes it possible; the gauntlet keeps it
    safe: clone a real drive image → edit → re-open in rekordbox →
    re-export → `usb_verify.py` ALL PASS, before any rule change.
    Honest pricing: upside = deleting a few-times-a-month dance;
    downside = a corrupted library discovered at a venue. The asymmetry
    is terrible at current frequency.
19. **Grid quality upgrade pass — 🔶 tooling SHIPPED (grid-audit wave 2,
    2026-09-10); verdicts remain.** The audit half is real: `rb-grid-triage`
    (read-only grid buckets vs the ANLZ rekordbox wrote), the
    `gold-report`/`regate` gold-set harness (awaiting annotations; it
    refuses to manufacture a pass), the ANLZ write-path spike, and the
    Sep 11 census that repaired 21 bar-coherence grids. The SSOT for the
    remainder (grid provenance field, batch repair verdicts, Part-B
    cues) is [fulltags/grid-audit-plan.md](fulltags/grid-audit-plan.md).
20. **Full-length waveform fill.** Synthetic PWAV/PWV2 cover the first 30s;
    generate full-duration previews from the decoded audio (librosa is
    already a dependency). Medium effort, big browse win on hardware.
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
    migration of its contents to another drive. Pairs with #4/#19 and the
    dying-SSD lesson.

---

## D. megadj archive & ingest

24. **LOWQ re-fetch queue — ✅ SHIPPED 2026-09-08.** `megadj upgrade`
    re-resolves below-floor video IDs at today's best format and swaps
    ONLY when both gates pass: fingerprint identical to the incumbent
    and ffprobe bitrate ≥ the current row. The LOWQ queue surfaces
    (CrateDeck `archive_lowq_queue` + prep digest) are now actionable.
25. **Duplicate hunter across the whole estate — ✅ SHIPPED (Sep 2026,
    two commands).** `megadj dedupe-archive [--apply --yes]` over the
    DJ-Imports archive, `megadj shelf-dupescan --quarantine` over the
    shelf — fingerprint classes, not name classes.
26. **MusicBrainz deepening.** `ingest` fills albums/dates; next: label +
    catalog number + relation credits (producer/remixer) → better composer
    tags, and MBID provenance surfaced in CrateDeck track tooltips.
27. **Energy / mood fields.** ~~Hand-rolled librosa RMS features →
    energy 0–10 + vibe tag.~~ **Superseded by §I:** pretrained models
    (danceability, valence-arousal) are dramatically better — see I45 and
    the FullTags roadmap's energy-2.0 step.
28. **Genre governance.** FullTags' genre stage (SC tags + canonical map +
    OpenRouter classifier at conf ≥ 0.7) + MusicBrainz genres + your own
    conventions → one canonical genre vocabulary file, with an audit
    report of strays. Prevents the folder tree from forking into
    `Hip-Hop` vs `HipHop` vs `Rap`. MusiCNN genre models (§I45) vote too.
29. **Archive → playlist automation.** "Everything ingested since last gig"
    as an auto-generated rekordbox playlist on the next sync — closes the
    loop from download to playable-without-touching-rekordbox.
30. **Archive integrity cron.** Nightly checksum sweep of `~/Music/DJ-Imports`
    vs the archive DB (sizes + blake2b), reporting bitrot/silent truncation
    before it ever reaches a drive. Reuses the drive-side hash module.

---

## E. Format & platform expansion (careful)

31. ~~**Engine DJ read support.**~~ **STRUCK (2026-09-05 principles
    alignment).** P2 is absolute — "Mac only. Pioneer only. Sorry —
    nothing else, ever, at all." A read-only Engine inventory was
    technically cheap but wrong product (the original argument — Engine
    DBs are unencrypted SQLite, venue gear runs Engine — was sound
    engineering). Slot intentionally empty; the next new idea takes 31.
32. **Spotify-on-CDJ era readiness.** rekordbox 7.2.16–7.2.18 added Spotify
    sign-in on CDJ/XDJ with streaming tracks visible in EXPORT mode (but not
    loadable via USB). Implication: track _sources_ per track (local file
    vs streaming-linked) in snapshots, so preflight can warn "this playlist
    is 40% Spotify-linked — it won't play from a USB at the venue."
33. **Request Catalog / CoBeat awareness.** rekordbox 7.2.16 added Request
    Catalog + CoBeat support. Not core; if you play venues using it, a
    "requests received while gigging" capture could feed set intelligence
    (#11). Park until actually used.
34. **Multi-machine catalog merge.** If the dashboard ever runs on a second
    Mac, SQLite + snapshot JSONs merge by drive UUID with last-writer-wins
    per field and an event-log union. Design the merge key _now_ (drive
    UUID + event ULIDs) so this stays cheap later.

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
    folded into a borrowed stick's bag: the "5-second answer for a
    borrowed stick."
38. **Voice/shortcuts integration.** "Hey Deck, is the mirror ready?" — a
    one-route JSON API (`GET /verdict/:drive`) + a Shortcuts app action.
    Almost free given the report module exists.
39. **Weekly digest.** Monday-morning markdown/email digest: drives needing
    attention, new music not yet exported, sync state, any bitrot. Makes the
    tool _come to you_ instead of waiting for a glance.

---

## G. Wilder swings (parking lot)

40. **Cold cloud backup of the master — ✅ PROMOTED to §0b (2026-09-04
    audit).** Kept in §G solely so numbering stays stable; the content
    lives at §0b.
41. **PRO DJ LINK listener.** CDJs on the same network broadcast status
    (beat, BPM, deck load) — a passive listener could log _actual_ live
    playback into the timeline, making set intelligence (#11) automatic.
    Needs venue-network cooperation; park.
42. **Counterfeit-capacity test as a first-class job.** Write-verify a
    bounded random pattern across claimed capacity (manual, warned).
    Catches fake sticks before they eat a library.
43. **Rekordbox master library introspection (read-only).** Beyond
    `rekordbox.xml`: the Mac `master.db` (19 MB, decrypted via
    pyrekordbox) would give live collection state for diffing without
    re-exporting XML. Risk: schema drift — keep it strictly read-only,
    behind the same seam discipline.
44. ~~**Serato crate export.**~~ **STRUCK (2026-09-05 principles
    alignment).** P2's rule is absolute — no Serato, not even as a one-way
    export target. Guest DJs get files and an `.m3u8` (M74 covers it), not
    Serato crates. Slot intentionally empty; the next new idea takes 44.

---

## I. AI & audio analysis (the vibe layer)

The big unlock: **pretrained models have made "AI analyzer" a pip-install
away**, and megadj's pipeline is the perfect consumer — it already decodes
audio, writes tags, and injects DB rows. All models run offline/local
(P8: AI does the labour; P9: zero commercial intent is what makes the
NC-licensed model zoo usable; P7: picked for electronic music first).
Everything feeds three sinks: **ID3/TXXX tags** (§J), **the archive DB**,
and **the rekordbox/ANLZ injection path**. Model picks + licenses are
re-verified in the research notes (2026-09-05).

45. **Essentia mood & vibe suite — ✅ SHIPPED 2026-09-05 (rev 6.1/6.2).**
    `fulltags --mood` → `TXXX:MOOD` (dance/aggressive/happy/electronic/
    party + DEAM valence-arousal) via ONNX towers; energy 2.0 blend;
    `megadj mood` mirrors stamps into the archive DB `mood` ledger.
    CrateDeck surface: `archive_mood_profile` MCP + `/api/archive/mood`.
    Genre head gate FAILED (saturated) — genre writes blocked; the
    original classifier spec lived here and is superseded by what shipped.

46. **Structure-aware grids & cues — 🔶 v0 SHIPPED (pass 3, rev 6.2);
    wave-2 tooling SHIPPED 2026-09-10.** `megadj cues` derives 8-bar
    phrase markers from the beats ledger's downbeats (idempotent,
    DB-side) — the rekordbox memory-cue WRITE is the deliberate next
    gate. Wave-2 tooling is live (see C19); the SSOT for the remainder
    is [fulltags/grid-audit-plan.md](fulltags/grid-audit-plan.md). The
    full all-in-one-infer slice (segment labels + demucs stems piped
    into the ANLZ generator: auto memory cues at intro/drop/outro,
    phrase-aware tempo-curve grids, drop-only browsing) remains the
    follow-on — _BeatFM beats beat_this on paper but has no public
    weights; beat_this stays the practical pick._ **Honest label: the
    genuine 10x item and the likeliest to eat a month** — cue placement
    alone is a weekend; the tempo-curve grid is the month-long part.
    Effort M-L.

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

49. **Embeddings & "sounds like" — ✅ SHIPPED 2026-09-08 (effnet tower).**
    Whole-archive effnet embeddings ledger → `megadj similar`,
    `archive_similar_tracks`, and the FullTags ⌗ Similar tab — blob +
    cosine at archive scale. (MuQ-MuLan step-up remains a future upgrade
    of the vector source.) Open garnish: backfill the newest intake
    (`megadj mood --embeddings`) so similarity sees the whole library.

50. **LLM track captioning (vibe notes).** Feed Essentia tags + structure
    labels + metadata to a local/small LLM → a one-line vibe description
    per track, written to the comment tag. **Honest bet, from the audit:
    you'd read these twice and never filter by them** — keep only as a
    `megadj drop` garnish, never infrastructure. Effort S.

51. **Key detection that beats rekordbox — ✅ SHIPPED 2026-09-05
    (gate PASSED 80.7%, all 88 written).** OpenKeyScan analyzer vs RB
    master.db ScaleName: 71/88 exact, 8 near, 9 mismatch. Keys + Camelot
    are in the files; the RB gauntlet (disable Key analysis → Reload Tags
    at next drive mount) is the remaining operational step. Harmonic-mix
    panel still open.

52. ~~**Personal affinity model.**~~ **DELETED (2026-09-04 audit).** A
    trained "will I play this" classifier was fantasy until B11 harvests
    real set histories; if that day comes, its bounded sibling lives at
    M64 (hit predictor). Slot intentionally empty.

---

## J. Full-depth tagging (ID3 and beyond)

Make every file _fully_ tagged — the complete DJ-useful frame set,
idempotently, in one pass. One mutagen pass (Python side), one schema,
everything else reads it.

> **2026-09-04 update: this section is now the FullTags sub-project**
> (`fulltags/` — standalone CLI + engine, megadj's modules are shims over
> it). J53's schema is live (`fulltags/src/schema.ts`), the writer/readers
> are consolidated, and the follow-on roadmap is
> `docs/fulltags/fulltags-roadmap.md` — **rev 6.2 (executed through pass 3)**:
> fingerprints + keys shipped to files (gates measured: key 80.7% PASS),
> BPM/mood/genre writes gate-blocked → beats/mood/cues DB ledgers
> (`megadj beats|mood|cues`), energy 2.0, MB harvest, audit gate now
> requires mood + energy.

53. **The full frame schema.** Define once in the skill docs, apply in
    `ingest` + `upgrade`: `TBPM`, `TKEY` (from I51), `TCOM`/`TIPL`
    composer + producer/remixer credits (MusicBrainz relations), `TPUB`
    label (Beatport fills this now — rev 6.4), `TMED` source, and the
    `TXXX` set (`MBID`, `ACOUSTID`, `ENERGY`, `VALENCE`, `AROUSAL`,
    `DANCEABILITY`, `VOCAL_DENSITY`, `SOURCE_URL`, `VIBE`, `CAMELOT`).
    Label + remixer + ISRC have landed (Beatport identity fields,
    rev 6.4/6.5); the remaining gap is composer/producer and `TMED`.

54. **Artwork standardization.** Extend FullTags' art stage
    (`fulltags/src/art-sources.ts` — the ladder's single home): target
    1400×1400 (or 600×600) JPEG, type-3 front-cover frame, consistent
    quality; AI-artwork fallback stays queued as last resort. Feeds ID3
    `APIC` and the ANLZ artwork pipeline rekordbox reads. Effort S.

55. **Borrow the beets ecosystem, don't adopt it.** beets v2.4's plugin
    ideas map 1:1 to backlog items: `badfiles` (→ #30), `duplicates`
    (→ #25/L62), `fetch`/`lastgenre` (→ #26/#28), `edit` (batch tag
    fixes). Steal ideas, not the dependency; if a wall is hit, beets can
    run _on_ the archive as an escape hatch.

56. **Synced lyrics (low priority).** LRCLIB open lyrics API → USLT/SYLT
    frames. Hardware players won't show them; value is archive search and
    future crate tools. Only if bored.

---

## K. Scrapers, sources & discovery

megadj's soul is acquisition-with-taste. The multi-source road is shorter
than expected: **yt-dlp already covers most of it** (scdl v3 is
a yt-dlp wrapper now; multidl proves the rest with per-platform JSON
extractors).

57. **SoundCloud as a first-class source.** Since megadj drives yt-dlp
    directly, SoundCloud support is mostly config + normalization:
    favorites sync mirroring the liked-songs design (`source=sc`), Go+ 320
    kbps via OAuth header, reposts/playlists/artist pages as syncable
    sources. **2026-09-05 status (verified):** yt-dlp SC works (DataDome
    403s fixed by browser-impersonation); DRM-wrapped go+ tracks return
    404 and never will work (expect ladder misses on premium-only
    releases). Keep yt-dlp on latest/nightly + `curl_cffi`. Effort S-M.
    The single biggest library-expansion lever.

58. **Bandcamp + long-tail platforms.** beetcamp proves Bandcamp's
    `data-tralbum` JSON is scrapeable; multidl documents the long-tail
    extractors (audiomack, hearthis.at, archive.org, Jamendo). Add
    `megadj sync --source <platform>` one at a time, gated by the same
    probe/quality pipeline; Bandcamp first. **2026-09-05 status:**
    Bandcamp extraction in yt-dlp is **broken** (bot protection, issue
    #17506) — sequence after the upstream fix. Effort S per platform.

59. **1001tracklists mining → discovery queue.** Scrape tracklists of DJs
    and shows you follow: "played everywhere, not in your library" queue
    ranked by 90-day set appearances, one keypress to enqueue via
    K57/K58/YTM. Turns megadj from an archiver into a discovery engine.
    Effort M (rate-limit, cache, personal use only).

60. **setlist.fm mining (low priority).** Free API key, clean Python client
    (`setlist-fm-client`). Only useful for non-DJ gig mining; park.

61. **Quickie-style one-shot mode (`megadj drop`) — ✅ SHIPPED 2026-09-07.**
    The $4/mo SaaS pitch, local and free: `megadj drop <folder-or-url>` →
    download → ingest (clean/tag/art/dedupe/WAV→AIFF) → beats → mood →
    phrase cues → organize, one `--json` summary with per-stage
    ok/skipped/failed accounting; stage failure is contained.

---

## L. Fingerprints, dedupe & identity

62. **Acoustic fingerprint ledger — ✅ SHIPPED 2026-09-05; consumers
    shipped through Sep 11.** `fulltags --fingerprint` → `TXXX:ACOUSTID`;
    consumers: cross-format dupe detection (`shelf-dupescan`,
    `dedupe-archive`, `shelf-hygiene` acoustic twins) and the
    `megadj upgrade` swap gate. Still open: untagged-file identification
    via the free AcoustID API, drive-side sampled audit. **Stamp
    catch-up owed** on the newest intake batches (coverage in the
    product-state ledger table).

63. **Fingerprint the mirror.** Once #62 exists, a `--fingerprint-sample N`
    flag on `usb_mirror.py --verify-only` content-checks N random files per
    drive per run instead of trusting size+mtime alone — closing the last
    "identical bytes ≠ identical audio" gap. Effort S.

---

## M. Cool AI things & annoying-Mac-DJ problems (2026-09-04 addendum)

The fun-but-dangerous ideas get a dedicated home, plus the everyday
Mac-DJ irritations nobody builds for.

### AI ideas (the cool list)

64. **Listening-based hit predictor.** Essentia DEAM + danceability +
    embedding (I45) → a "will the floor like this" score calibrated on
    which of your tracks got played (needs B11 history harvest).
    Bounded sibling of the deleted I52: one number, a regression you can
    sanity-check. Parked until history exists.
65. **Auto DJ-friendly renamer.** YTM filenames are garbage
    (`(Official Audio)`, ft. soup, emoji, `&` vs `and`). An LLM pass at
    ingest normalizes to a strict `Artist - Title (Remixer)` convention,
    verified against MusicBrainz, diff view before apply, FAT32-safe
    length checks built in. Effort S.
66. **MegaSet copilot — ✅ SHIPPED (core Sep 8; CLI spoke Sep 11); graduated
    to its own doc set.** One engine + parse/clamp seam across all four
    surfaces (CLI `megadj setbuild`, HTTP route, MCP `archive_set_build`,
    FullTags ⌗ Similar panel). Proposes only — never writes; the write-off
    is the gated `megadj rb-playlist`. Plan of record:
    [megaset/01-prd.md](megaset/01-prd.md); measured verdicts:
    [megaset/10-findings.md](megaset/10-findings.md).
67. **"Find the double-drop" detector.** Scan the library for pairs of
    tracks whose grids + keys align so well they can be layered (acapella
    over instrumental) — mashup hunting by embeddings + grid math instead
    of memory. Pure analysis over data §I already computes. Effort M.
68. **Voice memo → crate.** After a gig, AirDrop the phone voice memos
    ("that ID at 1am was...") → Whisper transcribes → LLM resolves
    fuzzy titles → cross-checked against 1001TL mining (K59) and
    SoundCloud search → candidate queue in the archive DB. Closes the
    "what was that track" loop with zero typing. Effort M.

### Annoying things for DJs on Mac (the irritation list)

69. **The format-eject dance.** macOS wants APFS, CDJs want FAT32 + MBR,
    and Disk Utility hides the "Master Boot Record" dropdown three
    dialogs deep. `megadj format <volume>`: one command with the right
    answers per target player, refuses volumes with a rekordbox tree,
    prints the `diskutil` invocation for review. Effort S.
70. **macOS metadata litter audit.** `._*`, `.DS_Store`,
    `.Spotlight-V100`, `.Trash` on FAT32 sticks — CDJs choke or
    slow-walk on these, and Finder recreates them every mount. Extend
    the scan junk detection with a **one-click clean** (guard.ts-gated,
    allow-listed only) + a `defaults write` hint so Finder stops
    polluting. Effort S.
71. **"Why is my transfer 8 MB/s?" — port-speed truth serum.** macOS
    never tells you a stick landed in USB 2 or a hub is capping the bus.
    The USB topology is already captured at mount (F2) — surface
    negotiated speed as a card badge + a "4× faster in the other port"
    note. Presentation of collected data. Effort S.
72. **Sleep/wake drive-mace.** macOS spins down USB drives; the first
    CDJ-track-onload after idle stalls. An optional launchd helper keeps
    gig drives awake while mounted (`caffeinate -i` scoped to the
    volume, auto-clears on eject). Caveat: wears flash slightly, gig day
    only. Effort S.
73. **Finder-bait guard.** Dragging `PIONEER/` instead of `Contents/` to
    Finder is a classic library-mangling move. CrateDeck detects a
    `PIONEER/` tree at unexpected depth and screams — catching the
    mistake _before_ the sync run does, when it's still fixable. Effort S.
74. **Bulk-playlist → folder audio exporter.** iOS/venue-CDR/guest-DJ
    reality: export any playlist (drive DB or archive) → sorted,
    renamed, tagged folder + optional `.m3u8`. Reuses ingest machinery
    in reverse. Effort S.

---

## N. XDJ-XZ / Pioneer ecosystem / house & techno (2026-09-04 research addendum)

Grounded in the official AlphaTheta compatibility notice + the 2026 stems
comparisons. The repo's XDJ-XZ is the reason the dual-DB gate exists; the
ecosystem research confirms the architecture aims at the right wall.

75. **Hardware compatibility matrix as data (Device vs OneLibrary) — ✅
    SHIPPED 2026-09-05 (`cratedeck/src/players.ts`, `deckctl players`,
    `deck_players` MCP tool).** Pioneer's official two-format split
    encoded as data; verdicts come from the drive's MEASURED dual-DB rows
    and fold into preflight as a check (a fully blocked drive is
    not-ready).

76. **Preflight firmware-notes field.** The CDJ-3000 v3.30 incident
    (firmware pulled after DJs' playlists vanished) is the newest
    recurring failure class. Preflight gains a manual per-player
    firmware field + the UI rule of thumb: _drive shows on the player
    but playlists are empty → check which library format that firmware
    prioritizes._ Effort S.

77. **XDJ-XZ-specific export profile.** The XZ reads Device Library only,
    supports FAT32/exFAT/HFS+ (not NTFS, not GUID partition map, not
    case-sensitive HFS+), and firmware updates require FAT/FAT32 + MBR.
    Encode it: `megadj format --profile xdj-xz` (M69) defaults to the
    right scheme; CrateDeck flags incompatible formats. Effort S.

78. **"Which players will this stick work on?" — the fleet answer — ✅
    SHIPPED 2026-09-05** (`deckctl players [drive]`,
    `/api/drives/:id/players`). N75's matrix + the measured dual-DB state
    → a per-drive verdict. The thing rekordbox cannot tell you at all.

79. **Genre-normalized house/techno taxonomy.** The 400-Discogs-styles
    model (harmonie) + Essentia genre classifiers give every track a
    machine-vote (`tech-house`, `deep-house`, `peak-time techno`) to
    arbitrate against the LLM genre (shipped) and MusicBrainz. Output:
    one normalized genre + a styles[] array in the archive DB, feeding
    "more like this" (M66) and the 1001TL discovery ranking (K59).
    Effort M.

80. **Energy-arc presets per genre.** House/techno sets live on energy
    curves, not just BPM. With I45's valence-arousal + danceability per
    track, define presets ("warm-up", "peak", "afterhours") as
    valence/energy envelopes for the crate copilot (M66) to assemble
    against — the "play a warm-up set" button, grounded in measured
    features. Effort M.

81. **Stems-as-metadata (offline, exceeding rekordbox's own).** 2026 blind
    tests rate rekordbox 7's real-time stems ~3★ while offline demucs/
    AudioShake-class models lead. megadj's pipeline is offline by design:
    render stems at ingest (I46 demucs pass), store vocal-density +
    instrumental-ness (I48); pre-rendered stem files for players stay
    explicitly parked (non-goal). Near-term win is analytical:
    instrumental/acapella/drum ratings per track. Effort M.

---

## O. Agentic megadj (Codex / Claude Code as first-class operators)

The 2026 agent-CLI taxonomy (skills, hooks, subagents, MCP, headless
one-shots) maps onto megadj with almost no new code — the CLI and deckctl
already exist. These ideas make agents _safe, useful operators_ of the
library, not gimmicks: **§O is P1 made real** — the missing interface for
"agent-first, MCP-friendly, `--json` on every command" — with O86's rails
keeping agents inside P9/P11's idempotent, resumable safety rules.

82. **megadj MCP server — ✅ SHIPPED 2026-09-05 (both halves).** Live:
    `cratedeck/src/mcp.ts` + `archive_tools.ts` + `bun run mcp` — the
    census derives from source and lives once in
    [surface-parity.md](surface-parity.md) §1. The archive half (O82b)
    is readonly reads over megadj's own DB (`readonly: true` handle;
    missing DB degrades to `available:false`, never throws). Per-tool
    list lives once:
    [cratedeck/deckctl.md](../cratedeck/deckctl.md#mcp--the-same-surface-for-ai-agents).
83. **Weekly agent prep loop (headless) — ✅ core SHIPPED 2026-09-05
    (`deckctl prep`).** One command renders the markdown digest:
    preflight verdict → redundancy gaps → archive status + LOWQ queue;
    the agent writes _nothing_. `--out FILE` / `--json`; the D30 sweep
    (archive blake2b vs DB) folded in 2026-09-07. Remaining optional: a
    `claude -p` wrapper. Effort S.

84. **Inbox-to-crate agent.** "Dump this folder/zip/URL list, get clean
    tagged files": combine `megadj drop` (K61) with an agent loop that
    handles the judgment calls (dupe resolution, genre arbitration,
    artwork picks) by asking the human only when confidence is low —
    `ingest --dry-run`, present the plan, execute on approval. Effort M.

85. **Skill/plugin packaging — ✅ SHIPPED 2026-09-05.** `plugin/` is the
    installable Claude Code bundle (plugin.json + `.mcp.json` + hooks +
    skills); `claude plugin validate` passes. A published marketplace
    variant is deliberately deferred — the cap rule: something ships or
    leaves first.

86. **Agent safety rails (the non-negotiable half) — ✅ SHIPPED
    2026-09-05 (now covering the archive tools too).** Mutating tools are
    annotation-flagged `readOnlyHint: false` and described
    `[MUTATES DRIVE STATE]`; the interlock check runs inside the tool
    layer (prompts are suggestions, exit codes are law); mirror/format
    are absent from the surface; archive tools are physically readonly.

87. **Timeline + job audit for agent actions — ✅ SHIPPED 2026-09-05.**
    `jobs.origin` records who asked (MCP stamp `mcp:<session-id>`,
    deckctl, auto-scheduler) on the job row and its timeline events —
    "why did this verify run at 3am" is answerable from the UI or CLI.

88. **CrateDeck findings-from-agents feed — ✅ SHIPPED 2026-09-05.**
    `deck_note`/`deck_notes` (mutating tool human-confirmed) land
    dismissable findings on the drive timeline as `agent-note` events;
    engine `cratedeck/src/notes.ts`, API `/api/drives/:id/notes`.

---

## H. Explicit non-goals (unchanged — say no)

- ❌ Writing device DBs outside rekordbox (`export.pdb`/`exportLibrary.db`
  injection stays in the proven pipeline only) — C18c's gauntlet exists
  so this rule only ever changes deliberately and safely.
- ❌ Editing tags/cues/grids _on drives_; rekordbox owns creation
  (analysis-derived tags live in the _files_ and our own DB/ANLZ pipeline)
- ❌ Cloud sync, accounts, multi-user, telemetry (§I models run locally)
- ❌ Audio playback/scrubbing in CrateDeck
- ❌ Mobile app (a localhost PWA-ish responsive pass is fine; native is not)
- ❌ Becoming a general DJ library manager — describe & verify, don't create
- ❌ Aggressive scraping of flaky sources: personal-use rate-limited only,
  cache-first, never a hosted service

---

## Suggested sequencing (idea-level)

> **Superseded:** the build order lives in the live queue in
> [product-state-2026-09-07.md](product-state-2026-09-07.md) (the Sep 6
> proposal that ordered it was executed and is archived at
> [archive/roadmap-proposal.md](archive/roadmap-proposal.md)).
> What remains binding here: **§0 gates everything**, and the **reality
> gate** (gig frequency, see §0) decides depth. Nearly every Phase 2–6
> item above shipped in the Sep 4–11 window (fleet, ⌘K, preflight,
> players, fingerprints, keys, moods, O82–O88, drop, similarity,
> MegaSet, shelf hygiene/dedupe/dupescan, grid-audit wave 2) — the
> open remainders are C18a/C21, O84, I46 full slice, K57–K59, M69–M74,
> and the two §0 physical tasks (0a evacuation run, 0b rclone remote).

**Deliberately unbuilt:** C18b/c (pdb write gauntlet — parked), I52
(deleted), K56 (lyrics), K60 (setlist.fm), E31/E44 (struck 2026-09-05:
P2 Pioneer-only). The cap rule stands: something ships or leaves before
something new enters.

**Stop condition:** two consecutive months of zero gigs and zero logged
incidents → finish Phase 1, keep the backup running, freeze the rest.
