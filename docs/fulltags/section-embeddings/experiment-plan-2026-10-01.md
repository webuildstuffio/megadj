# Section Embeddings — Experiment Plan (Oct 1, 2026)

**Status:** PLANNED — prerequisites first, then greedy stage-wise experiments.

**Core thesis:** effnet-discogs-1280 is the *incumbent*, not the proven
winner. It looked best in a 50-track raw-kNN comparison that favours it
by design (Discogs-genre training → already sorted for kNN). A fair test
needs a trained classifier on ≥300 tracks with macro-F1 and artist exclusion.

**Prerequisite:** Seed-label audit DONE (report §3 — labels from
SoundCloud/Beatport/file tags, not effnet). MAEST sanity check NOT done.

---

## KEY DEPENDENCY: Genre Source Expansion

**This plan's ceiling is bound by seed label quality.** Every experiment
trains and evaluates against labels from an 8-rung vote ladder where MB
fires on only 3% of tracks, Bandcamp on <1%, and the system averages ~1.2
evidence rows per track.

### Why source expansion is the multiplier

**Problem:** 4,358 tracks with 5,581 votes, thinly distributed:
- SC: 2,249 votes (40%) — low trust (0.35 weight), genre field often numeric junk
- BP: 2,076 votes (37%) — strong but electronic-only
- File tags: 1,000 (18%) — reliable for pool rips, mixed otherwise
- MB: 194 (3%) — good weight (0.40) but almost never fires
- BC: 55 (1%) — barely fires
- **73.3% have any primary genre; only 41.1% have a secondary genre**

A probe trained on thin, noisy labels learns the noise. A kNN evaluated
against thin labels can't distinguish a wrong prediction from a wrong label.

| Classification Level | Current State | After Source Expansion | Impact |
|---|---|---|---|
| **L2 Family (9)** | 73.3% filled, LOO 66.6% gated | ~92-96% filled | Probe trains on 20-30% more tracks; minority families get more seeds |
| **L3 Primary subgenre** | 64.4% in v4 comment, 105 labels | ~80-88%, 150-200 labels | Hierarchical classifier becomes viable |
| **L3 Secondary** | 41.1% coverage | ~70-80% from Discogs multi-style + SC | D5 can be evaluated honestly |

### Recommended sequencing: sources FIRST, then experiments

```
1. Wire Last.fm (S, <1 day)      → fills pop/hiphop/rock minorities → fixes 0%-recall
2. MB AcoustID→MBID chain (S)    → exact identity → correct remix labels
3. MB recording-level tags (S)   → more votes per track
4. SC tags + sanitizer (M)       → L3 subgenre + mood/scene signal
5. Discogs dump ingest (M+M)     → 400-style L3 ground truth, multi-style secondary
   ↓ THEN
6. Re-seed corpus with all sources → run experiments on enriched labels
```

---

## Prerequisites (do first, cost: minutes)

| # | Task | Status |
|---|---|---|
| P1 | Seed-label source audit | ✅ Done — no circular eval |
| P2 | Fix McNemar CDF bug | ✅ Done — normalCdf was erf(x) not Φ(x) |
| P3 | Add Holm correction | ✅ Done — model-bench pairwise |
| P4 | Report macro-F1 and per-class recall | ✅ Done — added to model-bench |
| P5 | MAEST sanity check: middle blocks, stacked tokens | TODO |
| P6 | Fix drop finder: use RMS loudness or PSSI phrases | TODO |

---

## The Three-Model Showdown

The prior bench tested five models by raw kNN on 50 tracks. That was
underpowered and biased toward effnet (pre-arranged embedding space).
The real comparison is three models, each given a fair classifier:

### 1. effnet-discogs-1280 — the incumbent baseline

- **Origin:** MTG Barcelona, ISMIR 2022. Trained on 3.3M tracks matched
  to Discogs metadata. Evaluated in the original papers with a frozen
  embedding + small classifier on MTG-Jamendo, not on DJ electronic sub-genres.
- **Why it looks good for us:** Trained on Discogs genre/style labels, so
  the embedding space is already sorted roughly by our genres. That makes
  it strong for plain kNN with no training. Also tiny (17 MB) and fast.
