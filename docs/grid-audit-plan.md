# Grid Audit, Repair & Auto-Cue — the full plan (v3)

**Status:** 🧭 ACTIVE — implementation and hardware validation remain.

_2026-09-10. Supersedes the chat-plan v2. This file is the project SSOT for
grid audit + auto-cue; `docs/ideas.md` I46/#47 and
`docs/fulltags-roadmap.md` #2/P2 point here. (The old root `plan.md`'s
runtime-perf round now lives in [docs/ideas.md](ideas.md) §0f.)_

Two systems sharing one analysis pass:

- **Part 0 + S** build the gold standard and the shared analysis pass, so
  accuracy is a number instead of a feeling.
- **Part A** finds and fixes broken beat grids across the library.
- **Part B** places hot cues, memory cues, labels, and colors — tuned for
  house, with a trap/rap variant.

Order matters. Part 0 first: without it you can't tell whether an
improvement helped. Part A before Part B: cues written against a wrong grid
get quantize-snapped to the wrong place.

**Licensing posture: non-commercial, confirmed.** madmom's DBN, Essentia
models, and everything else NC-licensed are usable. Escape hatch stays
open: beat_this without DBN is MIT everything and near-SOTA; keep the DBN
behind a config flag, not hardcoded. (P9 already covers this; PRINCIPLES
zero-commercial is the standing arbiter.)

---

## 0. The audit — what already exists, what's missing

This section is the honest diff between the v2 chat plan and the repo as
of 2026-09-10. Everything else in this doc is re-scoped around it.

### 0.1 Already built (reuse, don't rebuild)

| Asset                                 | Where                                                                                                                            | State                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beat + downbeat arrays, whole archive | `megadj beats` → `beats` table (`src/commands/beats.ts`, `src/state.ts`)                                                         | 131/131 ledgered, idempotent. beat_this v1.1.0, MIT, **peak-picking (no DBN), device=cpu**                                                                                                  |
| Tempo readouts                        | `fulltags/src/analysis.ts` (`analyzeBeats`, median inter-beat; `tempoFromBeatGrid` bar-lag)                                      | TBPM tag writes **blocked by gate** (12/24, re-gate 16/24 — the ~2.2–2.6% phase-lock); arrays are DB-only by decision                                                                       |
| 8-bar phrase cues                     | `megadj cues` → `cues` table (`src/commands/cues.ts`)                                                                            | 131/131, 2,043 cues, DB-side only                                                                                                                                                           |
| Independent grid cross-check          | `ArchiveReader.gridCrossCheck` (`cratedeck/src/archive.ts`), `GET /api/archive/grid-cross-check`, MCP `archive_grid_cross_check` | Coarse: BPM-level ok / off (>2%) / octave vs RB. **No anchor/drift/phase — that's the A2 gap**                                                                                              |
| Drive verify grid check               | `usb_verify.py` `anlz_consistency` → `cratedeck/src/verify_report.ts`                                                            | **Self-referential** (duration×BPM vs beat count from the same analysis). ANLZ existence + between-drive parity are real; independent grid correctness comes from the cross-check           |
| ANLZ hash-path math                   | `.claude/skills/rekordbox-usb-sync/scripts/anlz_paths.py`                                                                        | The A1 drive-vs-collection byte compare can be built directly on this                                                                                                                       |
| Compressed-audio decode seam          | `analyzeBeats` ffmpeg→tmp-WAV                                                                                                    | **S2 preprocessing already exists** for the beat path                                                                                                                                       |
| Key detection                         | OpenKeyScan, `fulltags --key`                                                                                                    | **SHIPPED — 80.7% gate PASS, 131/131 written.** The v2 plan's "your pipeline doesn't do key at all" is stale. Remaining: the RB gauntlet (disable Key analysis → Reload Tags) at next mount |
| Safety scaffolding for DB writes      | `megadj rb-fix-paths` pattern: backup → refuse-while-rekordbox-runs → whole-table post-check                                     | A4/B7 reuse this pattern verbatim                                                                                                                                                           |
| Gate discipline                       | `docs/fulltags-roadmap.md` §4.2                                                                                                  | No analysis stage writes without a measured agreement number — the whole plan runs on this rule                                                                                             |
| pyrekordbox 0.4.4 seam                | rb_read.py / rb-fix-paths                                                                                                        | Reads master.db; shelf-hosted master DB realities already encoded in AGENTS.md                                                                                                              |

### 0.2 Missing (the actual build)

