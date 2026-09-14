# MegaSet — Sequencing Deep Dive & Benchmarks

v1 · 2026-09-14 · **Benchmarks** → [PRD](01-prd.md) · [Analysis](03-competitive-analysis.md) · [Audit & plan](../setbuild-audit-2026-09-13.md)

Two questions this doc answers with measurements, not vibes:

1. **How good is the sequencer, really?** Greedy pick is "good enough" folklore —
   measured against what? (Part 1 walkthrough, Part 2 benchmarks, Part 3 verdicts.)
2. **Can public tracklists give us the co-occurrence signal** VirtualDJ gets from
   telemetry — and how much data would "useful" actually take? (Part 4.)

Method note: all experiments run against the **real engine**
(`cratedeck/src/setbuild.ts`) with deterministic synthetic pools (mixture of
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
4. **N-candidates compare gets a quality floor for free.** With beam in
   place, "Build 3" explores genuinely different chains instead of
   3 near-identical greedy runs.
5. **Pool-size honesty.** `pool_hint` (B12) should say "small pool —
   switching to deep search" when the beam path triggers. The UX and the
   algorithm share the same threshold.

---

## Part 4 — Co-occurrence from public tracklists (the light-data design)

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
