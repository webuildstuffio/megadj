# Set Builder (M66 / MegaSet) — Full Audit, 10-Project Comparison & Improvement Plan

**Status:** 🧭 ACTIVE — plan for the next build-out rounds. Not yet implemented.

_2026-09-13. Scope: `cratedeck/src/setbuild.ts` (engine), `cratedeck/src/archive_similar.ts`
(candidate pool), `cratedeck/shared/setbuild.ts` + `shared/camelot.ts` (wire SSOTs),
`src/fulltags/setbuild.ts` (CLI), `cratedeck/src/archive_tools.ts` (MCP), `archive_routes.ts`
(HTTP + M3U8), `web/products/fulltags/SimilarTab.tsx` (UI), `src/rekordbox/rb-playlist.ts`
(master-DB write-off). Product home: [megaset-prd.md](megaset-prd.md).
Companion to [docs/fulltags-roadmap.md](fulltags-roadmap.md) and
[docs/PRINCIPLES.md](PRINCIPLES.md) (propose-only is a feature, not a gap).

---

## Part 1 — Current state (measured 2026-09-13)

### 1.1 Live numbers

| Measure | Value |
|---|---|
| Downloaded rows | 3,664 (full-shelf mirror landed Sep 12) |
| Beats ledger | 3,610 · Mood 3,659 · Cues 3,605 · Embeddings 3,618 |
| `track_keys` cache | 534 (healed Sep 12; rest served by rekordbox mirror / live reads) |
| Rekordbox mirror rows | 3,563 (BPM ×100 + KeyName JSON) |
| Fully analyzed (beats+mood) | 3,602 |
| Distinct genres (case-folded) | 440 — badly fragmented (`House`/`house` both present) |
| Engine speed @3,600 candidates | **6 ms** (pure, 60-min peak build) |
| Live endpoint | ~0.4 s warm; pool 515 on the pre-mirror census |

### 1.2 What the engine does today

Greedy next-track selection: `0.45·tempo + 0.3·key + 0.25·energy-fit`, hard gates
tempo ≠0 outside ±6% and key =0 on clashes. Opener anchored by tempo-neighborhood
count (≥15 within ±6%) then arousal-distance to the arc start. Deterministic
tie-breaks (score, then `videoId`). Whole-track budget fill; honest `excluded[]`
list capped at 40 with `excluded_total`. Freshness line for beats/mood ages.
Surfaces: CLI / HTTP(+M3U8 export) / MCP `archive_set_build` / web panel — one
shared parse (`parseSetbuildQuery`), one preset registry, one Camelot SSOT
(all-24-key pinned tests), one clamp table.

### 1.3 Bugs & defects found this audit (ranked)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| B1 | **HIGH** | **Drive-offline pool collapse.** 3,656/3,664 rows report `missing_files` when SHELF1 is unmounted → pool 8, 3-step sets. The rekordbox mirror (3,563 rows, BPM+key) could score offline, but `setCandidates` hard-filters on file existence. | live probe during audit (drive asleep) |
| B2 | **HIGH** | **Unbounded tempo drift.** A ±6%-per-step greedy chain compounds: measured 100 → 187.9 BPM (1.88×) in one 12-step climb. No global tempo anchor or drift budget; a "warm-up" can wander two genres away. | probe: tempo ladder test |
| B3 | **MED** | **Arc shape uncontrolled mid-set.** Peak measured `6,7,7,6` — rises then falls before the end; nothing enforces monotone approach/hold/peak placement. The envelope is sampled at slot `t` but nothing prevents local reversals when energy-fit ties. | probe: arc test |
| B4 | **MED** | **`valence` is dead data.** Stored, transmitted, never scored. Either use it (mood-lift bonus / darker-arc presets) or drop from the candidate wire to save payload. | engine read |
| B5 | **MED** | **Greedy myopia.** Each slot takes the locally best track; a high-scoring next step can strand the chain (documented probe: picking `b` leaves no successors while `c→d` continues). No lookahead/backtracking. | probe: dead-end test |
| B6 | **LOW-MED** | **No artist/diversity guard.** Nothing prevents 3 tracks by one artist back-to-back beyond coincidence; no genre-família spread either (440 raw genres make bucketing unavailable today). | engine read |
| B7 | **LOW** | **`parseSetbuildQuery("abc")` silently defaults minutes.** Unknown preset errors (correct) but non-numeric minutes falls back to 60 with no signal. Minor honesty gap vs the "never silent fallback" principle. | probe |
| B8 | **LOW** | **Half/double-time BPM not honored.** 87 vs 174 DnB scores 0 today; every serious comparator (djkr8, mixmaster, digcrate, auto-dj-ai) treats 2×/½× as mixable. Currently the pool is house/techno-centric so impact is latent. | probe |
| B9 | **COSMETIC** | `OPENNER_MIN_NEIGHBORS` typo (opener). `duplicate_files` naming vs `duplicateFiles` internal. `key_reads` counts probes, not reads, in some paths. | code |
| B10 | **NOTE** | **M3U8 export writes `#EXTINF` lines only from steps** — fine for players, but lacks the per-transition scores that rb-playlist dry-run prints; the two exports tell slightly different stories. | route read |
| B11 | **NOTE** | `excluded` slice(0,40) is duplicated in route + MCP with the same magic number — should be a shared constant next to `SET_POOL_*`. | route/tools |