| Gap                                                                      | Ticket(s)                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Gold standard set + metrics harness (Part 0)                             | GA-00, GA-00b — **harness SHIPPED**, annotation manual                                        |
| Constant-tempo fit (single-BPM regression + residual) on the ledger      | GA-01                                                                                         |
| DBN pass + per-genre tempo priors                                        | GA-02                                                                                         |
| Structure labels (SongFormer primary, allin1 second opinion)             | AC-01                                                                                         |
| Demucs bass/drums stems + per-bar energy                                 | AC-02                                                                                         |
| A1 triage: drive-vs-collection ANLZ byte compare per track               | GA-03 — **SHIPPED** (`megadj rb-grid-triage`)                                                 |
| A2 per-track grid diff (anchor / BPM ratio / drift / phase / confidence) | GA-04 — **SHIPPED** (ledger + ANLZ halves)                                                    |
| A3 bucketing + calibrated thresholds                                     | GA-05                                                                                         |
| A4 grid repair writer + the write-path spike                             | GA-06, GA-07 — spike **harness + runbook SHIPPED** (`megadj rb-anlz-spike`), experiments open |
| B3 agreement gating, B5 cue layout, B7 cue writer, B8 validation gate    | AC-03…AC-06                                                                                   |
| B10 feedback loop (cue-delta ledger)                                     | AC-07                                                                                         |

### 0.3 Corrections to v2 (research-verified 2026-09-10)

1. **Key detection is done.** v2 listed it as a gap; OpenKeyScan passed its
   gate (80.7% vs RB ScaleName) and is written into all 88 files. Struck
   from S1; only the operational RB gauntlet remains.
2. **beat_this's DBN has no tempo-range knob.** `File2Beats(dbn=True)` runs
   madmom's defaults (55–215 BPM, 3/4+4/4). The S3 per-genre ranges need
   our own wiring: `Audio2Frames` for framewise activations → a
   `DBNBeatTrackingProcessor(min_bpm, max_bpm, fps=50)` we construct per
   genre. madmom must be CPJKU's git fork (PyPI 0.16.1 is Python<3.10 /
   numpy<1.20). Non-commercial is fine — madmom's models are CC BY-NC-SA.
   Keep `dbn` a config flag; MIT-only path = current peak-picking.
3. **SongFormer numbers corrected.** Actual SongFormBench-HarmonixSet
   table: SongFormer (HX+E+H+G) **ACC 0.891 / HR.5F 0.690**; (HX-only)
   0.848/0.675; allin1 baseline on the same bench 0.834/0.563; Gemini 2.5
   Pro 0.806/0.412. License: code/datasets CC-BY-4.0 (repo shows "Other"
   on GitHub; README states CC-BY-4.0 — re-verify the weights' model card
   at install). Still the primary structure model; allin1 stays the
   second opinion for gating.
4. **The XML write path has a landmine: the reimport bug.** RB 5.6.1
   through 7 do **not update existing tracks** on XML import. The
   community workaround is two-step: right-click playlist → "Import to
   Collection" (adds new), then select-all → "Import to Collection" again
   (forces overwrite). Whether an imported `TEMPO` element actually
   overwrites an _existing analyzed grid_ AND regenerates the collection's
   local ANLZ files is **unverified — this is the week-1 spike (GA-07)**,
   and it decides GA-06's implementation, not the other way round.
5. **Grid fixes must reach the collection's ANLZ files, not just the DB.**
   Players read ANLZ sidecars. Rekordbox regenerates drive ANLZ at USB
   export _from the collection's analysis_ — if the collection sidecar
   wasn't rewritten, the export faithfully copies the old wrong grid. So
   the repair surface is: XML/master.db grid fields + the ANLZ files under
   the collection's analysis dir. rbox (PyPI) claims ANLZ read+write;
   pyrekordbox reads ANLZ but writing is "planned, not implemented."
   Alternative fallback: direct ANLZ beatgrid edit via the
   crate-digger/rekordcrate format specs, behind the rb-fix-paths safety
   pattern. All of this is exactly what the GA-07 spike exists to settle.
6. **Cue colors differ per write surface.** XML `POSITION_MARK` carries
   `Red`/`Green`/`Blue` attributes (free RGB). master.db `djmdCue.Color`
   is a palette **ID** (−1 = none), not RGB. XML route is primary; a DB
   route must map to the palette. Cue times: XML takes seconds (float);
   djmdCue takes InMsec + InFrame (1/150 s) + VBR/ABR fields
   (`InMpegFrame`/`InMpegAbs`) — an MP3-VBR pain point pyrekordbox's own
   author never finished. Another reason the XML route is primary.
7. **Trap BPM convention is already half-decided by the repo.**
   `foldTempo` folds to 70–180; the beats ledger stores raw + folded. For
   trap we adopt: **store double-time (140, not 70)** in rekordbox-facing
   surfaces, matching the ledger's folded value when it lands in-range.
   The convention goes in one place (a shared constant + census test), not
   sprinkled.

### 0.4 Ticket numbering

Local IDs below are stable and cited everywhere. GitHub issues are filed
**when a stage starts** (repo convention: issues carry status, docs carry
why); the next free numbers are #23+. A `GA-xx → #NN` mapping lands in
this table as issues are filed.

---

## Part 0 — Gold standard and measurement

### GA-00 — Build the set

**STATUS: HARNESS SHIPPED 2026-09-10** — schema, guards, loader, and the
dev/holdout split live in `fulltags/src/gold.ts` (tested in
`fulltags/test/gold-set.test.ts`); scoring runs via `megadj gold-report`
(GA-00b). What remains is the manual half: annotate 30 tracks into
`~/Music/DJ-Imports/_gold/` — one versioned JSON per track, shape
enforced by `goldSchemaError` (blake2b hash key, first downbeat ms, BPM,
32-bar phrase bars, ≤8 hot-cue times, house/trap/unknown branch). The
loader surfaces corrupt files by name; it never fakes success.

