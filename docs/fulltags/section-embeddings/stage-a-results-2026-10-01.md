# Stage A Results — Classifier Experiments on Cached Effnet (Oct 1, 2026)

**Status:** COMPLETE. Run on 3,123 tracks, 5-fold artist-excluded CV.

## Key Finding: Real Baseline is ~34-37% Macro-F1

The prior section bench reported 58% accuracy on 100 tracks with LOO.
Proper evaluation reveals the **real performance** is dramatically lower:

| Method | Macro-F1 | Accuracy | Notes |
|---|---|---|---|
| kNN k=5 (current prod) | 33.5% | 45.6% | Zeros minorities |
| kNN k=7 (best k) | 34.8% | 47.9% | Best kNN setting |
| Logistic probe balanced C=10 | 35.9% | 43.9% | Fixes minorities, hurts majorities |
| **Logistic probe unbalanced C=10** | **37.3%** | **51.7%** | **Best overall macro-F1** |
| SVM RBF balanced C=10 | 37.1% | 49.0% | Competitive but slower |

## Why 58% → 34%?

The section bench's 58% was inflated by:
1. **LOO on n=100** = 99 training tracks per fold (more data → better)
2. **No artist exclusion** = same-artist tracks in train+test (data leakage)
3. **Accuracy not macro-F1** = hides minority failures

## The probe trades majority recall for minority recall

| Family | kNN k=5 | Probe balanced | Probe unbalanced | n |
|---|---|---|---|---|
| bass | 13% | 46% | 14% | 85 |
| edm | 52% | 35% | 51% | 769 |
| groove | 26% | 43% | 25% | 192 |
| hiphop | 62% | 61% | 60% | 348 |
| **house** | **54%** | **42%** | **70%** | 985 |
| mood | 0% | 5% | 0% | 19 |
| pop | 11% | 24% | 18% | 300 |
| techno | 48% | 68% | 56% | 358 |
| trance | 22% | 54% | 22% | 67 |

The balanced probe dramatically fixes minorities (trance 22→54%, bass 13→46%)
but at the cost of house (54→42%) and edm (52→35%).
The unbalanced probe gets best macro-F1 by finding a middle ground.

## The Real Problem: EDM/House/Techno Confusion Triangle

Top confusion pairs (unbalanced probe):

| True → Predicted | Count | % of true class |
|---|---|---|
| EDM → House | 250 | 33% |
| House → EDM | 173 | 18% |
| Techno → House | 101 | 28% |
| Pop → EDM | 95 | 32% |
| House → Techno | 83 | 8% |
| Pop → House | 74 | 25% |
| Groove → House | 57 | 30% |

**33% of EDM tracks get predicted as House.** This is the acoustic
similarity problem — effnet's whole-track embedding can't separate them.
Sections should help here (drops in EDM vs house sound different).

## C-sweep (balanced probe)

| C | Macro-F1 | Accuracy |
|---|---|---|
| 0.001 | 24.2% | 32.6% |
| 0.01 | 26.5% | 33.8% |
| 0.1 | 29.5% | 34.7% |
| 0.5 | 32.9% | 38.8% |
| 1.0 | 33.8% | 40.1% |
| 5.0 | 35.5% | 42.9% |
| **10.0** | **35.9%** | **43.9%** |
| 50.0 | 35.8% | 44.6% |

## kNN k-sweep (plain)

| k | Macro-F1 | Accuracy |
|---|---|---|
| 3 | 32.3% | 43.3% |
| 5 | 33.5% | 45.6% |
| **7** | **34.8%** | **47.9%** |
| 11 | 34.6% | 49.0% |
| 15 | 34.4% | 49.7% |
| 21 | 33.1% | 50.2% |
| 31 | 31.3% | 49.6% |

## Verdict

1. **Probe over kNN = +2.5pp macro-F1** (37.3% vs 34.8%) — meaningful but not huge
2. **The embedding ceiling is the bottleneck**, not the classifier
3. **Section embeddings + better models are the next lever** — the classifier
   can only do so much when EDM/House/Techno embed in the same region
4. **Mood (19 tracks) is dead** — needs source expansion or just merge into pop
5. **Production recommendation:** switch from kNN k=5 to unbalanced probe C=10
   for +3.8pp macro-F1 immediately (no re-embedding needed)

## Stage A+ UPDATE: Family Taxonomy Cleanup (Oct 1)

The "edm" family was 97% umbrella labels (EDM/Dance/Electronic = zero genre
info). After umbrella exclusion, only 24 Electro tracks remain — too few to
classify. Merging edm→house at training time:

| Config | mF1 (unbal) | mF1 (bal) | Δ from 9-fam clean |
|---|---|---|---|
| 9-fam clean | 36.5% | 36.4% | baseline |
| **8-fam (edm→house)** | **41.6%** | **40.9%** | **+5.1pp / +4.5pp** |
| 9v2 (+afrolatin) | 39.5% | 39.2% | +3.0pp |
| 11-fam (all splits) | 32.8% | 34.0% | −3.7pp |

**The biggest single gain so far** — +5.1pp from taxonomy cleanup alone.
Expanding families hurts (small classes). Implemented as `classifierFamily()`
in `genre-vocab.ts` (training-time only; DJ code keeps "edm" unchanged).

## Preliminary Section Embedding Results (474 tracks, Oct 1)

On the subset with both whole-track and section embeddings cached:

| Strategy | mF1 (unbal) | mF1 (bal) |
|---|---|---|
| whole_track_only | 38.5% | — |
| section_mean_only | 36.9% | — |
| section_mean+std | 37.0% | — |
| whole+sec_mean (concat 2560d) | 37.1% | 38.5% |
| whole+3sec (concat 5120d) | 38.0% | **39.0%** |

**Preliminary finding:** Sections alone are WEAKER than whole-track (−1.5pp).
Concatenating whole+sections doesn't help much. The position-based drop finder
may be picking wrong sections — P6 (RMS-based finder) is the fix. Full results
pending when all 3,094 tracks are cached (~2.5h remaining).

## P6 Results: RMS-Guided Drop Finder (Oct 1)

**189 tracks analyzed** with per-bar RMS loudness computation:

| Metric | Value |
|---|---|
| Sections moved (different from position-only) | 163/189 (86.2%) |
| **RMS picks louder section** | **141/163 (86.5%)** |
| RMS picks quieter section | 1/163 (0.6%) |
| Same loudness | 21/163 (12.9%) |

The position-only finder was wrong on **86% of tracks** — picking
genre-ambiguous quiet sections (intros, breakdowns) instead of the actual
energy peak (drop/chorus). The RMS-guided finder picks the right section
86.5% of the time with effectively zero regressions.

**Implementation:** Optional `rmsPerBar` parameter on `findDropSection`
and `findDropCandidates`. When supplied: RMS weight 0.50, position 0.35,
density 0.15. Without: backward-compatible original behavior (0.70/0.30).
`cache_section_embeddings.py --rms` enables the new path.

**Next:** Re-cache section embeddings with `--rms --force` and re-run the
section probe bench to measure the classification impact.