Non-bugs (verified healthy): determinism (identical chains on repeat runs), O(n log n)
opener guard, budget double-count fix, NFC/casefold dedupe, relocation honesty counters,
freshness surfacing, preset-validation error path, all-24-key Camelot pins.

---

## Part 2 — The 10 open-source comparators (in depth)

Selection: closest functional neighbors across the feature space (sequencing
algorithms, energy arcs, analysis, surfaces, write-off targets). Stars/activity
checked 2026-09-13. All are small/hobby projects (0–9 stars) except Mixxx
(reference implementation, not a set *planner* — included for its AutoDJ contract).

### 2.1 [schoi80/djkr8](https://github.com/schoi80/djkr8) — CP-SAT constraint solver ⭐9, MIT, Python

The most rigorous sequencer found. **Reads Rekordbox 6/7 directly via pyrekordbox**
(same library we use), optimizes with Google OR-Tools `AddCircuit`: binary
`included[i]` + edge vars, longest-path objective, configurable strictness
(STRICT/MODERATE/RELAXED harmonic levels), **energy-flow constraint** (non-decreasing,
max +1 per step on a 1–5 scale), capped **energy-boost transitions** (+2 wheel hours,
max 3/set), half/double-time BPM, transition-quality weights (1.0 perfect → 0.5
"Armin variation"), Rekordbox XML/DB export. The gap vs us: no audio analysis of its
own (consumes RB metadata), no embeddings, fixed 1–5 energy from RB's (coarse) field.

### 2.2 [roneni/harmonic-flow](https://github.com/roneni/harmonic-flow) (HarmonySet) — Held-Karp TSP ⭐1, TS/Next.js

Reorders an *existing* playlist (Rekordbox XML/Serato CSV/Traktor TXT upload) via
**Held-Karp exact DP ≤20 tracks**, greedy + **2-opt** local search beyond. Circle-of-fifths
distance with relative maj/min bonuses; ramp-up/down/wave energy modes; 56+ key-format
normalizer; quality score 0–100 + per-transition analysis + path visualization; 85 tests.
Lesson: the **2-opt improvement pass** is cheap and would fix our B5 myopia without a
solver dependency.

### 2.3 [gnujoow/spotify-mixmaster](https://github.com/gnujoow/spotify-mixmaster) — beam search ⭐2, MIT, Python

Sequences Spotify Liked Songs: **beam search** over Camelot moves (directional scoring:
same/up1/relative/boost), ±6% BPM flow with half/double-time, **YAML-configurable energy
curves** (classic late-peak / linear / wave / flat), 40-ish Beatport-style **genre
buckets + DJ slot classification** (opener→closer), landmark tracks ("draft workflow":
seed a few must-plays, fill around them), quality floor (ends short rather than pad),
per-run seed = reproducible, `--candidates N` generates N alternatives to compare.
Lessons: beam search breadth (fixes B5), **landmark/seed tracks**, **quality floor**,
**N-candidates compare mode**, all-rules-in-YAML tunability.

