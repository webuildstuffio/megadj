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
