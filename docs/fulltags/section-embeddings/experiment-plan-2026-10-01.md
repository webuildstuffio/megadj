# Section Embeddings — Experiment Plan (Oct 1, 2026)

**Status:** PLANNED — prerequisites first, then greedy stage-wise experiments.

**Prerequisite:** Seed-label audit DONE (report §3 — labels are from
SoundCloud/Beatport/file tags, not effnet). MAEST sanity check NOT done.

---

## Prerequisites (do first, cost: minutes)

| # | Task | Status |
|---|---|---|
| P1 | Seed-label source audit | ✅ Done — no circular eval |
| P2 | Fix McNemar CDF bug (chi2cdf implementation) | TODO |
| P3 | Add Holm correction for multiple comparisons | TODO |
| P4 | Report macro-F1 and per-class recall (not just accuracy) | TODO |
| P5 | MAEST sanity check: middle blocks, stacked tokens | TODO |
| P6 | Fix drop finder: use RMS loudness or PSSI phrases | TODO |

---

## Stage A: Classifier × Model (cached vectors, minutes per run)

The biggest lever isn't a new model — it's what sits on top.

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| A1 | **Logistic probe vs raw kNN** on effnet section embeddings | Probe beats kNN by several pp; class balancing fixes majority bias (House 838 vs Trance 84) | Very low |
| A2 | **Class-balanced kNN** (inverse-frequency weighted voting) | Fixes the 0% pop/bass/trance without changing the model | Very low |
| A3 | **Aggregation: soft-vote vs best-of-3 vs confidence-weighted** | Soft-vote over all chunk embeddings is more stable than picking a single best | Very low (cached) |
| A4 | **Pooling: mean+std (+ max) concatenated, then probe** | Captures within-track variation (build vs drop) in a single vector | Very low |

**Protocol:** 5-fold CV, artist-excluded, Holm correction, macro-F1 + accuracy
with bootstrap 95% CIs. n≥300 (use the full 4,118 seed corpus for effnet).

---

## Stage B: Chunk Geometry (one re-embed pass, then cached)

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| B1 | **PSSI phrase-aligned chunks** (Drop/Chorus sections from `anlz.ts`) | Phrase-aligned body chunks beat arbitrary windows — already parsed | Medium |
| B2 | **RMS-loudness drop finder** vs position-only | Real energy peaks are better than mid-track heuristic | Low |
| B3 | **16-bar vs 32-bar vs fixed 10s**, intro/outro excluded, 50% overlap | Smaller chunks capture more specific genre signals | Medium |
| B4 | **Intro/outro exclusion** explicitly (first/last 8 bars always dropped) | Removes the genre-ambiguous sections that dilute signal | Very low |

---

## Stage C: Model × Layer Sweep (one embed pass per model)

Test with the Stage A winning classifier, not raw kNN.

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| C1 | **MuQ layer sweep + probe** | MuQ (2025 self-supervised) beats effnet once probed at its best layer | Medium |
| C2 | **OMAR-RQ layer sweep + probe** | From MTG/Essentia team, 330k hours training | Medium |
| C3 | **MAEST fixed: middle blocks, 3 tokens stacked, + probe** | The 0.000 cosine gap was a configuration bug, not a model failure | Low |
| C4 | **Late fusion: effnet + best SSL model, averaged probabilities** | Different training → different errors → +2-5pp | Low |

---

## Stage D: Advanced (after A-C settle)

| # | Experiment | Hypothesis | Cost |
|---|---|---|---|
| D1 | **Hierarchical: family first, then style within** | Better family accuracy, no impossible combinations | Low |
| D2 | **Seed cleaning: drop XCV-disagreeing seeds, rebalance** | Removes label noise poisoning neighbours | Low |
| D3 | **Style-head stacking: MAEST 400-style outputs mapped to taxonomy** | Free zero-shot signal from the classification head | Low |
| D4 | **Stem chunks: instrumental-only Demucs for vocal confusion** | Removes vocal-genre confusion (pop↔house↔edm) | Expensive |
| D5 | **Secondary genre from full probability spread** (~30 lines) | Section vectors naturally produce different votes — aggregate as confidence-ranked candidates | Very low |

---

## How to Run Without a 5-Hour Grid

### Principle: embed once, probe many times

1. **Embed once.** Cache chunk embeddings for each model at the winning
   chunk geometry. This is the only expensive step (~1-3min per model per
   100 tracks for section embeddings; ~2-5h for full fleet per model).

2. **Run stages greedily, not as a full grid:**
   - Stage A first: classifier × aggregation on cached effnet vectors (minutes)
   - Stage B: chunk geometry for the Stage A winner (one re-embed, then cached)
   - Stage C: model sweep with winning classifier + geometry (one embed each)
   - Each stage runs in **minutes** on cached vectors

3. **Speed targets:**
   - The section-bench one-pass already does 100 tracks × 9 candidates in 39min
   - Cache section embeddings in `section_embeddings` table after first run
   - Skip recomputation on re-runs (check table, not /tmp)
   - Batch ONNX inference (multiple sections per forward pass)
   - Target: **<5min for any classifier/aggregation experiment on cached data**

### Evaluation Protocol (non-negotiable)

- **n ≥ 300** (full population preferred, minimum stratified 300)
- **5-fold CV**, artist-excluded (no same-artist tracks in train+test)
- **Macro-F1** (primary), accuracy (secondary), per-class recall
- **Bootstrap 95% CIs** on both metrics
- **Holm correction** within each stage
- Report seed counts per family alongside accuracy

---

## Predictions

1. **A1 (probe) will beat current 58% by +5-10pp.** Class balancing alone
   fixes the 0% minority families. A trained decision boundary beats raw
   cosine kNN on any reasonably arranged embedding space.

2. **B1 (PSSI phrases) will widen the per-family gap.** The position-only
   drop finder misses the actual drop in ~30% of tracks (those where the
   energy peak isn't in the middle). PSSI phrase labels are RB's own
   analysis — they know where the drop is.

3. **C1 or C2 (MuQ/OMAR-RQ + probe) will match or beat effnet.** The
   self-supervised models weren't given a fair test. With probing, their
   richer representations should compete.

4. **C4 (late fusion effnet + SSL) will be the overall winner.** Different
   training → different errors → complementary signal. This is the
   meta-finding from the v2 tower benchmark (embedding-models.md §v2:
   ensembles bought +1-2pp on raw kNN; with probing the gap should widen).

---

## Priority Order

```
P2-P6 (fix bugs/stats)     → 1 session
A1 + A2 (probe + balance)  → 1 session, biggest expected gain
A3 + A4 (aggregation)      → 1 session on cached vectors
B1 (PSSI phrases)          → 1 session (already parsed)
D5 (secondary genre)       → 30 lines
C1-C4 (model sweep)        → 1-2 sessions (embed + evaluate)
D1-D4 (advanced)           → per-experiment
```