- **The trap:** Its kNN advantage is an artifact of its training, not proof
  it's the best encoder. Self-supervised models need a classifier on top
  to show their strength, and our bench didn't give them one.
- **Dim:** 1280. Speed: ~1.7s/track.

### 2. MAEST — probably the best fit for electronic styles

- **Origin:** MTG Barcelona, 2023. Trained supervised on Discogs-400 style
  tags. Even the authors of OMAR-RQ (a 2025 competitor from the same lab)
  found MAEST beat their model at tagging, because its supervised training
  aligns with Discogs genres.
- **Why it matters:** Its 400 Discogs styles are the same vocabulary as our
  sub-genres. Our bench had it losing, almost certainly due to wrong pooling
  (mean-pooled last layer instead of middle blocks + stacked tokens).
- **What to fix:** Use middle-layer features with stacked output tokens.
  The MAEST paper documents this — last-layer mean-pool throws away the
  hierarchical genre structure.
- **Dim:** 768 (per token, stacked → higher). Speed: ~2.8s/track.
- **Classification head bonus:** The 400-style Discogs head provides free
  zero-shot probabilities (D3 experiment). These are the same styles it was
  trained to predict — raw head output IS a genre prediction.

### 3. MERT-v2-30s (2026) — newest, highest-scoring general encoder

- **Origin:** m-a-p team, released alongside YuE2 (2026). 632M parameters,
  takes 30-second clips at 24 kHz, free for non-commercial use.
- **Benchmark scores:** GTZAN 91.7% (vs MuQ 83.8%, PupuJEPA 86.9%),
  MTG-Jamendo genre 88.0% (lead narrows to ~2-3pp).
- **Caveats:** Authors copied competitor scores from another paper rather
  than rerunning them. GTZAN is small, old, rock/pop-heavy — its genre
  number won't tell us much about techno vs tech house. On the broader
  MTG-Jamendo genre tags the lead is narrower.
- **Layer recommendations:** The model card recommends layer 23 for GTZAN
  genre and layer 19 for MTG-Jamendo genre, read through a trained
  classifier. Test both.
- **Clip length:** Feed it 30-second clips from drop sections — that's the
  length it was trained on. Our 32-bar windows are close (32 bars at 128 BPM
  = 60s; at 140 BPM = 55s) — may need to trim to 30s.
- **Cost:** ~40× bigger than effnet. 3 sections × ~4,500 tracks = ~13,500
  clips: a few hours on Apple Silicon, overnight on CPU. Compute and cache
  once, every test after that takes minutes.
- **Dim:** 1024 (layer 19) or 1024 (layer 23).

### Models to SKIP

| Model | Why skip |
|---|---|
| **MuQ** (2025) | MERT-v2 reports beating it. Self-supervised, same class — test the winner. |
| **OMAR-RQ** (2025) | MTG's own paper puts it behind MAEST on tagging. |
| **PupuJEPA** (2026) | Listed as runner-up in MERT-v2 table, but weights availability unconfirmed. |
| **VGGish** | Tied last in our bench, 128d, outdated architecture. |
| **OpenL3** | Memory-heavy (48kHz), worst P@5 in our bench, no genre-specific training. |

### MuQ-MuLan — separate use case (text search, not classification)

