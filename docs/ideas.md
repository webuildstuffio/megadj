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
| 0f  | ✅ superseded       | Generalized by the human-gated [shelf hygiene engine](getdat/shelf-hygiene-2026-09-09.md)      |
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

6. **Coverage matrix — ✅ SHIPPED 2026-09-04.** `cratedeck/src/coverage.ts` + `deckctl coverage`.
7. **Redundancy audit — ✅ SHIPPED 2026-09-04.** `fleet.ts redundancy()` + `deckctl redundancy`..
8. **Fleet diff — ✅ SHIPPED 2026-09-04.** `fleet.ts diff()` + `deckctl diff`.
9. **Global search across ghosts — ✅ SHIPPED 2026-09-05.** ⌘K in the web rail + `deckctl search`.
10. **Snapshot timeline & "what changed".** Versioned diffs between any two
    scans: "what changed on an old backup drive between the last gig and now?"
11. **Set intelligence.** Harvest player-written history (`HIST` entries on the
    drives) across the fleet → most-played, never-played, set reconstruction
    with timestamps → export as CSV/markdown/Spotify-searchable track list.
12. **Preflight check — ✅ core SHIPPED 2026-09-05.** `deckctl preflight` + `/api/preflight`: one pass/fail checklist over all mounted drives (dual-DB, grids, verify age, bench trend, bitrot, space, parity). Unknowns never fake ready; exit 1 gates cron/agents. Includes N75 compat + N76 firmware advisories (informational).
13. **Benchmark sparklines + anomaly alerts — ✅ SHIPPED (preflight rule +
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

---

## C. Sync pipeline: kill the remaining manual pain

18. **Automate the legacy-export dance.** `export.pdb` still needs the
    manual loop (XML → RB UI → drag → analysis → export). Options,
    escalating: (a) _assisted runbook_ — checklist UI with per-step
    done-buttons, auto-detecting completion (pdb counts, sync mtimes) —
    the right buy; (b) rekordbox scripting if 7.x grows a stable surface;
    (c) legacy-pdb editing via `fragmede/rekordbox-pdb` behind the full
    gauntlet — honest pricing: upside is deleting a few-times-a-month
    dance, downside is a corrupted library at a venue. Unbuilt.
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
25. **Duplicate hunter across the whole estate — ✅ SHIPPED (Sep 2026,
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
43. **Rekordbox master library introspection (read-only).** Mac `master.db`
    via pyrekordbox = live collection state for diffing without XML
    re-export. Strictly read-only, seam-disciplined (schema drift risk).
44. ~~**Serato crate export.**~~ **STRUCK 2026-09-05.** P2 is absolute — no
    Serato, not even one-way export; guests get files + `.m3u8` (M74).

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

46. **Structure-aware grids & cues — 🔶 v0 + wave-2 tooling SHIPPED
    (rev 6.2; 2026-09-10).** `megadj cues` derives 8-bar phrase markers
    from the beats ledger (DB-side, idempotent); the rekordbox WRITE is
    the deliberate next gate. Remainder SSOT:
    [fulltags/grid-audit-plan.md](fulltags/grid-audit-plan.md); the full
    all-in-one-infer slice stays follow-on. **Honest label: the genuine
    10x item, likeliest to eat a month** (grids, not cues). Effort M-L.

47. **Auto hot-cue archetypes.** rekordbox 7's in-app "learning" places cues
    by your habits; replicate offline with segment labels: cue A = intro,
    B = first drop, C = break, D = outro across the whole library, so every
    track behaves the same on hardware. Falls out of I46 nearly free.

48. **Mixability metrics from stems.** demucs-infer (I46 dep) gives
    vocal/instrumental separation → a "vocal density" tag (instrumental /
    light / full) — the filter field no tag source provides. Stems files
    out of scope (CDJs can't play them); analysis-side metric only.

49. **Embeddings & "sounds like" — ✅ SHIPPED 2026-09-08 (effnet tower).**
    **2026-09-14 update:** tower re-validated by the v2 benchmark + an
    external research review — effnet stays the single tower, but the
    readout upgrades (linear probe for genre, whitening+CSLS for
    retrieval, transition-window similarity) are the new queue: see
    [fulltags/embedding-research-2026-09-14.md](fulltags/embedding-research-2026-09-14.md)
    and §P below.

50. **LLM track captioning (vibe notes).** Feed Essentia tags + structure
    labels + metadata to a local/small LLM → a one-line vibe description
    per track, written to the comment tag. **Honest bet, from the audit:
    you'd read these twice and never filter by them** — keep only as a
    `megadj drop` garnish, never infrastructure. Effort S.

51. **Key detection that beats rekordbox — ✅ SHIPPED 2026-09-05.** OpenKeyScan gate PASS (80.7%); TKEY writes unlocked pending the RB gauntlet (roadmap §2 #3).

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

53. **The full frame schema.** One definition in the skill docs, applied
    by `ingest` + `upgrade`: `TBPM`, `TKEY`, `TCOM`/`TIPL` credits,
    `TPUB` label, `TMED` source, and the `TXXX` set. Label/remixer/ISRC
    landed via Beatport (rev 6.4/6.5); gap left: composer/producer, `TMED`.

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

57. **SoundCloud as a first-class source.** yt-dlp makes SC mostly
    config: liked-sync (`source=sc`), Go+ 320 via OAuth, reposts/artist
    pages. **2026-09-05 (verified):** SC works (browser-impersonation);
    DRM go+ tracks 404 forever; keep yt-dlp nightly + `curl_cffi`.
    Effort S-M. The single biggest library-expansion lever.

58. **Bandcamp + long-tail platforms.** `sync --source <platform>` one
    at a time behind the probe/quality pipeline; Bandcamp first (beetcamp
    proves the JSON scrape). **2026-09-05:** yt-dlp Bandcamp is broken
    (#17506) — wait for the upstream fix. Effort S per platform.
    **2026-09-14 addition:** Bandcamp is now ALSO the genre-ladder's next
    arm — direct album-page fetches expose publisher tags + label without
    yt-dlp (download and metadata are separate problems), feeding the
    multi-source vote (§P75). K58 (download source) and P75 (genre arm)
    share the fetcher.

59. **1001tracklists mining → discovery queue.** Scrape tracklists of DJs
    and shows you follow: "played everywhere, not in your library" queue
    ranked by 90-day set appearances, one keypress to enqueue via
    K57/K58/YTM. Turns megadj from an archiver into a discovery engine.
    Effort M (rate-limit, cache, personal use only).

60. **setlist.fm mining (low priority).** Free API key, clean Python client
    (`setlist-fm-client`). Only useful for non-DJ gig mining; park.

61. **Quickie-style one-shot mode (`megadj drop`) — ✅ SHIPPED 2026-09-07.**

---

## L. Fingerprints, dedupe & identity

62. **Acoustic fingerprint ledger — ✅ SHIPPED 2026-09-05.** 88/88 executed; consumers live (dupescan, lost-file finder is issue #10).

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
66. **Set copilot — ✅ SHIPPED (core Sep 8; CLI spoke Sep 11).** Graduated to docs/set/ as its own product doc set.
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
70. **macOS metadata litter audit.** `._*`/`.DS_Store`/`.Spotlight-V100`
    on FAT32 — CDJs choke; Finder recreates them each mount. Extend scan
    junk detection with a one-click clean (guard-gated) + a `defaults
write` hint. Effort S.
71. **"Why is my transfer 8 MB/s?" — port-speed truth serum. ✅ SHIPPED** —
    `usbLinkClass` (detect.ts), the drive-rail USB badge with slow-link
    styling, and the `speedtest` job (DeckDrive.link_bps). macOS
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

75. **Hardware compatibility matrix as data (Device vs OneLibrary) — ✅ SHIPPED 2026-09-05.** `cratedeck/src/players.ts` + `deckctl players` + `deck_players`; verdicts from the drive's MEASURED dual-DB rows, folded into preflight (a fully blocked drive is not-ready).

76. **Preflight firmware-notes field.** CDJ-3000 v3.30 (playlists
    vanished, firmware pulled) is the recurring failure class: add a
    manual per-player firmware field + the rule of thumb _drive shows,
    playlists empty → check which library format that firmware
    prioritizes_. Effort S.

77. **XDJ-XZ-specific export profile.** The XZ reads Device Library only,
    supports FAT32/exFAT/HFS+ (not NTFS, not GUID partition map, not
    case-sensitive HFS+), and firmware updates require FAT/FAT32 + MBR.
    Encode it: `megadj format --profile xdj-xz` (M69) defaults to the
    right scheme; CrateDeck flags incompatible formats. Effort S.

78. **"Which players will this stick work on?" — the fleet answer — ✅ SHIPPED 2026-09-05** (`deckctl players [drive]`,
    `/api/drives/:id/players`). N75's matrix + the measured dual-DB state
    → a per-drive verdict. The thing rekordbox cannot tell you at all.

79. **Genre-normalized house/techno taxonomy.** Discogs-400 styles model
    - Essentia classifiers vote against LLM genre + MusicBrainz → one
      normalized genre + styles[] in the archive DB, feeding M66 and K59.
      Effort M. **2026-09-14:** this is now the live genre-audit pipeline
      (§5b of the genre audit) — Discogs-400 head measured, ranked
      secondaries queued; the multi-source _vote_ (not first-win) ladder is
      the §P75 addition.

80. **Energy-arc presets per genre.** I45's VA + danceability define
    "warm-up"/"peak"/"afterhours" envelopes for the crate copilot (M66) —
    the "play a warm-up set" button, grounded in measured features.
    Effort M.

81. **Stems-as-metadata (offline).** rekordbox 7's real-time stems rate
    ~3★ vs offline demucs-class models: render at ingest (I46), store
    vocal-density + instrumental-ness (I48); stem FILES for players stay
    parked (non-goal). Effort M.

---

## O. Agentic megadj (Codex / Claude Code as first-class operators)

The 2026 agent-CLI taxonomy (skills, hooks, subagents, MCP, headless
one-shots) maps onto megadj with almost no new code — the CLI and deckctl
already exist. These ideas make agents _safe, useful operators_ of the
library, not gimmicks: **§O is P1 made real** — the missing interface for
"agent-first, MCP-friendly, `--json` on every command" — with O86's rails
keeping agents inside P9/P11's idempotent, resumable safety rules.

82. **megadj MCP server — ✅ SHIPPED 2026-09-05 (both halves).** Live: `bun run mcp` (deck + getdat tools) + `cratedeck/src/archive_tools.ts` (readonly archive reads).
83. **Weekly agent prep loop (headless) — ✅ core SHIPPED 2026-09-05 (`deckctl prep`).** One command renders the digest (preflight → redundancy → archive + LOWQ); the agent writes _nothing_. `--out`/`--json`; D30 sweep folded 2026-09-07. Optional left: a `claude -p` wrapper.

84. **Inbox-to-crate agent.** "Dump this folder/zip/URL list, get clean
    tagged files": combine `megadj drop` (K61) with an agent loop that
    handles the judgment calls (dupe resolution, genre arbitration,
    artwork picks) by asking the human only when confidence is low —
    `ingest --dry-run`, present the plan, execute on approval. Effort M.

85. **Skill/plugin packaging — ✅ SHIPPED 2026-09-05.** `plugin/` is the packaged skill + MCP entry (`plugin/README.md`).

86. **Agent safety rails (the non-negotiable half) — ✅ SHIPPED 2026-09-05.** Interlock, guard allowlist, and the P1 `--json` contract; see AGENTS.md.

87. **Timeline + job audit for agent actions — ✅ SHIPPED 2026-09-05.**

88. **CrateDeck findings-from-agents feed — ✅ SHIPPED 2026-09-05.**

---

## P. Embedding readout & genre-quality addendum (2026-09-14 research review)

> From the external deep-read snapshotted at
> [fulltags/embedding-research-2026-09-14.md](fulltags/embedding-research-2026-09-14.md)
> (9 papers + tower landscape + compute audit). Full measured context:
> [fulltags/embedding-models.md](fulltags/embedding-models.md) +
> [fulltags/genre-audit.md](fulltags/genre-audit.md) §5b. Numbering
> continues from §O. The one-paragraph reframe: **our 0.444 is ~77% of the
> random-noise LOO ceiling (~0.58) — the wins now come from readout
> (probe > kNN), retrieval geometry (whiten/CSLS), and taxonomy (the
> `edm` umbrella), not from any tower swap.**

89. **Tier-0 diagnostics battery.** ✅ DONE (Sep 15,
    [tier0-diagnostics-2026-09-15](fulltags/tier0-diagnostics-2026-09-15.md) —
    implemented as `genre --eval --diagnostics --artist-disjoint --probe`).
    Four cheap measurements that re-rank everything else in this section: (a) cluster label errors by
    artist/release/imprint (systematic ⇒ no ceiling, relabelling buys
    ~nothing; random ⇒ items 7/refold are worth points); (b) same-artist
    share of top-5 neighbours (effnet is the Discogs-metadata tower most
    likely to fingerprint artists — Sturm's "horse"; >15% ⇒ all LOO
    numbers get an artist-disjoint rerun); (c) hubness histogram
    (k-occurrence skew — a few tracks at 40+ occurrences ⇒ P91 is
    nearly-free points); (d) confusion matrix + top-2 accuracy in
    `genre --eval` (is the error mass the house/techno/trance triangle —
    arguably not errors — or structural?). **Measured: noise RANDOM,
    leakage ABSENT (4.2%), hub tail REAL, `edm↔house` is the error
    block (17.7% triangle only).**
90. **Linear probe as the genre readout.** ❌ GATE FAILED (Sep 15: 5-fold
    CV 51.5% vs kNN 62.6%, Δ −11.1 — the ≥3-pt win gate flips to a hard
    loss; kNN stays the production readout; re-test only after the P94
    refold changes the label distribution). Logistic regression on the
    cached 1280-d vectors — the literature-standard protocol nobody's
    benchmark headlines kNN instead; comparable towers gain 15–25 pts.
    `genre --eval --probe`; gate: beat the kNN vote by ≥3 pts on the
    guarded population before becoming production. **megadj genre is
    classification → the probe is the fix; "sounds like" is retrieval →
    P91/P93 are the fixes there.** Effort S.
91. **Whitening + CSLS retrieval space.** ✅ SHIPPED flag-gated (Sep 15:
    `megadj similar --space whitened` + route + MCP; coherence proxy
    flat 0.462 vs 0.454, but the qualitative A/B is decisive — raw
    scores saturate at 0.90+ with junk hubs everywhere, whitened
    spreads 0.70→0.05 and demotes them; P100's 100-mix judgment
    decides adoption). Mean-centre, whiten (or
    all-but-the-top), CSLS-correct the kNN in `megadj similar`/Set.
    Flag-gated (`--space
raw|whitened`) for A/B. Effort S.
92. **Full-population LOO.** ✅ SUBSUMED (Sep 15: the Tier-0 eval battery
    runs the canonicalized+flagged population live — ~3,000 gated rows
    per run — so the ±1 error bars this item sought are the default, not
    an experiment). Was: n=3,500 over the cached vectors instead of
    n=180 — error bars ±6 → ~±1, making every sub-3-point claim
    falsifiable. 3,500² float32 ≈ 50 MB; seconds in numpy. Effort S.
93. **Projection head (learned metric, not a tower swap).** 1280→256
    linear map, SupCon/triplet on family labels with the 4/4-triangle
    hard negatives; improves genre AND retrieval simultaneously; one
    matmul at query time; a _derived view_ of the same vectors, so the
    single-ledger rule holds. Canonical ref: Lee et al., ICASSP 2020.
    Minutes on CPU. Effort S-M. The actual Set fix.
94. **`edm` umbrella arbitration.** ▲ PROMOTED to the top genre fix (Sep
    15 diagnostics: `edm→house` 276 + `house→edm` 84 = 360/896
    disagreements — the single biggest block, bigger than the whole
    house/techno/trance triangle). `edm` is a parent of house/techno/
    trance sitting as a sibling — every plain-`edm` track is a forced
    LOO error (the B1 `dance` bug one level up). Arbitrate via the
    head+kNN dispute pass in the refold; keep hard-dance/eurodance/
    nightcore in `edm`, keep ALL Tier-1 sub-genre labels (hardtekk
    stays). Expected +6–12 pts alone. Effort S.
    **✅ SHIPPED Sep 15 (`genre --refold` / `--eval --refold`,
    `src/fulltags/genre-refold.ts`): measured **+7.4 pts** on the final
    canonical data (61.7% → 69.2% gated, refusal 20.7% → 13.0%; the
    pre-write A/B read 62.6% → 70.3% / +7.7 — same verdict) — inside
    the predicted band, over the ≥65% ship gate, and `--eval --refold`
    exits 0 (the gate judges the refold arm). Data half applied live:
    790 canonicalization writes + 71 casing-only carries + 43 umbrella
    split canonicalizations; census now FULLY idempotent (3458/3458
    canonical, 0 changeable, 0 casing twins). Scoring arbitration stays
    a vote-time policy — the collection column keeps `EDM` (a real
    source label). **Follow-up shipped Sep 15 (§5b.3 step 2): the
    disputed-flag pass (`genre --flag`) flagged 96/2982 labels that
    contradict a unanimous kNN consensus — never rewritten, excluded
    from seeding; Tier-0 battery re-ran clean post-flag.**
95. **Active-learned label refold.** 900 labels → probe → hand-label only
    the ~600 lowest-margin/disagreement tracks; concentrates human hours
    on the house/techno/trance boundary. Gated by P89(a): if label noise
    is systematic, skip straight to crate co-occurrence. Effort S-M + ~5 h
    human.
96. **Imprint prior + LLM pre-labelling.** For EDM the label/imprint is
    near-ground-truth (Drumcode→techno, Anjuna→trance). Auto-label with
    confidence from archive.db metadata; human-verify only the
    low-confidence tail; cuts listening hours 60%+. Feeds the refold and
    the LLM residue pass. Effort S.
97. **Tempogram/rhythm-feature concat.** All six towers are timbre
    models; EDM subgenre is substantially rhythm. beat_this's beat grids
    (already ledgered, roadmap #2) give rhythm features free — concatenate
    or late-fuse. arXiv:2110.08862: tempogram fusion recovers
    uplifting-trance misread as tech-trance — our exact fuzz. Effort M.
98. **Transition-window embeddings (outro→intro index).** DJs mix 32-bar
    sections, not tracks. The patch towers already emit per-~3 s patch
    embeddings and the cues ledger stores 32-bar phrases — pool only
    intro/outro windows; no new model, no Demucs bill. The "sounds like
    the part I can actually mix" feature no product ships. Effort S-M.
99. **Retrieve-then-rerank (dissolves the fusion gate).** Cheap effnet
    recall top-50 → expensive tower reranks 50: the cost ratio that
    killed fusion (2–6× corpus-wide) drops to 50/3,500. Also: re-verify
    the RRF fusion row with the fixed comparator (descending-sort bug
    lived there — the −3.3 pt number is unverified), and always
    per-query normalize before fusing (the z-scored fuser winning is the
    tell). Effort M.
100.  **Ranking metrics + live A/B.** nDCG@10/MRR/Recall@k have lower
      variance than binary agreement at the same n; and per the MegaMem
      eval stance — genre labels at 60–76% audio-consistent IS the
      no-ground-truth regime, so 100 A/B "which list would I actually
      mix" judgments beat another 10K kNN evaluations. Effort S.
101.  **Crate co-occurrence supervision (the biggest basin jump).**
      Playlist membership, My Tags, play/set history → millions of
      implicit similarity pairs encoding what we actually mix, not a
      genre proxy; sidesteps the label ceiling entirely. Needs B11-style
      history accumulation first — parked until it exists, exactly like
      M64. Slaney et al. ISMIR'08 is the canonical recipe. Effort M.

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
> Set, shelf hygiene/dedupe/dupescan, grid-audit wave 2) — the
> open remainders are C18a/C21, O84, I46 full slice, K57–K59, M69–M74,
> and the two §0 physical tasks (0a evacuation run, 0b rclone remote).
> **2026-09-14: the live queue's top block is the §P genre/readout
> ladder** (P89–P94 first, per the research review) — genre quality
> before further set-generation work.
> **2026-09-15: roadmap-sync audit — every open remainder re-tracked on
> GitHub with code verification:** C21 →
> [#117](https://github.com/webuildstuffio/megadj/issues/117), C22 →
> [#118](https://github.com/webuildstuffio/megadj/issues/118), B10/B11
> (HIST harvest) →
> [#116](https://github.com/webuildstuffio/megadj/issues/116), K57 →
> [#109](https://github.com/webuildstuffio/megadj/issues/109), K59 →
> [#110](https://github.com/webuildstuffio/megadj/issues/110), M69/N77 →
> [#119](https://github.com/webuildstuffio/megadj/issues/119), GA-00 →
> [#111](https://github.com/webuildstuffio/megadj/issues/111),
> AC-01/02 → [#112](https://github.com/webuildstuffio/megadj/issues/112),
> P98 → [#113](https://github.com/webuildstuffio/megadj/issues/113),
> J53/D26 remainder →
> [#123](https://github.com/webuildstuffio/megadj/issues/123), Set B1 →
> [#104](https://github.com/webuildstuffio/megadj/issues/104),
> B2/B3/B7/B9 →
> [#105](https://github.com/webuildstuffio/megadj/issues/105), Phase D →
> [#106](https://github.com/webuildstuffio/megadj/issues/106),
> scoring depth →
> [#107](https://github.com/webuildstuffio/megadj/issues/107).
> **2026-09-15 (batch 2 — the next 10):** P100 →
> [#125](https://github.com/webuildstuffio/megadj/issues/125), B10 →
> [#126](https://github.com/webuildstuffio/megadj/issues/126), D29 →
> [#127](https://github.com/webuildstuffio/megadj/issues/127), P96 →
> [#128](https://github.com/webuildstuffio/megadj/issues/128), P93 →
> [#129](https://github.com/webuildstuffio/megadj/issues/129), P97 →
> [#130](https://github.com/webuildstuffio/megadj/issues/130), M65 →
> [#131](https://github.com/webuildstuffio/megadj/issues/131), D30 →
> [#132](https://github.com/webuildstuffio/megadj/issues/132), I47 →
> [#133](https://github.com/webuildstuffio/megadj/issues/133), B13 →
> [#134](https://github.com/webuildstuffio/megadj/issues/134), M74 →
> [#135](https://github.com/webuildstuffio/megadj/issues/135), F39 →
> [#136](https://github.com/webuildstuffio/megadj/issues/136), E32 →
> [#137](https://github.com/webuildstuffio/megadj/issues/137), GA-02 →
> [#138](https://github.com/webuildstuffio/megadj/issues/138), M70 →
> [#139](https://github.com/webuildstuffio/megadj/issues/139).
> M71 marked SHIPPED in place (usbLinkClass + drive badge + speedtest
> verified in code); M70's detection half shipped via the hygiene engine,
> the drive-side clean path is #139.
>
> **2026-09-15 (batch 3 — the deepest backlog, product-categorized; the
> full categorized index lives in [docs/roadmap-index.md](roadmap-index.md)):**
> GA-07 run →
> [#147](https://github.com/webuildstuffio/megadj/issues/147) (p0, gates
> every repair), new-music radar (PRD F10) →
> [#148](https://github.com/webuildstuffio/megadj/issues/148), age & wear
> (PRD F10) → [#149](https://github.com/webuildstuffio/megadj/issues/149),
> C18a assisted export runbook →
> [#150](https://github.com/webuildstuffio/megadj/issues/150), G42 →
> [#151](https://github.com/webuildstuffio/megadj/issues/151), M72 →
> [#152](https://github.com/webuildstuffio/megadj/issues/152), F38 →
> [#153](https://github.com/webuildstuffio/megadj/issues/153), B15 →
> [#154](https://github.com/webuildstuffio/megadj/issues/154), alias
> depth → [#155](https://github.com/webuildstuffio/megadj/issues/155),
> P95 active labelling →
> [#157](https://github.com/webuildstuffio/megadj/issues/157).
>
> **2026-09-15 (batch 4 — PRD/plan/postmortem docs ONLY; ideas.md declared
> the least authoritative source and the top ideas-sourced item from each
> earlier round closed: #109, #126, #151. Full receipts in
> [docs/roadmap-index.md](roadmap-index.md) §Batch-4 sourcing):**
> F11 rb-import dupe gate →
> [#163](https://github.com/webuildstuffio/megadj/issues/163), F12
> dot-file receipts →
> [#164](https://github.com/webuildstuffio/megadj/issues/164), AC-07
> cue_feedback → [#165](https://github.com/webuildstuffio/megadj/issues/165),
> GA-05b calibration →
> [#166](https://github.com/webuildstuffio/megadj/issues/166), GA-05c
> grid-health card →
> [#167](https://github.com/webuildstuffio/megadj/issues/167), GA-08
> verify/rollout → [#168](https://github.com/webuildstuffio/megadj/issues/168),
> regate genre/effnet →
> [#169](https://github.com/webuildstuffio/megadj/issues/169), license
> ledger → [#170](https://github.com/webuildstuffio/megadj/issues/170),
> Set embeddings prior →
> [#171](https://github.com/webuildstuffio/megadj/issues/171), Set LUFS →
> [#172](https://github.com/webuildstuffio/megadj/issues/172), vote
> ladder → [#173](https://github.com/webuildstuffio/megadj/issues/173),
> freshness ages on compare surfaces →
> [#174](https://github.com/webuildstuffio/megadj/issues/174).

**Deliberately unbuilt:** C18b/c (pdb write gauntlet — parked), I52
(deleted), K56 (lyrics), K60 (setlist.fm), E31/E44 (struck 2026-09-05:
P2 Pioneer-only). The cap rule stands: something ships or leaves before
something new enters.

**Stop condition:** two consecutive months of zero gigs and zero logged
incidents → finish Phase 1, keep the backup running, freeze the rest.