Hand-annotate 30 tracks. One evening; the highest-leverage thing here.

- **20 house** — across subgenres you actually play, ≥3 known-awkward
  (live-ish drums, vinyl-sourced, odd intro lengths)
- **10 trap/rap** — ≥3 with clear half-time feel

Per track record: true first downbeat (ms), true BPM, every 32-bar phrase
boundary, and where you'd put each of the eight hot cues — the last one
captures _your_ preferences, not a textbook's.

Store as JSON next to the audio, keyed by file hash (blake2b — the same
hash the archive sweep already computes), versioned. Expected location:
`~/Music/DJ-Imports/_gold/` (NOT in the repo) + a schema + loader test in
repo. Annotation itself is manual; the loader, schema guards, and split
logic are code (`fulltags/test/gold-set.test.ts`).

### GA-00b — Metrics harness

**STATUS: SHIPPED 2026-09-10** — `megadj gold-report [--json]` loads the
gold set, joins ledger rows to annotations BY CONTENT HASH (filenames
lie), scores the plan §0.2 axes (anchor ≤10 ms, BPM ≤0.05 with the
octave census counted separately, phrase within 1 bar, cues within
50 ms), and reports dev and holdout rows — same numbers, every time.
Exit 1 with a pointer at GA-00 when no annotations exist yet (an empty
report must never read as a pass).

Report after every pipeline change. Same numbers, every time.

| Metric           | Definition                                         | Target |
| ---------------- | -------------------------------------------------- | ------ |
| Anchor accuracy  | % tracks with first downbeat within 10 ms          | > 95%  |
| BPM accuracy     | % within 0.05 BPM; ratio errors counted separately | > 98%  |
| Phrase alignment | % predicted boundaries within 1 bar of truth       | > 85%  |
| Drop precision   | % drop cues you'd accept unchanged                 | > 80%  |
| Cue acceptance   | % of all generated cues you'd accept unchanged     | > 80%  |
| Reliable-accept  | % auto-accepted by the gate _and_ correct          | > 80%  |

The last row is the one that matters: a system that's 85% accurate but
can't tell you _which_ 85% is worse than one that's 80% and flags its own
uncertainty — you trust the wrong cue mid-set.

Deliverable: `megadj gold-report --json` (one summary object, P1
contract) reading the gold set + the ledgers. No tuning against holdout
(see §Measurement discipline below).

### Measurement discipline

Never tune against the gold set and then report on it. Split 20 dev / 10
holdout; holdout is touched only when you think you're done. Small
numbers, but enough to catch overfitting to your own 20 favourite records.

---

## Shared foundation (S)

### GA-01 — Constant-tempo constraint for house

**STATUS: SHIPPED 2026-09-10.** `fitConstantTempo` +
`gridAudit` live in `fulltags/src/analysis.ts` (pure, tested in
`fulltags/test/analysis-grid.test.ts`); `megadj beats` stores
`bpm_fitted` + `bpm_residual_std` (columns auto-migrate); the CrateDeck
grid cross-check derives its verdicts from the SAME functions — one SSOT.

House is grid-locked by construction: fixed tempo, 4/4, machine-sequenced.
Don't let a beat tracker's per-beat wobble through.

Fit a single BPM by linear regression of beat index against beat time,
take `60 / slope`, store `bpm_fitted` + `bpm_residual_std` alongside the
raw arrays (new columns on `beats`; migration + backfill; arrays stay).
Reject residual variation entirely when it's small and uniform; fall back
to a multi-point grid only when it isn't (the genuine variable-tempo
case).

