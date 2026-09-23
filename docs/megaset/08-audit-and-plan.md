# MegaSet — Full Audit, Comparison & Improvement Plan

**Status:** 📚 REFERENCE — implementation audit and design sketches. The active roadmap is the
[30-comparator analysis](03-competitive-analysis.md) (10 OSS + 10 commercial +
10 dream ideas, with the re-ranked roadmap); sequencing-algorithm claims are now
**measured** in [04-sequencing-benchmarks (archived)](../archive/set-04-sequencing-benchmarks-2026-09-14.md)
(E1–E8: greedy's 59% sparse-pool loss, 2-opt's +0.0% at scale, the beam-under-250 rule,
weights frozen as engine constants); the embedding-tower question is measured in
[embedding-models.md](../fulltags/embedding-models.md) (v2 rerun: effnet
confirmed primary on both metrics; second-tower/fusion sweep settled — best ensemble +1.1 pt, not adopted).
**Plan of record = the re-ranked roadmap** (03 §5); Part 3 below preserves the per-item
implementation sketches, delta-pinned against the measured verdicts. The identifier
rename (`setbuild` → `megaset`) EXECUTED 2026-09-15 evening — receipt in
[09-migration-plan (archived)](../archive/set-09-migration-plan-2026-09-15.md); dated
scope blocks below name the old `setbuild.*` paths as they were when written.