### 2.4 [darav-t/mcp-dj](https://github.com/darav-t/mcp-dj) — the closest philosophical twin ⭐4

MCP server + FastAPI UI over a local Rekordbox library (pyrekordbox): Camelot scoring,
**5 energy-arc profiles** (journey/build/peak/chill/wave), **MyTag-based candidate
filtering**, natural-language set requests through Claude with **explainable reasoning**
("which signals made this 'darker'"), Essentia ML analysis (BPM/key/mood/genre) merged
into a JSONL library index, MIK energy import, `recommend_next_track` and
`get_track_compatibility` tools, Rekordbox playlist export, Claude Code slash commands.
Gap vs us: coarse energy (MIK 1–5 or BPM heuristic), no embeddings, no phrase/cue
awareness, single-machine SQLite-free JSONL index. Confirms our MCP-first direction and
the value of `explain` payloads.

### 2.5 [fungiblemoose/digcrate](https://github.com/fungiblemoose/digcrate) — local analysis + LLM planning ⭐1, MIT, Python

librosa-local analysis (beat-tracked BPM, chromagram + **Krumhansl-Kessler key**,
RMS+spectral-centroid energy), then natural-language planning via OpenAI over the
metadata catalog (audio never leaves). Transition score: **key 40% / BPM 35% / energy
25%** with half-tempo detection; **gap finding**: flags weak transitions, suggests
bridge-track profiles (target BPM/key/energy), optional Spotify discovery to fill them;
M3U + **Rekordbox XML export**. Lessons: **bridge-track suggestion** (great UX for the
excluded list), explicit scoring weights per dimension, honest "audio stays local" split.

### 2.6 [raullee/open-crate](https://github.com/raullee/open-crate) — swappable-engine TS crate ⭐0, MIT

Local-first vinyl+digital crate over plain JSON; `@open-crate/core` npm package with a
**`SetGenerator` strategy interface** (default `greedy-harmonic` ships; maintainer's tuned
generator stays private by design), Camelot scoring, smooth/adventurous modes, lock/swap/
regenerate set-builder UX. Lesson: the **lock-and-regenerate interaction** (freeze tracks
you like, regenerate around them) is the missing middle between our one-shot proposal and
hand-building; also `mode: "adventurous"` as a scoring temperature.

### 2.7 [ysy-ym/pulsegrid](https://github.com/ysy-ym/pulsegrid) — cue-aware handoff planning ⭐1, MIT

Browser DJ workstation: analyzes structure (sections, double drops), plans **per-pair
Cue 8 → Cue 5 handoff points**, EQ/filter/FX/crossfader automation per transition,
**preview + transition audit before Auto Play**, everything visible/editable. The pitch:
"AI doesn't just pick the next track, it builds the handoff." Lesson: our cues ledger
(3,605 tracks × ~17-20 8-bar phrases each) is unused by setbuild — pairing planned
**transition points**, not just track order, is the differentiator PulseGrid proves out.

### 2.8 [SLYysl/cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) — guarded recipe router ⭐0

Explainable AutoMix: reads structural evidence (beat grids, downbeats, phrase candidates,
energy windows, key, melody contour, vocals), **routes to one of 11 guarded transition
recipes** (`structure-mix`, `late-contrast-rise`, `late-contrast-release`,
`terminal-rescue`…), each recipe constrained where/how it may run; **fails closed** —
unsafe overlap/vocal collision/stale state reject or downgrade to protected fallback;
every decision logged as inspectable evidence. Lesson: **recipe taxonomy + fail-closed
gating + decision logs** — the shape our rb-playlist write-gates would want if we ever
automate handoffs.

### 2.9 [caffettino87/auto-dj-ai](https://github.com/caffettino87/auto-dj-ai) — explainable browser automix ⭐1, MIT