MuQ-MuLan embeds audio and text into a shared space. Not useful for
classification, but useful for querying by description ("chopped vocal
house", "dark rolling techno") to discover micro-genres or find MegaSet
transition candidates. Worth wiring as a separate tool, not in this bench.

---

## Stage A: Classifier (cached vectors, minutes per run)

The biggest lever isn't a new model — it's what sits on top. Run on
cached effnet vectors first (they already exist), then repeat the winner
on MAEST + MERT-v2 vectors in Stage C.

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| A1 | **Logistic probe vs raw kNN** on effnet section embeddings | Probe beats kNN by several pp; class balancing fixes majority bias (House 838 vs Trance 84) | Very low |
| A2 | **Class-balanced kNN** (inverse-frequency weighted voting) | Fixes the 0% pop/bass/trance without changing the model | Very low |
| A3 | **Aggregation: soft-vote vs best-of-3 vs confidence-weighted** | Soft-vote over all chunk embeddings is more stable than picking highest agreement | Very low (cached) |
| A4 | **Pooling: mean+std (+ max) concatenated, then probe** | Captures within-track variation (build vs drop) in a single vector | Very low |

**Protocol:** 5-fold CV, artist-excluded, Holm correction, macro-F1 + accuracy
with bootstrap 95% CIs. n≥300 (use the full 4,118 seed corpus for effnet).

---

## Stage B: Chunk Geometry (one re-embed pass, then cached)

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| B1 | **PSSI phrase-aligned chunks** (Drop/Chorus sections from `anlz.ts`) | Phrase-aligned body chunks beat arbitrary position windows — already parsed | Medium |
| B2 | **RMS-loudness drop finder** vs position-only | Real energy peaks are better than mid-track heuristic | Low |
| B3 | **30s clips** (for MERT-v2 compatibility) vs 32-bar windows | MERT-v2 was trained on 30s; matching training length may matter | Low |
| B4 | **Intro/outro exclusion** (first/last 8 bars always dropped) | Removes genre-ambiguous sections that dilute signal | Very low |

---

## Stage C: Three-Model Showdown (one embed pass per model)

Run with the Stage A winning classifier, NOT raw kNN. This is the
core experiment — every other stage feeds into it.

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| C1 | **MAEST fixed: middle blocks + stacked tokens + probe** | The 0.000 cosine gap in our bench was a configuration bug. With correct pooling + a probe, MAEST should compete or win (its training data matches our genres). | Medium |
| C2 | **MERT-v2-30s: layer 19 + layer 23 sweep + probe** | Newest model, top benchmarks. Layer 19 for broad genre, layer 23 for fine. Needs 30s clips. | Medium-High (632M params, ~40× effnet compute) |
| C3 | **Late fusion: best pair, averaged probabilities** | Different training → different errors → complementary signal. Prediction: MAEST + MERT-v2. | Low (cached) |

### How to run the showdown

For each of the three models:
1. Compute section embeddings (best-of-3 drop windows) and cache in
   `section_embeddings` table. This is the only expensive step.
2. Train a logistic-regression probe on top (sklearn, L2-regularized,
   class-weight='balanced'). NOT raw kNN.
3. 5-fold CV, artist-excluded splits. Evaluate macro-F1 + accuracy with
   bootstrap 95% CIs.
4. ≥300 tracks minimum. Full population preferred.
5. Labels must not come from effnet (verified: §3 of report).

Then test the best pair fused (C3). If MAEST + MERT-v2 beats either alone
by >2pp with Holm-corrected significance, that's the production model.

---

## Stage D: Advanced (after A-C settle)

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| D1 | **Hierarchical: family first, then style within** | Better family accuracy, no impossible combinations. Needs Discogs/BP/SC L3 seeds. | Low |
| D2 | **Seed cleaning: drop XCV-disagreeing seeds, rebalance** | Removes label noise poisoning neighbours | Low |
| D3 | **Style-head stacking: MAEST 400-style outputs as probe features** | The classification head provides 400 soft probabilities — stack with embedding features. Discogs labels validate whether the head's predictions are correct. | Low |
| D4 | **Stem chunks: instrumental-only Demucs for vocal confusion** | Removes vocal-genre confusion (pop↔house↔edm) | Expensive |
| D5 | **Secondary genre from full probability spread** (~30 lines) | Section vectors naturally produce different votes — aggregate as confidence-ranked candidates. Needs Discogs multi-style ground truth for evaluation. | Very low |

---

## Cost and Time Budget

### Embedding compute (one-time, cache forever)

| Model | Params | s/track | 3 sections × 4,500 tracks | Storage |
|---|---|---|---|---|
| effnet-discogs-1280 | ~2M | ~1.7s | ~3.8h (ALREADY CACHED) | ~22 MB |
| MAEST | ~85M | ~2.8s | ~6.3h Apple Silicon | ~55 MB |
| MERT-v2-30s | 632M | ~8-12s (est) | ~12-18h CPU, ~4-6h MPS | ~175 MB |

### Classifier experiments (on cached vectors)

Every probe/aggregation/fusion test: **<5 minutes** on cached embeddings.
This means Stage A (4 experiments) + Stage C fusion (1 experiment) = ~25min.

### Total cost to reach a verdict

```
Day 1: Stage A on cached effnet vectors (30min)
Day 2: Embed MAEST sections (overnight, ~6h)
Day 3: Embed MERT-v2 sections (overnight, ~6-18h depending on MPS)
Day 4: Stage C showdown on cached vectors (30min) + fusion (15min)
```

**Four days to a defensible model comparison.** Everything after Day 1 is
background compute + minutes of classifier experiments.

---

## Evaluation Protocol (non-negotiable)

- **n ≥ 300** (full population preferred, minimum stratified 300)
- **5-fold CV**, artist-excluded (no same-artist tracks in train+test)
- **Macro-F1** (primary), accuracy (secondary), per-class recall
- **Bootstrap 95% CIs** on both metrics
- **Holm correction** within each stage's comparisons
- Report seed counts per family alongside metrics
- Logistic-regression probe (L2-regularized, balanced class weights),
  NOT raw kNN (kNN only as a sanity-check baseline)

---

## Predictions

### L2 Family

1. **A1 (probe) will beat current 58% by +5-10pp WITHOUT source expansion,
   +10-15pp WITH.** Class balancing alone fixes the 0% minority families.

2. **MAEST (fixed) + probe will match or beat effnet on L2.** Same Discogs
   training data, but the transformer architecture captures longer-range
   structure. Once probed correctly, its advantage shows.

3. **MERT-v2 + probe will be competitive but may not lead on electronic.**
   It tops general benchmarks, but its training isn't genre-specific like
   effnet/MAEST. On electronic sub-genres specifically, MAEST may have an
   edge from its Discogs-style supervised training.

4. **MAEST + MERT-v2 fusion will be the overall winner.** Supervised
   (MAEST) × self-supervised (MERT-v2) = complementary errors. Different
   training → different mistakes → +2-5pp from fusion.

5. **B1 (PSSI phrases) will widen per-family gap.** The position-only drop
   finder misses actual drops in ~30% of tracks. PSSI phrase labels are RB's
   own analysis — they know where the drop is.

### L3 Primary subgenre (requires source expansion)

6. **D1 (hierarchical family→style) with Discogs-enriched seeds will
   reach ~55-60% L3 top-1.** The Discogs-400 head already provides zero-shot
   signal — a trained probe within each family using Discogs styles as
   ground truth should clear 55%.

### L3 Secondary (requires source expansion)

7. **D5 (secondary from probability spread) will reach ≥60% recall on
   Discogs-multi-style ground truth.** Section vectors naturally produce
   different family votes per chunk — aggregate as confidence-ranked
   candidates. But needs multi-style ground truth to evaluate honestly.

---

## Priority Order

```
Phase 0: Source expansion (key dependency — separate work stream)
  Wire Last.fm (S, <1 day)       → fixes 0%-recall families
  MB AcoustID→MBID (S)           → exact identity, clean labels
  MB recording-level tags (S)    → thicker evidence per track
  SC tags + sanitizer (M)        → L3 subgenre + mood signal
  Discogs dump ingest (M+M)      → 400-style L3 ground truth + secondary

Phase 1: Classifier on cached effnet (CAN START NOW — no dependencies)
  A1 + A2 (probe + balance)      → 1 session, biggest expected L2 gain
  A3 + A4 (aggregation)          → 1 session on cached vectors

Phase 2: Embed new models (background compute)
  P5 (MAEST sanity check)        → fix pooling before full embed
  Embed MAEST sections            → overnight (~6h)
  Embed MERT-v2-30s sections      → overnight (~6-18h)
  Cache all in section_embeddings table

Phase 3: Three-model showdown (on cached vectors — minutes)
  C1 (MAEST fixed + probe)       → the Discogs-style candidate
  C2 (MERT-v2 + probe)           → the general-purpose champion
  C3 (fusion: best pair)          → predicted winner: MAEST + MERT-v2

Phase 4: Geometry + chunk optimization
  B1 (PSSI phrases)              → 1 session (already parsed in anlz.ts)
  B3 (30s clips for MERT-v2)     → match training length
  P6 (RMS drop finder)           → replace position heuristic

Phase 5: Three-level classification (after source expansion lands)
  D1 (hierarchical family→style) → L3 primary
  D5 (secondary genre)           → L3 secondary
  D3 (style-head stacking)       → validate MAEST Discogs-400 head
```