> **2026-09-16 — Phase A shipped:** B2/B3/B7/B9 landed in #105; B1+B13 landed in
> [#104](https://github.com/webuildstuffio/megadj/issues/104) (metadata-only
> admission gate = measured tempo, not an `availability` flag; `excluded_groups`
> derived engine-side by the shared `groupMegasetExcluded`). B11 shipped earlier
> as `MEGASET_EXCLUDED_PREVIEW_MAX`. B12's `pool_hint` is superseded: with B1,
> an offline shelf builds a chain and the payload/UI say "mirror-metadata
> draft" instead. Verified live: shelf asleep → 200/200 limited rows admitted
> metadata-only, 7-track chain built, honest plan-not-playlist note.
>
> **2026-09-16 — Phase D item 16 shipped (#106):** steps carry
> `mixInCue`/`mixOutCue` — the 8-bar boundary nearest the 45 s intro/outro
> handoff targets (`MEGASET_HANDOFF_INTRO_S`/`MEGASET_HANDOFF_OVERLAP_S`),
> derived by the shared pure helpers (`nearestMegasetCue`/`megasetMixInCue`/
> `megasetMixOutCue`) from the cues-ledger join; tie-break = earlier bar.
> Rendered as `#EXTREM` comments in the M3U8 export, per-step `cueWindows`
> rows in the rb-playlist dry-run, and hover-card lines in the arc chart.
> Null pair when a track has no cue row — absence is honest, never invented
> bars. Planning, not playback: propose-only stands (items 17–18 partially
> land with this — the dry-run shows the windows, not yet the full
> `{keyScore, tempoScore, fit, phrasePair}` math).

> Glossary: [10-findings §5](10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

_2026-09-13. Scope: `src/deck/setbuild.ts` (engine), `src/deck/megaset/similar.ts`
(candidate pool), `src/deck/shared/setbuild.ts` + `shared/camelot.ts` (wire SSOTs),
`src/fulltags/setbuild.ts` (CLI), `src/deck/report/tools.ts` (MCP), `src/deck/api/routes-archive.ts`
(HTTP + M3U8), `web/products/fulltags/SimilarTab.tsx` (UI), `src/rekordbox/rb-playlist.ts`
(master-DB write-off). Product home: [01-prd.md](01-prd.md).
Companion to [fulltags/fulltags-roadmap.md](../fulltags/fulltags-roadmap.md) and
[docs/PRINCIPLES.md](../PRINCIPLES.md) (propose-only is a feature, not a gap).

---

## Part 1 — Current state (measured 2026-09-13)

### 1.1 Live numbers

| Measure                        | Value                                                             |
| ------------------------------ | ----------------------------------------------------------------- |
| Downloaded rows                | 3,664 (full-shelf mirror landed Sep 12)                           |
| Beats ledger                   | 3,610 · Mood 3,659 · Cues 3,605 · Embeddings 3,618                |
| `track_keys` cache             | 534 (healed Sep 12; rest served by rekordbox mirror / live reads) |
| Rekordbox mirror rows          | 3,563 (BPM ×100 + KeyName JSON)                                   |
| Fully analyzed (beats+mood)    | 3,602                                                             |
| Distinct genres (case-folded)  | 440 — badly fragmented (`House`/`house` both present)             |
| Engine speed @3,600 candidates | **6 ms** (pure, 60-min peak build)                                |
| Live endpoint                  | ~0.4 s warm; pool 515 on the pre-mirror census                    |

### 1.2 What the engine does today

Greedy next-track selection: `0.45·tempo + 0.3·key + 0.25·energy-fit`, hard gates
tempo ≠0 outside ±6% and key =0 on clashes. Opener anchored by tempo-neighborhood
count (≥15 within ±6%) then arousal-distance to the arc start. Deterministic
tie-breaks (score, then `videoId`). Whole-track budget fill; honest `excluded[]`
list capped at 40 with `excluded_total`. Freshness line for beats/mood ages.
Surfaces: CLI / HTTP(+M3U8 export) / MCP `megaset_propose` / web panel — one
shared parse (`parseMegasetQuery`), one preset registry, one Camelot SSOT
(all-24-key pinned tests), one clamp table.

### 1.3 Bugs & defects found this audit (ranked)

| #   | Severity     | Finding                                                                                                                                                                                                                                                    | Evidence                               |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| B1  | **HIGH**     | **Drive-offline pool collapse.** 3,656/3,664 rows report `missing_files` when SHELF1 is unmounted → pool 8, 3-step sets. The rekordbox mirror (3,563 rows, BPM+key) could score offline, but `setCandidates` hard-filters on file existence.               | live probe during audit (drive asleep) |
| B2  | **HIGH**     | **Unbounded tempo drift.** A ±6%-per-step greedy chain compounds: measured 100 → 187.9 BPM (1.88×) in one 12-step climb. No global tempo anchor or drift budget; a "warm-up" can wander two genres away.                                                   | probe: tempo ladder test               |
| B3  | **MED**      | **Arc shape uncontrolled mid-set.** Peak measured `6,7,7,6` — rises then falls before the end; nothing enforces monotone approach/hold/peak placement. The envelope is sampled at slot `t` but nothing prevents local reversals when energy-fit ties.      | probe: arc test                        |
| B4  | **MED**      | **`valence` is dead data.** Stored, transmitted, never scored. Either use it (mood-lift bonus / darker-arc presets) or drop from the candidate wire to save payload.                                                                                       | engine read                            |
| B5  | **MED**      | **Greedy myopia.** Each slot takes the locally best track; a high-scoring next step can strand the chain (documented probe: picking `b` leaves no successors while `c→d` continues). No lookahead/backtracking.                                            | probe: dead-end test                   |
| B6  | **LOW-MED**  | **No artist/diversity guard.** Nothing prevents 3 tracks by one artist back-to-back beyond coincidence; no genre-família spread either (440 raw genres make bucketing unavailable today).                                                                  | engine read                            |
| B7  | **LOW**      | **`parseSetbuildQuery("abc")` silently defaults minutes** (the parse is today's `parseMegasetQuery`). Unknown preset errors (correct) but non-numeric minutes falls back to 60 with no signal. Minor honesty gap vs the "never silent fallback" principle. | probe                                  |
| B8  | **LOW**      | **Half/double-time BPM not honored.** 87 vs 174 DnB scores 0 today; every serious comparator (djkr8, mixmaster, digcrate, auto-dj-ai) treats 2×/½× as mixable. Currently the pool is house/techno-centric so impact is latent.                             | probe                                  |
| B9  | **COSMETIC** | `OPENNER_MIN_NEIGHBORS` typo (opener). `duplicate_files` naming vs `duplicateFiles` internal. `key_reads` counts probes, not reads, in some paths.                                                                                                         | code                                   |
| B10 | **NOTE**     | **M3U8 export writes `#EXTINF` lines only from steps** — fine for players, but lacks the per-transition scores that rb-playlist dry-run prints; the two exports tell slightly different stories.                                                           | route read                             |
| B11 | **NOTE**     | `excluded` slice(0,40) is duplicated in route + MCP with the same magic number — should be a shared constant next to `SET_POOL_*`.                                                                                                                         | route/tools                            |

Non-bugs (verified healthy): determinism (identical chains on repeat runs), O(n log n)
opener guard, budget double-count fix, NFC/casefold dedupe, relocation honesty counters,
freshness surfacing, preset-validation error path, all-24-key Camelot pins.

---

## Part 2 — The 10 open-source comparators (condensed)

> Deep comparison against commercial products (DJ.Studio, Mixed In Key, Djoid,
> SetFlow, Lexicon, rekordbox/Serato/VirtualDJ/Engine DJ, MixMeister) and 10
> dream/concept ideas now lives in
> [30-comparator analysis](03-competitive-analysis.md),
> together with the **re-ranked roadmap** that supersedes this doc's phase
> ordering where they disagree. Full prose for each comparator below lives in
> this section's git history (research pass 2026-09-13; stars/activity checked
> then).

Selection: closest functional neighbors across the feature space (sequencing
algorithms, energy arcs, analysis, surfaces, write-off targets). All are
small/hobby projects (0–9 stars) except Mixxx (reference implementation,
not a set _planner_ — included for its AutoDJ contract).

### 2.1–2.10 One verdict each

| #    | Comparator                                                                | What it is                                                                                                         | The lesson we took                                                                                                            |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | [djkr8](https://github.com/schoi80/djkr8) ⭐9 MIT                         | CP-SAT `AddCircuit` solver reading RB 6/7 via pyrekordbox; energy-flow constraint, half/double-time, XML/DB export | The rigor ceiling. Gap vs us: no own analysis, coarse 1–5 energy                                                              |
| 2.2  | [harmonic-flow](https://github.com/roneni/harmonic-flow) ⭐1              | Held-Karp exact DP ≤20 + greedy/2-opt reordering of an uploaded playlist; quality score + per-transition analysis  | The **2-opt pass** is cheap and would fix B5 myopia without a solver                                                          |
| 2.3  | [spotify-mixmaster](https://github.com/gnujoow/spotify-mixmaster) ⭐2 MIT | Beam search over Camelot moves, YAML energy curves, genre buckets, per-run seed                                    | Beam breadth (B5), **landmark seeds**, **quality floor**, **N-candidates**                                                    |
| 2.4  | [mcp-dj](https://github.com/darav-t/mcp-dj) ⭐4                           | MCP server + FastAPI over local RB; 5 arc profiles, MyTag filtering, NL requests with explainable reasoning        | Closest philosophical twin; confirms MCP-first and `explain` payloads. Gap: coarse energy, no embeddings, no phrase awareness |
| 2.5  | [digcrate](https://github.com/fungiblemoose/digcrate) ⭐1 MIT             | librosa-local analysis + LLM planning (audio never leaves); key 40/BPM 35/energy 25 weights; gap finding           | **Bridge-track suggestion** for the excluded list; explicit weights; honest local split                                       |
| 2.6  | [open-crate](https://github.com/raullee/open-crate) ⭐0 MIT               | TS crate with a `SetGenerator` strategy interface; lock/swap/regenerate UX                                         | **Lock-and-regenerate** — the missing middle between proposal and hand-building; `adventurous` as scoring temperature         |
| 2.7  | [pulsegrid](https://github.com/ysy-ym/pulsegrid) ⭐1 MIT                  | Plans per-pair Cue 8 → Cue 5 handoff points + transition automation, preview + audit before Auto Play              | Our cues ledger is unused by setbuild — pairing planned **transition points**, not just order, is the proven differentiator   |
| 2.8  | [cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) ⭐0    | Routes structural evidence to 11 guarded transition recipes; **fails closed**; decision logs                       | Recipe taxonomy + fail-closed gating — the shape our write-gates want if handoffs ever automate                               |
| 2.9  | [auto-dj-ai](https://github.com/caffettino87/auto-dj-ai) ⭐1 MIT          | Essentia+Demucs analysis, real dual-deck mixing, −16 LUFS, anti-vocal-clash scoring                                | **LUFS and vocal-occupancy as first-class inputs** — both derivable (ffmpeg `ebur128`, Demucs)                                |
| 2.10 | [mixxx](https://github.com/mixxxdj/mixxx)                                 | Not a planner — AutoDJ defines the playlist-consumer contract (fade modes, prerolled transitions)                  | Our M3U8/rb-playlist exports should carry intro/outro cue windows so any consumer can execute the handoff                     |

### 2.11 Feature matrix

| Capability           | megadj setbuild        | djkr8            | HarmonySet          | mixmaster         | mcp-dj          | digcrate     | open-crate       | pulsegrid | cuefield       | auto-dj-ai         | Mixxx          |
| -------------------- | ---------------------- | ---------------- | ------------------- | ----------------- | --------------- | ------------ | ---------------- | --------- | -------------- | ------------------ | -------------- |
| Own audio analysis   | ✅ effnet+ffprobe      | — (RB)           | —                   | — (APIs)          | ✅ Essentia     | ✅ librosa   | —                | ✅        | ✅             | ✅ Essentia/Demucs | ✅             |
| Key data             | ✅ TKEY+RB mirror      | RB               | upload              | API               | RB+Essentia+MIK | librosa      | import           | own       | own            | Essentia           | RB/analyzed    |
| Camelot scoring      | ✅                     | ✅ 3 levels      | ✅ circle-of-5ths   | ✅ directional    | ✅              | ✅ 40%       | ✅               | ✅        | ✅             | ✅                 | n/a            |
| Half/double BPM      | ❌ B8                  | ✅               | —                   | ✅                | —               | ✅           | —                | ✅        | ✅ 2×/½×       | ✅ octaves         | ✅             |
| Energy arc           | ✅ 3 presets           | ✅ constraint    | ✅ 3 modes          | ✅ YAML curves    | ✅ 5 profiles   | ✅ 25% term  | ✅ arc           | ✅        | ✅ windows     | ✅ RMS curve       | ❌             |
| Sequencer power      | greedy                 | **CP-SAT**       | **Held-Karp+2-opt** | **beam**          | greedy          | LLM+validate | greedy swappable | planner   | recipe router  | score pick         | queue          |
| Lookahead/repair     | ❌ B5                  | ✅ global        | ✅ 2-opt            | ✅ beam           | ❌              | —            | ❌               | —         | —              | —                  | —              |
| Landmark/seed tracks | opener only            | —                | —                   | ✅                | —               | —            | ✅ lock          | ✅ cues   | —              | —                  | queue          |
| N-candidates compare | ❌                     | —                | ✅ before/after     | ✅                | —               | —            | ✅ regenerate    | —         | —              | —                  | —              |
| Diversity guard      | ❌ B6                  | energy only      | —                   | genre buckets     | MyTags          | —            | —                | sections  | structure      | vocal clash        | —              |
| Phrase/cue awareness | ❌ (data exists!)      | —                | —                   | —                 | —               | —            | —                | ✅✅      | ✅✅           | ✅ phrase grid     | ✅ intro/outro |
| LUFS / vocal checks  | ❌                     | —                | —                   | —                 | —               | —            | —                | —         | ✅ fail-closed | ✅✅               | ✅             |
| Explain payload      | partial (counters)     | ✅ scores        | ✅ per-transition   | ✅ transition log | ✅✅ NL explain | ✅ gaps      | ✅ honest engine | ✅ audit  | ✅✅ evidence  | ✅                 | —              |
| Write-off to RB      | ✅ rb-playlist (gated) | ✅ XML/DB        | ❌ CSV              | ✅ Spotify        | ✅ playlist     | ✅ XML       | ❌               | ❌ player | ❌ player      | ❌                 | player         |
| MCP surface          | ✅                     | —                | —                   | agent-ready CLI   | ✅✅            | —            | —                | —         | —              | —                  | —              |
| Determinism          | ✅                     | solver (seeded?) | —                   | ✅ seed           | —               | —            | ✅               | —         | —              | —                  | —              |

---

## Part 3 — Improvement plan (phased, house-style)

> **Delta-pin (2026-09-14, post-benchmarks).** Part 3 predates E1–E8 and the
> [embedding v2 rerun](../fulltags/embedding-models.md). Where they disagree,
> the [re-ranked roadmap](03-competitive-analysis.md) + benchmark
> verdicts win:
>
> - **A7 (B4 valence) is demoted** — mood-ledger triage (04 §5.1) measured
>   valence stdev 0.12 (near-flat); it cannot order transitions. The fit-axis
>   slot goes to **percentile-normalized `aggressive` + `happy`** — the only
>   raw heads with real spread. `valence` stays stored (VGGish VA recompute),
>   just never scored.
> - **C12 (2-opt) repositioned** — measured +0.0% at archive scale (04 E3);
>   ship as free polish. The real sparse-pool fix is **beam-B=8 when
>   pool < ~250** (E7 validated: 2.9→4.5 chain length at n=12, 0 ms cost).
> - **E6 froze the weights** — 0.45/0.3/0.25 stay engine constants; never a
>   user parameter (weight sensitivity moved mean transition only 0.989–0.9945).
> - **B10p embedding prior: effnet-only.** The v2 rerun (n=180, 0 fails)
>   confirmed effnet leads on both LOO family agreement (0.444 vs 0.300
>   musicnn) and retrieval coherence (0.362 vs 0.292). No second tower in
>   the scoring path; the fusion/variant sweep is **settled — not
>   adopted** (+1.1 pt, below the bar); the gate and verdict live in
>   [embedding-models.md](../fulltags/embedding-models.md).
>
> Everything below is otherwise current: A-first ordering, B/C/D scoping,
> non-goals, and the per-item sketches.

Guiding rules: propose-only stays; every phase ships with tests + parity rows; no new
runtime deps without the release-age floor; algorithms stay pure functions in
`src/deck/setbuild.ts`; SSOT tables live in `shared/`.

### Phase A — Bug fixes (no new features) · 🔨 FIRST

1. **B1 offline pool:** `setCandidates` gains `availability: "files" | "metadata"` —
   when files are absent but the rekordbox mirror covers a row (BPM+key present), admit it
   as a **metadata-only candidate** with a visible `metadata_only` count in the payload and
   an honest freshness/staleness line ("proposing from mirror metadata; shelf asleep").
   Keys/BPM from mirror, durations fall back to 300 s. Drives nothing.
2. **B2 tempo anchor:** opener pick sets `anchorBpm`; `transitionScore` gains a soft
   `tempoDrift` term — distance of candidate BPM from the _arc-local target_ (anchor
   lerped toward `preset.tempoTarget ?? anchor`), not just from `prev`. Hard drift budget:
   reject chains whose total drift exceeds ±2 half-steps of the anchor unless every step
   is a 2×/½× relation. Regression: ladder test pins max drift.
3. **B3 arc control:** enforce monotone-in-segments arousal: split [start,end] envelope
   into thirds (approach/hold/land for peak; steady descent for afterhours); a candidate
   may not move the chain's arousal opposite its segment's direction by more than ε.
   Regression: peak chain's last slot ≥ second slot; afterhours strictly non-increasing
   beyond ε.
4. **B7 minutes validation:** `parseSetbuildQuery` (today `parseMegasetQuery`) returns `{error}` for non-numeric
   minutes (route → 400, MCP → RpcParamError, CLI → exit 2). "absent" stays default-60.
5. **B11:** `MEGASET_EXCLUDED_PREVIEW_MAX = 40` into `shared/megaset.ts` (then-named `SET_EXCLUDED_PREVIEW_MAX` in `shared/setbuild.ts`); both surfaces import.
6. **B9:** rename constant to `OPENER_MIN_NEIGHBORS`; docs pass on payload field names.

**Added during PRD pass (Sep 13):**

7. **B12 empty-pool UX:** the audit's live probe hit the worst case — pool 8, 3 steps,
   "complete: false" with no human hint. When `pool` < a floor (say 10), the payload/UI
   gains a `pool_hint` ("only 8 playable candidates — is the shelf mounted? FullTags
   mirror covers 3,563 rows; run the RB mirror adoption") instead of a bare shortfall.
   (Superseded Sep 16 by B1: an offline shelf now builds a chain from mirror metadata
   and the payload says so — see the Phase A receipt in the header.)
8. **B13 excluded-reason consolidation:** the excluded list at 3,600-scale repeats the
   same 3 reasons ~3,585 times; the payload should group by reason with representative
   videoIds (`excluded_groups`), keeping the flat list for the 40-preview.

### Phase B — Scoring depth (uses data we already have) · 🧭

7. **B4 valence:** score it. `fit` becomes 3-axis distance (arousal, dance, valence with
   the preset gaining `valence: [start,end]`); afterhours gets a dark-valence envelope —
   the mood ledger's second axis finally earns its payload bytes.
8. **B8 half/double-time:** `bpmScore(a,b)` also evaluates `b/2`, `b*2`, `b*(3/2)`
   (1.5× for halftime-feel genres) with a small penalty (0.9×) vs direct match. Gated by a
   genre-family check once B6 lands (not every library wants 87↔174).
9. **B6 diversity:** genre families via the existing `genreFamily()` SSOT (first
   case-fold the 440 genres — one-time `megadj genre --refold` pass); soft penalty on
   same-artist back-to-back and same-family runs >3; exposes `diversity` counters.
10. **Embeddings into the pool:** cosine kNN (existing `similarTracks` math) as a
    similarity prior between consecutive tracks (bonus 0–0.1 term, tunable) — "sounds
    like" is measured data we already store for 3,618 tracks.
11. **LUFS (analysis phase, cheap):** a `loudness` pass writing `lufs` to the beats
    ledger row via ffmpeg `ebur128` (local, fast); scoring trims extremes (nothing mixes
    well across a 12-LU gap). Optional, off by default, like genre. Now tracked as
    [#172](https://github.com/webuildstuffio/megadj/issues/172).

### Phase C — Sequencing power (algorithms) · 🧭

12. **Lookahead repair (2-opt):** after the greedy chain, one 2-opt pass (reverse any
    segment if total transition score improves, ≤N iterations, deterministic order) —
    HarmonySet's proof this is cheap; kills most B5 dead-ends with zero deps.
13. **Landmark tracks:** `--track <id>` (repeatable) = must-include, sequenced at their
    arc-appropriate positions with the rest built around them (mixmaster's draft workflow).
    Opener stays as the special case it is.
14. **N-proposals compare:** `--candidates N` (CLI/MCP/web "Build 3 options") running the
    deterministic engine with seeded pool shuffles + different anchors; each result keeps
    its own quality summary (mean transition score); UI shows tabs.
15. **Quality score:** a single 0–100 set-quality summary (mean transition + arc
    adherence + diversity + budget fit), so "Build 3" has something to rank by. Deterministic.

### Phase D — The handoff layer (our differentiator) · 🧭 THE bet

16. **Phrase-aware transition points:** we hold 3,605 tracks × ~17-20 8-bar cues +
    downbeat grids — richer than anything in the comparison set except PulseGrid/cuefield.
    Extend `SetBuildStep` with `mixOutCue`/`mixInCue` (8-bar boundary nearest the arc's
    target overlap window) and print them in M3U8 (`#EXTREM` comments) + rb-playlist
    dry-run. This is planning, not playback — propose-only stands.
17. **rb-playlist dry-run explain:** adopt cuefield's evidence shape — per-step
    `{keyScore, tempoScore, fit, phrasePair}` rows so the dry run _shows the math_.
18. **Consumer contract:** M3U8 comments carry `#EXTGENRE`-style intro/outro windows
    (Mixxx AutoDJ fade-mode semantics) so the export is executable, not just a list.

### Sequencing & estimates

| Phase | Ships                                           | Size              |
| ----- | ----------------------------------------------- | ----------------- |
| A     | B1,B2,B3,B7,B9,B11,B12,B13 + regressions        | 1 focused session |
| B     | 7–11 (10 and 11 independently flag-gated)       | 1–2 sessions      |
| C     | 12–15                                           | 1–2 sessions      |
| D     | 16–18 (16 needs a cues-join + engine extension) | 2 sessions        |

Order rationale: A unblocks trust in every proposal (offline collapse is the #1 live
failure); B and C compound on the same tests; D is the market differentiator and wants
B's valence/energy work landed first so cue planning targets a stable arc.

Each item lands through the standard gates (`bun run check:full`, staged tests, parity-doc
row, MCP twin assertion where a param is added).

### Explicit non-goals (principle-locked)

- No solver dependency (OR-Tools/Held-Karp) — greedy+2-opt is enough at n≈520-pool/3,600
  census and keeps the pure-TS no-native-deps shape.
- No LLM in the scoring path (digcrate/mcp-dj style planning is available through the
  agent surface anyway — MCP _is_ our natural-language front end).
- No playback/automix execution — propose-only, hardware-gated; rb-playlist remains the
  only writer, behind its existing gates.