**This is the largest single accuracy gain in the plan for house** —
rounding error is exactly what produces drift over a 7-minute track. Ship
in the first pass (accuracy ladder #1, effort S).

### GA-02 — DBN pass + genre tempo priors

**STATUS: FLAG WIRED 2026-09-10** — `MEGADJ_DBN=1` flips
`File2Beats(dbn=True)` and pulls the CPJKU madmom fork into the uv env
on demand (non-commercial license honored; peak-picking stays the
default). The per-genre `DBNBeatTrackingProcessor` priors below are still
open — beat_this exposes no range knob, so our own postprocessor remains
the real GA-02.

- Install CPJKU madmom fork into the uv env (`--with-requirements` form —
  the per-package `--with` spelling resolves differently and hangs; known
  trap in `analysis.ts` comments).
- Wire our own postprocessor: `Audio2Frames` → per-genre
  `DBNBeatTrackingProcessor(min_bpm, max_bpm, fps=50)`. `File2Beats(dbn=)`
  exposes no range knob; do not fake it.
- Priors (config, not code): house 118–132 · techno 128–145 · trap
  130–155 (store double-time) · unknown 70–180 + flag-for-review.
- Genre from tags (archive DB has genres from the four-vote ladder); no
  classifier this pass. Wrong genre = wide range + more flags —
  recoverable.
- **Gate before adoption:** re-run the BPM re-gate harness (issue #18's
  reusable harness) on the dev-20. Adoption bar: ≥80% within 2% of RB, or
  beat the peak-picking number by ≥20% absolute on the same tracks. The
  12/24 and 16/24 history says beat_this's period can sit 2.2–2.6% off
  RB's; the DBN's constant-tempo prior is precisely aimed at that family
  — but it's measured, not assumed.
- Everything behind `MEGADJ_DBN=1`-style config; peak-picking stays the
  default until the gate passes.

### AC-01 — Structure labels (SongFormer primary, allin1 second)

- SongFormer: CC-BY-4.0 code/datasets; runs MuQ + MusicFM representations
  (check disk footprint under `~/.local/share/` caches before commit —
  roadmap risk #5, 460 GB disk). Verify MPS works or accept CPU speed on
  the M-series.
- allin1: already verified in the research notes (v3, pure-PyTorch
  NATTEN; MLX port claims ~12.6× — repo-reported, verify on 3 tracks).
- Output into a new `structure` ledger table: per-track segment arrays
  from both models + per-segment confidence. Same shape as the v2 plan's
  `TrackAnalysis.segments_*`.
- This is the roadmap's P2 item with its label-vocabulary risk stated:
  both models are pop-trained. Do NOT batch anything from labels until
  B3's gating says which outputs to trust.

### AC-02 — Bass/drums stems + per-bar energy

Demucs (`htdemucs`, MPS) → bass + drums stems → RMS per bar (bar math
from GA-01's fitted grid). Store `bass_rms_per_bar` in the same
`structure` row. Stems themselves stay temp-only (CDJs can't play them;
I48's note applies). ~3 s/track-class on M4 silicon per the roadmap; a
few hours for a 3–5k library. Resumable like every pass.

### Resumability (all passes)

Full-library analysis is an overnight job. Every pass caches by content
hash and is resumable from the start — a crash at track 1,400 of 2,000
costs nothing. The beats/cues ledgers already model this (idempotent
skip-without-`--force`); AC-01/02 copies the pattern. Device: try MPS
first (`device="mps"`); the current beat path runs `device="cpu"` —
benchmark both on 10 tracks before the full run and record the numbers in
this doc's execution log.

---

## Part A — Grid audit and repair

### GA-03 — Triage: sync problem or analysis problem

**STATUS: SHIPPED 2026-09-10** — `megadj rb-grid-triage [drive]
[--compare STICK] [--limit N]` reads the master DB via the python seam
(rows + `anlz_paths.py` hash dirs), optionally byte-compares each
track's collection sidecar against the stick's (`SYNC` issues get a
re-export, never a re-analysis), decodes the collection PQTZ grid
(`fulltags/src/anlz.ts`, spec-validated), and audits our fitted ledger
grids via `gridAuditFull` — SHIFT/PHASE/TEMPO/DRIFT/CHAOS + A-OK, worst-
first offender sample, read-only end to end. Gaps are visible classes
(`NO-ANLZ`, `NO-GRID`, `NO-LEDGER`), never silent skips. The ANLZ
hash-stability precondition stays GA-07 Q1.

Before anything expensive: a large share of "grids misaligned after
syncing" isn't a grid problem — the collection grid is correct and the
drive's ANLZ sidecar is stale.

```
drive_anlz_hash  vs  collection_anlz_hash
  differ    → SYNC issue. Re-export the playlist. Done.
  identical → grid is genuinely wrong. Continue to GA-04.
```

You'll have both; they need opposite fixes, and conflating them means
re-analyzing tracks that were fine. Build on `anlz_paths.py` (hash-path
computation) + the verify pipeline's ANLZ enumeration. Command shape:
`megadj grid-triage [drive] --json` (P1 contract).

**WEEK-1 TEST (do first):** does rekordbox write byte-identical ANLZ for
unchanged content across re-exports? Re-export one unchanged playlist,
hash the sidecars, compare. If yes, hashing works. If no, this step needs
structural comparison of decoded grids (crate-digger/rekordcrate specs
exist for parsing) — much bigger build. Find out before depending on it.

### GA-04 — Measure

Compare the (GA-01-fitted, GA-02-gated) Beat This! output against the
rekordbox grid decoded from the collection ANLZ. Per track:

| Metric       | Computation                                   | Meaning                               |
| ------------ | --------------------------------------------- | ------------------------------------- |
| Anchor delta | `rb_first_downbeat − bt_first_downbeat`, ms   | Fixed offset of the whole grid        |
| BPM ratio    | `rb_bpm / bpm_fitted`                         | 2.0 / 0.5 immediately visible         |
| Drift        | offset at last downbeat − offset at first, ms | The real grid-failure signal          |
| Phase        | anchor delta mod 1 beat, and mod 4 beats      | Downbeat on the wrong beat of the bar |
| Confidence   | mean beat activation (Audio2Frames)           | Low = weak evidence → route to manual |

Drift separates "shifted" from "broken": a constant 40 ms offset with
zero drift is trivial; a 5 ms offset growing to 300 ms by the outro is a
wrong BPM. This supersedes `gridCrossCheck`'s coarse ok/off/octave
verdict — that one stays as the cheap DB-level smoke check.

**STATUS: LEDGER-ONLY HALF SHIPPED 2026-09-10; ANLZ HALF SHIPPED SAME
DAY.** The `beats`-ledger cross-check runs `gridAudit` (fit + RB-clock
slide + wobble) and classifies TEMPO/DRIFT/CHAOS vs A-OK; the `drift`
bucket is live in the API, deckctl help, and both web cards. GA-03
added the ANLZ half: `gridAuditFull` (same module) decodes the
collection PQTZ grid and completes the plan's metric table — anchor
delta, phase (whole-beat offset + sub-beat residual), and the SHIFT and
PHASE buckets. Beat-confidence needs the activation array (AC-02's
Audio2Frames leg) and stays open. First live pass on
the archive (103 tracks): 99 DRIFT, 2 ok — RB stores integer BPMs (125)
against fitted 124.00 grids, ~1.6 s of accumulated slide: exactly the
predicted class.

Deliverable: `megadj grid-audit --json` — one row per track, cached,
resumable, feeding the CrateDeck surface (GA-05c).

### GA-05 — Bucket + thresholds + surface

| Bucket | Signature                                        | Fix                             | Automatable |
| ------ | ------------------------------------------------ | ------------------------------- | ----------- |
| A-OK   | \|anchor\| < 10 ms, \|drift\| < 15 ms, ratio ≈ 1 | None                            | —           |
| SHIFT  | \|anchor\| > 10 ms, drift small, ratio ≈ 1       | Anchor rewrite                  | Yes         |
| PHASE  | anchor ≈ ±1 or ±2 beats                          | Shift by beat count             | Yes         |
| TEMPO  | ratio ≈ 2.0 or 0.5                               | Fix range, targeted re-analysis | Semi        |
| DRIFT  | \|drift\| > 15 ms, monotonic                     | Multi-point grid or manual      | Semi        |
| CHAOS  | high drift, non-monotonic, low confidence        | Manual, or accept as unmixable  | No          |

The 10 ms / 15 ms numbers are **starting points, calibrated against the
dev-20 of the gold set** before anything writes. Calibration is a ticket
output (a table in this doc), not a vibe.

**Why not just re-analyze everything:** re-analysis runs the same
algorithm that erred, so it mostly rerolls the same result — and it
destroys every manual grid correction irreversibly. Reserve it for TEMPO,
after the range change, and only for tracks confirmed to have no manual
edits worth keeping.

- GA-05a: bucket engine (pure, tested like `phraseCues`).
- GA-05b: threshold calibration vs gold dev-20; record results here.
- GA-05c: CrateDeck surface — drive page gets a "grid health" card:
  VERDICT banner (two-thirds UX law), fix-first work queue worst-first
  with a Copy button carrying the exact `megadj` fix command per item,
  then raw detail. Census totals from `COUNT`, never from summing the
  displayed bucket list.

### GA-06 — Repair (writer) — blocked on GA-07's verdict

Back up first: full copy of the master DB directory + collection XML
export, timestamped, before any write. Grid data has no undo. (The shelf
hosts the master DB — the dated-backup discipline from the rekordbox
realities applies; quit rekordbox before DB edits, never write while it
runs.)

Per bucket:

- **SHIFT** — set anchor to Beat This!'s first downbeat, keep BPM. One
  element rewrite.
- **PHASE** — shift anchor by the exact detected beat count.
- **TEMPO** — change Preferences → Analysis → BPM range per GA-02's
  priors, re-analyze _only these tracks_ in rekordbox, verify the ratio
  resolved.
- **DRIFT** — write a multi-point grid using Beat This!'s downbeats as
  anchors, or flag manual. Phase-two feature.
- **CHAOS** — manual queue. Some tracks aren't gridable; legitimate.

Every repair re-checks **every** affected row/file afterwards — the
whole-table existence rule, not a prefix-scoped post-check (that trap
already cost two false "done" reports).

### GA-07 — WEEK-1 SPIKE: settle the write path

**STATUS: HARNESS + RUNBOOK SHIPPED 2026-09-10** — `megadj
rb-anlz-spike [drive] snapshot|compare --tag T` hashes every sidecar
with a per-section byte inventory (PQTZ/PWAV/PPTH/…) into a dated
baseline under `~/.local/state/megadj/spike/`, so each question below
becomes "run these two commands, do the rekordbox action, read the
diff". The step-by-step procedure — backup first, five sacrificial
tracks, all four questions, and the execution-log table to fill — lives
in `docs/runbooks/0d-write-path-spike.md`. The experiments themselves
are hands-on (rekordbox UI); "open but armed" until run.

This is the cheapest, most plan-invalidating experiment in the doc. Five
sacrificial tracks, a full backup, and four questions answered in order:

1. Re-export an unchanged playlist → are drive ANLZ byte-identical?
   (GA-03's foundation.)
2. Hand-nudge one track's grid in rekordbox (±1 beat) → exactly which
   files/fields change? (master.db? collection ANLZ? both? `Analysed`
   flag?) This maps the _true_ storage of grids.
3. Edit `TEMPO` in the collection XML → two-step import workaround → does
   the existing track's grid actually change, and does the collection
   ANLZ regenerate?
4. If (3) fails: direct ANLZ beatgrid edit on a sacrificial pair (rbox
   claims write support; rekordcrate/crate-digger have the format specs)
   → does the CDJ/rekordbox show the corrected grid?

Write the verdict into this doc §Execution log. GA-06 implements whichever
route passed; nothing in Part A repairs anything until then.

### GA-08 — Verify + rollout

Automated: re-run GA-04 on repaired tracks; confirm A-OK. Cheap —
analysis is cached, only the rekordbox side changed.

Manual: 10 repaired tracks across buckets onto a drive, checked on
hardware. Loop a phrase boundary and let it run 32 bars — errors under
15 ms are inaudible in isolation and obvious after a few bars of loop.

Rollout order:

1. Backup → 2. GA-03 triage (fixes a share via re-export at ~zero risk) →
2. GA-04 full scan, overnight → 4. GA-05 calibration → 5. Repair SHIFT +
   PHASE (highest volume, lowest risk) → 6. Repair TEMPO (range change +
   targeted re-analysis) → 7. DRIFT/CHAOS triaged or deferred → 8. Re-export
   every affected playlist to every drive → 9. Re-run GA-03 to confirm no
   drive is stale.

---

## Part B — Auto-cue for EDM/house

### B1 — Arithmetic for position, models for meaning

House is metrically rigid — fixed tempo, 4/4, phrases in strict multiples
of 8, structure almost always on 16/32. Rigidity means arithmetic beats
machine learning for _placement_:

```
bar(t) = round( (t − anchor) / (4 × 60 / bpm_fitted) )
```

Every candidate cue lands on an integer bar that's a multiple of 8. A
boundary at bar 63.4 becomes bar 64. A boundary that doesn't snap within
a bar of an 8-multiple is a red flag on either the boundary or the grid —
surface it, don't silently round. The models' job is only "which of these
already-known boundaries is the drop."

Genre priors (accuracy ladder #5): house intros are 16 or 32 bars; drop 1
usually lands at bar 64 or 96 — weight candidates accordingly.

### AC-03 — Drop detection by bass energy

Not the model's `chorus` label — pop vocabulary wearing a costume.

1. Demucs-separate (AC-02's stems); take bass + drums
2. RMS per bar across the track
3. Normalize; find bars where energy jumps sharply after a sustained
   low-energy region
4. **Drop 1** = the global bass-energy maximum that follows a break,
   subject to bar ≥ 32
5. **Break** = sustained region below ~40% of median bass energy, ≥8 bars
6. **Build** = the 8–16 bars immediately before a drop where high-band
   energy rises monotonically (snares, risers) — this produces the `BUILD`
   label neither model's vocabulary contains

SongFormer _confirms_: bass energy says drop at bar 96 and SongFormer
says `chorus` starts at bar 96 → high-confidence accept.

### AC-04 — Agreement gating

Run SongFormer + allin1; compare boundaries; add the bass signal.

| Condition                                     | Action                                            |
| --------------------------------------------- | ------------------------------------------------- |
| Both agree within 1 bar, bass energy confirms | **Auto-accept**, full labels                      |
| Two of three agree                            | Accept with a review flag                         |
| All disagree                                  | Fall back to phrase-only cues, no semantic labels |

This is how the reliable-accept rate gets above 80%. It doesn't make the
models better — it makes the system honest about which outputs to trust,
which is what protects you mid-set.

### B4 — Label mapping

Both models emit Harmonix vocabulary: `intro, outro, break, bridge, inst,
solo, verse, chorus`. Map it:

| Model label        | House meaning          | Cue label |
| ------------------ | ---------------------- | --------- |
| intro              | DJ intro, beats only   | `IN`      |
| verse              | groove, reduced energy | `GROOVE`  |
| chorus             | the drop               | `DROP`    |
| break              | breakdown, drums out   | `BRK`     |
| bridge             | second breakdown       | `BRIDGE`  |
| inst / solo        | instrumental groove    | `GROOVE`  |
| outro              | DJ outro               | `OUT`     |
| _(derived, AC-03)_ | pre-drop tension       | `BUILD`   |

Short, uppercase — CDJ displays truncate and you read at arm's length in
the dark.

### AC-05 — Cue layout + writer

House layout:

| Cue | Position              | Label    | Color  | Purpose                           |
| --- | --------------------- | -------- | ------ | --------------------------------- |
| A   | First downbeat        | `IN`     | Green  | Mix-in. Most-used cue on the deck |
| B   | Intro → body boundary | `BODY`   | Blue   | Full elements enter               |
| C   | First breakdown       | `BRK 1`  | Blue   | Breakdown mix-in target           |
| D   | Build start           | `BUILD`  | Orange | Tension entry                     |
| E   | Drop 1 downbeat       | `DROP 1` | Red    | The money cue                     |
| F   | Second breakdown      | `BRK 2`  | Blue   | —                                 |
| G   | Drop 2 downbeat       | `DROP 2` | Red    | —                                 |
| H   | Outro start           | `OUT`    | Green  | Mix-out                           |

Colors carry meaning: green = transition, blue = low energy, orange =
tension, red = impact. You read color before text in a dark booth.

**Memory cues** on every 32-bar phrase boundary plus all eight hot-cue
positions (the `cues` ledger already computes the 8-bar phrase spine —
extend to 32 for memory markers or keep 8-bar and render every 4th).
**STATUS: spine SHIPPED 2026-09-10** — `phraseCues` now flags
`memory: true` on bars 1/33/65… in the same array (source bumped to
`phrase-cues@2`; re-derive with `megadj cues --force`).

**Fallback:** when AC-04 gating fails, write cue A + memory cues every 32
bars, no semantic labels. Honest phrase markers beat confidently wrong
drop labels.

Trap/rap variant:

- Phrases are 8 bars, structure at 16 — snap accordingly.
- **Half-time is the main hazard.** A 2× disagreement between analyzers
  is the half-time feel, not an error — pick one convention library-wide
  (double-time, see §0.3.7) or BPM sorting breaks.
- Labels: `verse` → `VERSE`, `chorus` → `HOOK`.
- Layout: A `IN`, B `HOOK 1`, C `VERSE 1`, D `HOOK 2`, E `VERSE 2`,
  F `HOOK 3`, G `BRIDGE`, H `OUT`.
- Bass-energy detection works less well (sparse programming, ambiguous
  downbeats) — weight the review queue heavier, expect lower auto-accept.

Writer (AC-05):

- Route: XML `POSITION_MARK` (Start seconds, `Num` 0–7 hot / −1 memory,
  `Red/Green/Blue`), imported via the two-step collection-import
  workaround — **contingent on GA-07 step 3 proving cue import works on
  existing tracks.** DB fallback (`djmdCue` INSERT with InMsec/InFrame +
  palette Color ID) only if XML fails the spike; VBR/ABR MP3s are the
  known-hard case there.
- `Num="-1"` memory cues are unlimited; hot cues 0–7 map to A–H.
- Per track: grid must be bucket A-OK (skip + log otherwise) → compute
  bars from corrected anchor + `bpm_fitted` → snap to 8-bar multiples
  (flag misses) → AC-04 gate → layout → write → validate (AC-06) →
  import.
- **Never overwrite existing cues without an explicit flag.**
  Hand-cued tracks are more valuable than anything generated. Default
  write-only-if-empty; `--force` for tracks you're sure about. The
  pre-write check reads existing cues from the collection DB first.
- Interlock + backup rules inherited from rb-fix-paths: refuse while
  rekordbox runs; dated backup before apply; whole-set post-check.

### AC-06 — Validation gate

- Every hot cue within 15 ms of a beat
- Every hot cue on a bar line, not just a beat
- Cue A within 100 ms of the grid anchor
- Times monotonically increasing, no duplicates
- No cue past track duration
- Drop cues at bar ≥ 32 — a drop at bar 8 is a detection failure
- Labels from the fixed vocabulary, no raw model output

Fail any check → review queue, don't write. Enforced in code
(`fulltags`-style gate), reported in `--json`.

### AC-06b — Hardware verification

Automated checks confirm arithmetic, not musicality. Before scaling:
20 tracks — 12 house, 5 trap, 3 deliberately weird — onto one drive.
Load each, hit every hot cue, confirm it drops where you'd have put it.
Then mix two for a minute. Bad automated cues are worse than no cues —
you'll trust them mid-set.

### AC-07 — Feedback loop

Log every manual cue correction as a delta (what moved, how far, which
bucket it came from) into a `cue_feedback` ledger. Over a few weeks
that's a dataset of your actual preferences — drop on the downbeat or
one bar early, build at 16 or 32. Feed the averages back into the
offsets. This is what turns a generic tool into yours, and the reason
building beats buying.

---

## The accuracy ladder (re-ticketed)

| #   | Change                              | Expected gain                                | Effort                          | Ticket        |
| --- | ----------------------------------- | -------------------------------------------- | ------------------------------- | ------------- |
| 1   | Constant-tempo constraint for house | Large — removes most drift before models run | S                               | GA-01         |
| 2   | Bass-energy drop detection          | Large on drop precision                      | M                               | AC-03         |
| 3   | Agreement gating between two models | Large on _reliable_-accept rate              | M                               | AC-04         |
| 4   | Narrow DBN tempo range per genre    | Moderate — kills ratio errors at source      | M (no native knob — see §0.3.2) | GA-02         |
| 5   | Genre priors on structure position  | Moderate on phrase alignment                 | S                               | B1 (in AC-03) |
| 6   | Feedback loop on manual corrections | Compounds over weeks                         | M                               | AC-07         |

1 ships in the first pass. 2 and 3 move cue acceptance past 80%. 6 keeps
it there as taste shifts.

## Sequencing

| Stage            | Ticket(s)                  | Depends on             | Output                                                     |
| ---------------- | -------------------------- | ---------------------- | ---------------------------------------------------------- |
| Gold standard    | GA-00, GA-00b              | —                      | 30 annotated tracks, dev/holdout split, `gold-report`      |
| Write-path spike | GA-07                      | backup only            | The §0.3.4 verdict — decides GA-06                         |
| Analysis pass    | GA-01, GA-02, AC-01, AC-02 | GA-00                  | Fitted grids, gated beats, segments, stems, per-bar energy |
| Triage           | GA-03                      | GA-07 Q1               | Sync-vs-analysis split                                     |
| Scan             | GA-04                      | S                      | Five metrics per track                                     |
| Bucket + surface | GA-05                      | GA-04 + calibration    | Repair worklist + CrateDeck card                           |
| Repair           | GA-06, GA-08               | GA-05 + GA-07          | Corrected grids, verified                                  |
| Cue policy       | AC-03, AC-04               | A-verify               | Per-genre cue spec                                         |
| Cue write        | AC-05                      | AC-03/04 + GA-07 Q3/Q4 | Cues in XML/DB                                             |
| Gate + hardware  | AC-06, AC-06b              | AC-05                  | Validated, hardware-checked cues                           |
| Feedback         | AC-07                      | weeks of use           | Tuned offsets                                              |

**Three things that determine whether this works:** the gold standard
existing at all; ANLZ hash stability (GA-07 Q1 — GA-03 depends entirely
on it); bucket thresholds calibrated against real ears.

**The one thing to resist:** running a full library re-analysis in
rekordbox because it's the fast obvious move. It destroys manual edits,
it's irreversible, and it fixes less than you'd think.

## vs Mixed In Key — honest framing

MIK publishes no accuracy figures and is closed source; there's no
benchmark. Structurally — **where this should win:** current-SOTA beat
tracking vs an older engine; your cue conventions vs a fixed generic
layout; genre branching; a validation gate that refuses to write bad
output. **Where MIK wins today:** zero setup, and battle-tested key
detection — that half is already neutralized (OpenKeyScan shipped,
gate-passed 80.7%). **The real edge:** the feedback loop. MIK can't learn
that you cue drops one bar early. This can.

## Research base (verified 2026-09-10)

| Claim                                                                                                                                                                                                               | Verdict                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| beat_this MIT; `--dbn` needs CPJKU madmom fork; madmom models CC BY-NC-SA; DBN params are madmom defaults (55–215, 3/4+4/4)                                                                                         | Verified (CPJKU README + madmom PyPI)                                                                                           |
| `File2Beats(dbn=True)` exposes no tempo-range parameter                                                                                                                                                             | Verified — custom DBN wiring required for GA-02                                                                                 |
| SongFormer: ASLP-lab; SongFormBench-HX ACC 0.891 / HR.5F 0.690 (best row); allin1 baseline 0.834/0.563; Gemini 2.5 Pro 0.806/0.412                                                                                  | Verified (repo README table) — v2's "0.703/0.807" was wrong                                                                     |
| SongFormer license: code + datasets CC-BY-4.0 (GitHub API shows "Other"; README + HF state CC-BY-4.0)                                                                                                               | Verified; re-check model-card weights license at install                                                                        |
| rekordbox XML: `TEMPO` (Inizio/Bpm/Metro/Battito, multi-segment) + `POSITION_MARK` (Name/Type/Start/End/Num, RGB attrs; hot 0–7, memory −1)                                                                         | Verified (Pioneer XML spec via pyrekordbox docs + rekordcrate)                                                                  |
| XML reimport bug: existing tracks NOT updated on import; two-step "Import to Collection" workaround (RB 5.6.1 → 7)                                                                                                  | Verified (community-documented); whether TEMPO overwrites an analyzed grid + regenerates collection ANLZ = GA-07 Q3, unverified |
| Rekordbox 6/7 grids live in ANLZ sidecars (`ANLZ*.DAT/.EXT/.2EX`), referenced by `djmdContent.AnalysisDataPath`; master.db `djmdCue` stores cues (InMsec/InFrame 1/150 s; VBR/ABR extra fields; Color = palette ID) | Verified (pyrekordbox docs)                                                                                                     |
| pyrekordbox: ANLZ read yes, write "planned not implemented"; DjmdCue add/delete not in the supported-tables list                                                                                                    | Verified — rbox (PyPI) claims ANLZ read+write; test on sacrificial pair in GA-07 Q4                                             |
| allin1 v3 Apple Silicon (pure-PyTorch NATTEN); MLX port ~12.6× (repo-reported)                                                                                                                                      | Already in research notes; verify speed claim on 3 tracks                                                                       |
| Demucs htdemucs on MPS                                                                                                                                                                                              | Repo-adjacent (demucs-mlx precedent); measure on 3 tracks in AC-02                                                              |

## Execution log

_Append dated entries as stages land — gate numbers, spike verdicts,
calibration tables. Nothing here is done until it has a dated row._

- 2026-09-10 — plan written (v3); audit vs repo done; old perf plan moved
  to docs/perf-plan.md.
