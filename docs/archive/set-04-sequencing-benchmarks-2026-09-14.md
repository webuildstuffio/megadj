# MegaSet — Sequencing Deep Dive & Benchmarks

> **🗄️ ARCHIVED 2026-09-15** — superseded by GitHub as the source of truth
> (issues + labels + Project board). Retained as historical evidence; do not
> update. Open work lives in [issues](https://github.com/webuildstuffio/megadj/issues).
> **Status:** ✅ COMPLETE — Sep 14 sequencing benchmark and co-occurrence design evidence.

v1 · 2026-09-14 · **Benchmarks** → [PRD](01-prd.md) · [Analysis](03-competitive-analysis.md) · [Audit & plan](08-audit-and-plan.md)

> Glossary for the jargon below (greedy, beam, 2-opt, Held-Karp, LOO, LUFS):
> [10-findings §5](10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

Two questions this doc answers with measurements, not vibes:

1. **How good is the sequencer, really?** Greedy pick is "good enough" folklore —
   measured against what? (Part 1 walkthrough, Part 2 benchmarks, Part 3 verdicts.)
2. **Can public tracklists give us the co-occurrence signal** VirtualDJ gets from
   telemetry — and how much data would "useful" actually take? (Part 5.)

Method note: all experiments run against the **real engine**
(`src/deck/setbuild.ts`) with deterministic synthetic pools (mixture of
~70% 126±4 BPM, 20% 140±5, 10% 100±4 — shaped like the archive's genre
spread; uniform 24-key assignment; arousal correlated with BPM + noise).
Synthetic pools score high (mean transitions 0.97–0.996); treat _relative_
gaps, not absolute means, as the signal. Harness was ephemeral (`/tmp`,
run 2026-09-14, bun 1.2); every number below reproduces from the formulas
in Part 1.

---

## Part 1 — How the sequencer works, end to end

### 1.1 The transition graph

Every ordered pair (A → B) gets a score:

```
score(A→B, t) = 0.45·tempo + 0.3·key + 0.25·fit(t)      [0..1]
```

with two **hard gates** — score = −1 (untraversable) when either fails:

- **tempo gate:** relative distance `|a−b|/max(a,b)`; 1.0 within ±2%, linear
  to 0 at ±6%. A 124→128 step scores ~0.5·0.45.
- **key gate:** Camelot compatibility; 0 on wheel clash, neutral 0.5 when
  either key is unknown.
- **fit(t):** energy distance from the preset's arc target at position
  `t = elapsed/budget` (arousal + dance, averaged). Soft — it orders
  otherwise-equal choices along the arc.

Measured sparsity (E4, below): on a 3,664-track pool shaped like ours,
**only 12.3% of ordered pairs pass both gates** (key alone kills 36.4%,
tempo alone 12.8%). The sequencer is therefore not ranking a dense graph —
it's finding paths through a **sparse one**. Every insight in this doc
follows from that one number.

### 1.2 The greedy loop (what ships today)

`buildSet` picks the opener (arc-start arousal, gated by ≥15 tracks within
±6% of its BPM so the chain can breathe), then repeatedly takes the
highest-scoring next track from the remaining pool until the time budget
fills. O(n) per slot, O(n·steps) total: **29 ms at n=3,664, 157 ms at
n=20,000** (E2).

Greedy is _myopic_: it never asks whether the locally-best pick strands the
chain. Whether that matters is an empirical question — Part 2 answers it.

### 1.3 The exact alternative (why we don't ship it)

Optimal sequencing = **longest path** in the gated graph — NP-hard in
general. Two exact families exist:

- **Held-Karp DP** over subsets: O(2ⁿ·n²) time, O(2ⁿ·n) memory. n=10 is
  instant; n=20 took minutes (bun, 2²⁰×20 table); **n=30 OOM-killed the
  benchmark process** (~32 GB table) — and that's for a _single_ solve,
  not the N-candidates compare mode.
- **CP-SAT solvers** (djkr8's route): better scaling in practice, but a
  native dependency against the house rule of pure-TS, and still
  worst-case unbounded.

### 1.4 The repair family (what we plan)

- **2-opt:** reverse any segment if total score improves; repeat until no
  improvement. Cheap (E3: 0–5 ms on real chains), preserves the set
  (same tracks, better order), fixes _ordering_ mistakes but **cannot fix
  dead-ends** (reversal never adds edges).
- **Beam search:** keep the best B partial chains per step instead of 1.
  Directly attacks dead-ends (a doomed branch is pruned while
  alternatives survive); B=8 costs ≈8× greedy — 0.2 s at archive scale.
- **Lookahead-1:** score(prev → c) + max over c's successors
  score(c → next). One extra inner loop; fixes the classic
  "take b, die; take c, continue" case.

---

## Part 2 — Benchmarks

### E1 · Greedy vs the exact optimum, sparse adversarial pools (n=10, 300 seeded trials)

| Measure                                              | Value                            |
| ---------------------------------------------------- | -------------------------------- |
| Greedy runs that dead-ended before covering the pool | **300 / 300**                    |
| Trials where exact found a longer high-scoring path  | 264 / 300                        |
| Mean greedy/exact score ratio when suboptimal        | **0.44 (56% left on the table)** |

Worst case on purpose: greedy seeded arbitrarily into a tiny random pool.
The point is not "greedy bad" — it's that **the failure mode exists, is
large (56%), and is structural** (the gates make the graph sparse enough
that a locally-best step can be globally fatal).

### E2 · The real engine at scale

| Pool n                | buildSet time | steps | dead-end? | mean transition |
| --------------------- | ------------- | ----- | --------- | --------------- |
| 100                   | 1.2 ms        | 25    | **yes**   | 0.952           |
| 515                   | 4.3 ms        | 121   | no        | 0.974           |
| 3,664 (archive-scale) | 29 ms         | 123   | no        | 0.991           |
| 20,000                | 157 ms        | 124   | no        | 0.996           |

Reading: at archive scale the engine is effectively instant and
dead-end-free — a 3,600-pool has ~450 gated-in neighbors per track at
any moment. **n=100 is the honest warning**: a filtered pool (one genre
family, opener+landmark pinned, exclusions) behaves like the adversarial
case, and E1's failure mode reappears.

### E3 · 2-opt repair on real engine chains

| Pool n | mean transition before → after | gain       | 2-opt cost     |
| ------ | ------------------------------ | ---------- | -------------- |
| 515    | 0.9846 → 0.9848                | **+0.02%** | 0 ms, 2 passes |
| 3,664  | 0.9901 → 0.9901                | +0.00%     | 0 ms, 1 pass   |

Reading: **on chains the big-pool engine already built, 2-opt has nothing
to fix.** Greedy's myopia doesn't show up as bad _ordering_ when the pool
is huge — every slot's pick was near-optimal because alternatives were
plentiful. The audit-plan assumption "add 2-opt, kill B5" is therefore
**half right**: it's free to add, but it only pays off where chains are
fragile (E5).

### E4 · Gate survival (the sparsity measurement)

Random pairs, n=3,664, 200k samples: **12.3% pass both gates**
(tempo-only-fail 12.8%, key-only-fail 36.4%, both-fail 38.5%).
Real pools are more clustered than uniform keys, so real survival is
higher inside a genre family — which is exactly why _specialized_ pools
(one family, one vibe) behave like E5's small pools: within-family gate
survival concentrates the graph AND shrinks it at the same time.

### E5 · Sparse pools — where myopia actually bites

Realistic "club pool" sizes (one genre family + vibe filter), 200 seeded
trials each, greedy vs exact longest-path (edge count = usable chain length):

| Pool n | Greedy dead-ended           | Greedy shorter than optimal | Mean chain: greedy vs optimal | Score gap when suboptimal |
| ------ | --------------------------- | --------------------------- | ----------------------------- | ------------------------- |
| 12     | 200/200                     | 154/200                     | 2.7 vs 3.8 tracks             | 59.9%                     |
| 20     | 200/200                     | 185/200                     | 4.1 vs **8.0** tracks         | 58.6%                     |
| 30     | (exact DP OOM'd — see §1.3) | —                           | —                             | —                         |

Reading: **myopia is conditional.** Whole-library pools hide it; sparse
pools — one-family club sets, landmark-pinned builds, heavily-excluded
pools — get chains _half the optimal length_ with ~59% of the score left
on the table. This is precisely the "warmup for a 126–128 room" case the
product exists for.

---

## Part 3 — Verdicts & plan deltas

0. **Second-round experiments (E6–E8, Sep 14).** Three more angles, same
   harness family:
   - **E6 weight sensitivity** (n=3,664 replica greedy, 5 blend variants):
     mean transition moved only 0.989↔0.9945 and the arc error was
     _identical_ (0.022) across all five — at archive scale the gates, not
     the weights, decide the chain. Replica opener matches the real engine
     (v000044 = v000044). Consequence: **score weights stay engine
     constants; they will not become a user parameter.**
   - **E7 beam validation** (sparse pools, B=8): mean chain length
     greedy→beam = 2.9→4.5 (n=12), 5.1→8.1 (n=20), 7.9→10.9 (n=30); beam
     built the longer chain in 104/150, 119/150, 37/60 trials — at **0 ms**
     per build. The S12 rule ("beam when pool < ~250") is validated, not
     guessed.
   - **E8 arc adherence** (real engine, all three presets): mean arc error
     0.055 warmup / 0.039 peak / 0.018 afterhours on a 0–1 scale, zero
     adjacent same-artist picks, and the mid-set probes read exactly like
     the presets intend (peak: 124–125 BPM at arousal 6.4→6.9; afterhours
     drifting 4.7→4.4). The arc machinery does what it claims.

1. **Engine core: validated.** 29 ms at archive scale, deterministic,
   dead-end-free at n≥515. No solver, ever — exact DP OOMs at n=30 while
   greedy+repair covers n=20k in 157 ms.
2. **2-opt stays cheap and ships — but repositioned.** It is not "the B5
   fix" (E3: +0.0% on big pools); it's a free ordering polish that matters
   in E5 territory. Land in Phase C as planned; expect the E5 cases (small
   pools) to be where diffs appear.
3. **The real B5 fix is beam/lookahead, gated by pool size.** New rule for
   Phase C: when `pool < ~250` (configurable), run beam-B=8 instead of
   pure greedy — cost ≤0.2 s, attacks the measured 59% loss where it
   lives. Big pools keep greedy (measured: nothing to gain).
   → **SHIPPED 2026-09-14** (see 10-findings): `SET_BEAM_POOL_MAX = 250` /
   `SET_BEAM_WIDTH = 8` live in shared/setbuild.ts; the engine picks
   automatically, reports `search: "greedy" | "beam"` on the wire, the
   UI "Sequencer" row and CLI log surface it, and `?search=` (HTTP) /
   `--search` (CLI) / the MCP `search` param force either strategy for
   A/B compares.
4. **N-candidates compare gets a quality floor for free.** With beam in
   place, "Build 3" explores genuinely different chains instead of
   3 near-identical greedy runs.
5. **Pool-size honesty.** `pool_hint` (B12) should say "small pool —
   switching to deep search" when the beam path triggers. The UX and the
   algorithm share the same threshold.

---

## Part 4 — Variable triage on real library data (what else is worth doing)

Run 2026-09-14 against the live `archive.db` (3,664 downloaded / 3,610 beats /
3,659 mood / 3,605 cues / 3,415 embedded+genre). The question: _which candidate
variables are actually useful here_ — measured, not assumed.

### 5.1 The mood axes are nearly flat — this changes B4

| Axis       | min–max   | mean | stdev    | verdict                                     |
| ---------- | --------- | ---- | -------- | ------------------------------------------- |
| valence    | 3.8–4.9   | 4.35 | **0.12** | 1.1-wide range on a 1–9 scale               |
| arousal    | 4.1–5.8   | 4.95 | **0.18** | same — the effnet heads compress everything |
| dance      | 0.00–1.00 | 0.99 | **0.07** | mean 0.99 — effectively binary/saturated    |
| aggressive | 0.00–0.94 | 0.25 | 0.234    | **real spread — the widest axis**           |
| happy      | 0.00–0.99 | 0.26 | 0.24     | real spread                                 |
| electronic | 0.00–1.00 | 0.94 | 0.17     | near-saturated                              |
| party      | 0.00–1.00 | 0.93 | 0.14     | near-saturated                              |

Correlations: arousal↔valence r=0.67 (mostly redundant _in our library_);
arousal↔BPM **r=0.10** (the mood model is NOT just tempo in disguise —
genuinely additive signal); dance↔BPM r=0.02; happy↔valence r=−0.32.

**Consequences:**

1. **B4 (valence scoring) is demoted.** With stdev 0.12, valence can reorder
   neighbors by noise. The 3-axis fit (B4) ships only if it uses z-scored
   axes; otherwise it's decoration.
2. **`aggressive` and `happy` are the underrated axes** — the only raw-head
   scores with real spread. `aggressive` is a natural _hard-edge guard_
   (penalize transitioning into a 0.8-aggressive track in an afterhours arc)
   and `happy` separates the "euphoric" vs "dark" 126-BPM tracks that
   arousal can't. Cheaper than any new analysis: **the data is already in
   the mood ledger.**
3. **Dance/arousal saturation explains the flat E6/E8 arcs** — the fit term
   has little to push on. Future mood analysis should z-score or
   percentile-rank the heads _before_ storing.

### 5.2 Cue ledger: the handoff layer is ready NOW

Phrase grid confirmed: 8-bar cues at bar 1/9/17/…, `position` in seconds.
Coverage: **avg 22.5 cues/track; 3,496 tracks have ≥8; 2,568 have ≥16.**

Mixout (first cue >0.5 s — end of the intro): **p10 = 1.1 s, p50 = 14.5 s,
p90 = 16.0 s.** Half the library is mix-out-ready by ~15 s — a standard
32-bar intro at 126 BPM is ~15.2 s. **Phase D's raw material needs no new
analysis at all** — mixOut for ~3,600 tracks is one query away. This is the
strongest empirical case in the doc for prioritizing Phase D.

### 5.3 Embeddings: usable prior, not a genre oracle

kNN family purity on real data (150 queries, 3,415 tracks, family-mapped
genres): **top-1 = 48%, top-5-majority = 47%.** Embeddings know what
"sounds like" at the _track_ level but genres are sub-genre fragmented
(440 raw labels — `house` alone has 838 tracks); family mapping merges the
signal away. Consequence: keep the B10p embedding prior **small** (≤0.1),
and treat embedding clusters as their own vocabulary — "embedding
neighborhoods" may be better genre-family seeds than scraped genre strings.

### 5.4 New FullTags passes worth precomputing (ahead of MegaSet)

| Pass                                      | Cost (measured)                                                   | Feeds                                                                       | Worth it?                                            |
| ----------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| **LUFS + LRA** (`ffmpeg ebur128`)         | **348× realtime — ~1 s/track, ~50 min one-time** for 3,600 tracks | loudness-continuity penalty (T14); LRA also flags "wall-of-noise" masters   | ✅ cheapest new signal, independent of everything    |
| **Intro RMS shape** (`astats` first 30 s) | ~1,292 RMS frames/30 s — tiny JSON per track                      | energy _shape_ of the intro (flat = safe mix-in, spiked = vocal/bdrop risk) | ✅ makes mixIn windows honest, pairs with 5.2        |
| **Genre refold**                          | 16 case-variant rows + 440→~40 family map                         | B6 diversity guard prerequisite                                             | ✅ one-time `megadj genre --refold`, already planned |
| Aggressive/happy percentile normalization | re-score of stored heads, no audio                                | fixed-arcs fit term (5.1)                                                   | ✅ tiny, unlocks the two healthy axes                |
| `bpm_residual_std` backfill               | beats re-run only for pre-GA-01 rows                              | grid-quality guard (T13)                                                    | 🔶 later — only tracks that fail handoff audits      |
| Vocal presence (Demucs)                   | minutes/track, heavy                                              | vocal-clash guard                                                           | ❌ for now — LUFS+RMS shape covers 80% cheaper       |

### 5.5 Half/double-time (B8): measured — the urgency drops

Only 72 tracks at 80–95 BPM and 59 at 160–185 in a 3,610-track library that
is 79% 115–135 BPM. Octave pairs are **0.0%** of all pairs; ±6% pairs are
55.7%. B8 is still correct to ship (it's 5 lines), but it's a latent-correctness
fix, not a quality unlock for _this_ library — matches the audit's original
"latent impact" note, now with numbers.

### 5.6 Ranked answer: what's most useful, in order

1. **Mixout/mixIn from existing cues** — zero new analysis, 3,600 tracks
   ready today (5.2). Directly enables the Phase D bet.
2. **Aggressive/happy into the fit term** (after percentile-normalizing) —
   data already stored, the only axes with spread (5.1). Replaces the
   demoted valence plan with something that will actually move chains.
3. **LUFS+LRA pass** — 50 min one-time, fully independent signal, enables
   loudness continuity (5.4).
4. **Intro RMS shape** — tiny, makes handoff windows honest.
5. **Genre refold** — unblocks B6, already planned.
6. Embedding prior (small weight) and B8 — keep, but neither moves this
   library much (5.3, 5.5).

---

## Part 5 — Co-occurrence from public tracklists (the light-data design)

### 4.1 Restating the stance

The analysis doc excluded _crowdsourced co-occurrence_ as "VirtualDJ's
moat, ethically off". That was too coarse — there are two different data
classes:

- **Private telemetry** (VirtualDJ LiveFeedback: what _you_ played, phoned
  home). Still off — surveillance-shaped, and n=1 locally is worthless.
- **Published editorial tracklists** (1001Tracklists, MixesDB, Essential
  Mix archive, RA podcast, SoundCloud timestamped comments). This is
  public, already-published curation — the same class of source as the
  SoundCloud genre scrape we already do. **In scope.**

### 4.2 Sources (status verified 2026-09-14)

| Source                                             | Scale                                        | Shape                                                                            | Access                                             |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| [1001Tracklists](https://www.1001tracklists.com)   | **260k+ tracklists**, ~700k monthly visitors | track → every tracklist it appears in; position + timestamps                     | HTML (rate-limit politely); third-party APIs exist |
| [MixesDB](https://www.mixesdb.com)                 | ~15 years of sets                            | open **MediaWiki API** (`/w/api.php`); per-page tracklists w/ completeness flags | ✅ free API, no key                                |
| Essential Mix (BBC)                                | **~1,315 mixes** (1993→)                     | full tracklists, Algolia index + MixesDB mirrors                                 | ✅ public                                          |
| RA Podcast                                         | ~900 episodes                                | tracklists (often via MixesDB)                                                   | mixable                                            |
| SoundCloud mix descriptions + timestamped comments | unknown, per-upload                          | free text with `[00:00] Artist - Title` lines                                    | existing yt-dlp pipeline                           |

### 4.3 The light-data shape (user's instinct is right)

A setlist is just an ordered list — we only store, per row:
`source, setlist_id, position, artist_raw, title_raw, matched_videoId?`.
No audio, no user data, no timestamps beyond the set's own date.
**~150 bytes/row; 100k rows ≈ 15 MB** in `archive.db` (`setlist_edges`
table). Ingest is a `megadj cooccur` pass in the GetDat family: fetch →
parse `[mm:ss] Artist - Title` → match to archive IDs by
NFC/casefold/artist-title normalization (the matching machinery from
`megadj adopt --shelf` reused). Unmatched rows stay raw — they still
count for scene statistics.

### 4.4 How much data is useful? (the honest math)

Let M = 3,600 (archive tracks), and N = matched transition observations.

- **Pair-level steering** ("A→B was played together, bonus") needs
  per-**pair** observations. Possible ordered pairs: M² ≈ 13M. Even a
  heroic N=100k matched transitions covers ≤100k distinct pairs ≈
  **0.8% of the space** — the prior almost never fires when the engine
  needs it (any given greedy slot compares ~450 gated-in candidates).
  Pair-level direct bonuses are **not worth building** at our scale. (At
  Spotify-scale libraries they'd be even worse; nobody pair-steers from
  sparse data.)
- **Track-level & scene-level priors converge fast** and are where the
  value is:
  - _Per-track rotation stats_ (how often a track appears, in what
    position — openers/closers/weapon tracks): stable at ~50 sightings
    per track → N ≈ 50·M ≈ **180k track-sightings**. 1001TL alone holds
    ~6.5M track-slots (260k × ~25); even a 5% archive-match rate
    (conservative — our pool is house/techno/EDM-centric, their catalog
    skews the same) gives ~300k. **Margin ≈ 1.7×** — enough.
  - _Scene/genre community structure_ (tracks that co-occur define
    genres empirically — validates/repairs our 440-genre fragmentation
    via co-occurrence projection): needs far less; ~10–20k matched
    transitions already yield stable track–track affinity clusters via
    low-rank/embedding projection of the co-occurrence matrix.
  - _Opening conventions_ (what arousal/BPM do real warmup openers have?
    → calibrate our preset arc starts against measured reality):
    N ≈ 2–5k dated sets. One evening of MixesDB fetching.
- **So the threshold answer:** _useful_ begins around **10k matched
  rows** (scene structure + opener calibration), _solid_ at **~100k**
  (per-track rotation stats), and pair-steering **never** becomes useful
  — don't build for it.

### 4.5 What it plugs into (aggregate scoring, per the goal)

The product goal is "best possible sets using all available methods and
data in aggregate". Co-occurrence becomes **two more soft terms** in the
existing 0.45/0.3/0.25 blend, never a gate:

- `sceneAffinity(c)` — cosine in co-occurrence-projected space between
  prev and c (the low-rank signal; fires on _every_ pair, unlike raw
  pair counts). This is the embedding-like prior already planned in
  Phase B, with a second, independent data source behind it.
- `rotationWeight(c)` — mild prior for tracks that real DJs actually
  sequence (position-aware: opener stats feed the opener pick; peak-slot
  stats feed mid-set fit). Capped small (≤0.05 of the blend) so taste
  and measured audio stay dominant.

Both are flag-gated like genre inference: compute honestly, default off,
turn on when the numbers say they help (the A/B proposal compare mode
from Phase C is the referee).

### 4.6 Effort & order

| Step                                                   | Size          | Unlocks                                     |
| ------------------------------------------------------ | ------------- | ------------------------------------------- |
| `megadj cooccur --source mixesdb` (free API first)     | S (1 session) | opener calibration, genre-family validation |
| 1001TL ingest (polite, rate-limited, resumable)        | M             | rotation stats at scale                     |
| co-occurrence projection → `sceneAffinity` term        | M             | the actual set-quality lift                 |
| position stats → `rotationWeight` + opener calibration | S             | better openers, measurable vs E-baseline    |

Honest ceiling: this is a **refinement lane**, not the differentiator —
the phrase-handoff layer (Phase D) stays the bet. But it's the cheapest
new _independent_ signal available, it reuses existing machinery
(fetch pipeline, fuzzy matching, kNN projection), and it directly
attacks our two measured weaknesses: opener quality (3.1's familiarity
prior) and genre-family truth (B6's prerequisite).