Essentia+librosa+Demucs analysis (BPM+confidence, 3-profile-majority key, EBU R128
loudness, beat grid, vocal presence in intro/outro), then real dual-deck mixing: beatmatch,
3-band EQ swap driven by spectral-band conflict, phrase-aligned starts, loudness
normalization to −16 LUFS, **anti-vocal-clash next-track scoring**, octave BPM relations.
Lesson: **loudness (LUFS) and vocal-occupancy as first-class scoring inputs** — our pool
has neither; both are derivable (ffmpeg `ebur128`, Demucs optional).

### 2.10 [mixxxdj/mixxx](https://github.com/mixxxdj/mixxx) — AutoDJ contract reference (mature, huge)

Not a planner — a player. But its AutoDJ processor defines the *playlist-consumer
contract*: fade modes (**Full Intro+Outro** uses marked intro/outro lengths as crossfade
time; **Fade At Outro Start**; **Fade At Intro Start of next**), fixed transition seconds,
queue manipulation, and now (PR #16063) **prerolled transitions for gapless playback**.
Lesson: our M3U8/rb-playlist exports should carry the intro/outro cue windows so any
consumer (CDJ, Mixxx, a future automix leg) can execute the handoff without re-analysis.

### 2.11 Feature matrix

| Capability | megadj setbuild | djkr8 | HarmonySet | mixmaster | mcp-dj | digcrate | open-crate | pulsegrid | cuefield | auto-dj-ai | Mixxx |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Own audio analysis | ✅ effnet+ffprobe | — (RB) | — | — (APIs) | ✅ Essentia | ✅ librosa | — | ✅ | ✅ | ✅ Essentia/Demucs | ✅ |
| Key data | ✅ TKEY+RB mirror | RB | upload | API | RB+Essentia+MIK | librosa | import | own | own | Essentia | RB/analyzed |
| Camelot scoring | ✅ | ✅ 3 levels | ✅ circle-of-5ths | ✅ directional | ✅ | ✅ 40% | ✅ | ✅ | ✅ | ✅ | n/a |
| Half/double BPM | ❌ B8 | ✅ | — | ✅ | — | ✅ | — | ✅ | ✅ 2×/½× | ✅ octaves | ✅ |
| Energy arc | ✅ 3 presets | ✅ constraint | ✅ 3 modes | ✅ YAML curves | ✅ 5 profiles | ✅ 25% term | ✅ arc | ✅ | ✅ windows | ✅ RMS curve | ❌ |
| Sequencer power | greedy | **CP-SAT** | **Held-Karp+2-opt** | **beam** | greedy | LLM+validate | greedy swappable | planner | recipe router | score pick | queue |
| Lookahead/repair | ❌ B5 | ✅ global | ✅ 2-opt | ✅ beam | ❌ | — | ❌ | — | — | — | — |
| Landmark/seed tracks | opener only | — | — | ✅ | — | — | ✅ lock | ✅ cues | — | — | queue |
| N-candidates compare | ❌ | — | ✅ before/after | ✅ | — | — | ✅ regenerate | — | — | — | — |
| Diversity guard | ❌ B6 | energy only | — | genre buckets | MyTags | — | — | sections | structure | vocal clash | — |
| Phrase/cue awareness | ❌ (data exists!) | — | — | — | — | — | — | ✅✅ | ✅✅ | ✅ phrase grid | ✅ intro/outro |
| LUFS / vocal checks | ❌ | — | — | — | — | — | — | — | ✅ fail-closed | ✅✅ | ✅ |
| Explain payload | partial (counters) | ✅ scores | ✅ per-transition | ✅ transition log | ✅✅ NL explain | ✅ gaps | ✅ honest engine | ✅ audit | ✅✅ evidence | ✅ | — |
| Write-off to RB | ✅ rb-playlist (gated) | ✅ XML/DB | ❌ CSV | ✅ Spotify | ✅ playlist | ✅ XML | ❌ | ❌ player | ❌ player | ❌ | player |
| MCP surface | ✅ | — | — | agent-ready CLI | ✅✅ | — | — | — | — | — | — |
| Determinism | ✅ | solver (seeded?) | — | ✅ seed | — | — | ✅ | — | — | — | — |

---

## Part 3 — Improvement plan (phased, house-style)

Guiding rules: propose-only stays; every phase ships with tests + parity rows; no new
runtime deps without the release-age floor; algorithms stay pure functions in
`cratedeck/src/setbuild.ts`; SSOT tables live in `shared/`.

### Phase A — Bug fixes (no new features) · 🔨 FIRST

1. **B1 offline pool:** `setCandidates` gains `availability: "files" | "metadata"` —
   when files are absent but the rekordbox mirror covers a row (BPM+key present), admit it
   as a **metadata-only candidate** with a visible `metadata_only` count in the payload and
   an honest freshness/staleness line ("proposing from mirror metadata; shelf asleep").
   Keys/BPM from mirror, durations fall back to 300 s. Drives nothing.
2. **B2 tempo anchor:** opener pick sets `anchorBpm`; `transitionScore` gains a soft
   `tempoDrift` term — distance of candidate BPM from the *arc-local target* (anchor
   lerped toward `preset.tempoTarget ?? anchor`), not just from `prev`. Hard drift budget:
   reject chains whose total drift exceeds ±2 half-steps of the anchor unless every step
   is a 2×/½× relation. Regression: ladder test pins max drift.
3. **B3 arc control:** enforce monotone-in-segments arousal: split [start,end] envelope
   into thirds (approach/hold/land for peak; steady descent for afterhours); a candidate
   may not move the chain's arousal opposite its segment's direction by more than ε.
   Regression: peak chain's last slot ≥ second slot; afterhours strictly non-increasing
   beyond ε.
4. **B7 minutes validation:** `parseSetbuildQuery` returns `{error}` for non-numeric
   minutes (route → 400, MCP → RpcParamError, CLI → exit 2). "absent" stays default-60.
5. **B11:** `SET_EXCLUDED_PREVIEW_MAX = 40` into `shared/setbuild.ts`; both surfaces import.
6. **B9:** rename constant to `OPENER_MIN_NEIGHBORS`; docs pass on payload field names.

**Added during PRD pass (Sep 13):**

7. **B12 empty-pool UX:** the audit's live probe hit the worst case — pool 8, 3 steps,
   "complete: false" with no human hint. When `pool` < a floor (say 10), the payload/UI
   gains a `pool_hint` ("only 8 playable candidates — is the shelf mounted? FullTags
   mirror covers 3,563 rows; run `megadj rb-mirror`") instead of a bare shortfall.
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
11. **LUFS (analysis phase, cheap):** `megadj loudness` pass writing `lufs` to the beats
    ledger row via ffmpeg `ebur128` (local, fast); scoring trims extremes (nothing mixes
    well across a 12-LU gap). Optional, off by default, like genre.

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
    `{keyScore, tempoScore, fit, phrasePair}` rows so the dry run *shows the math*.
18. **Consumer contract:** M3U8 comments carry `#EXTGENRE`-style intro/outro windows
    (Mixxx AutoDJ fade-mode semantics) so the export is executable, not just a list.

### Sequencing & estimates

| Phase | Ships | Size |
|---|---|---|
| A | B1,B2,B3,B7,B9,B11,B12,B13 + regressions | 1 focused session |
| B | 7–11 (10 and 11 independently flag-gated) | 1–2 sessions |
| C | 12–15 | 1–2 sessions |
| D | 16–18 (16 needs a cues-join + engine extension) | 2 sessions |

Order rationale: A unblocks trust in every proposal (offline collapse is the #1 live
failure); B and C compound on the same tests; D is the market differentiator and wants
B's valence/energy work landed first so cue planning targets a stable arc.

Each item lands through the standard gates (`bun run check:full`, staged tests, parity-doc
row, MCP twin assertion where a param is added).

### Explicit non-goals (principle-locked)

- No solver dependency (OR-Tools/Held-Karp) — greedy+2-opt is enough at n≈520-pool/3,600
  census and keeps the pure-TS no-native-deps shape.
- No LLM in the scoring path (digcrate/mcp-dj style planning is available through the
  agent surface anyway — MCP *is* our natural-language front end).
- No playback/automix execution — propose-only, hardware-gated; rb-playlist remains the
  only writer, behind its existing gates.
