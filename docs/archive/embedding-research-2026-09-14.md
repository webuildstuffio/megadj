# FullTags — Embedding & Genre Research Review (external deep-read, Sep 14, 2026)

> **🗄️ ARCHIVED 2026-09-15** — superseded by GitHub as the source of truth
> (issues + labels + Project board). Retained as historical evidence; do not
> update. Open work lives in [issues](https://github.com/webuildstuffio/megadj/issues).
**Status:** 📥 SNAPSHOT — an external research review (9 papers + model/checkpoint
landscape + Apple-Silicon compute audit) integrated into the FullTags plan the
same day. Verdicts below are cross-referenced against the measured docs; the
living plan of record is
[embedding-models](embedding-models.md) + [genre-audit](genre-audit.md) §5b +
[10-findings](../set/10-findings.md) §3. This page is the dated evidence
base and the full resource list — it does not drift; updates land in the live
docs with a pointer back here.

> Glossary (tower, LOO, kNN, probe, CSLS, hubness, SupCon):
> [10-findings §5](../set/10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

**Inputs treated as given:** the v2 tower rerun (n=180, 0 fails) and the
fusion/variant sweep in [embedding-models](embedding-models.md); the v3 genre
revalidation in [genre-audit](genre-audit.md).

---

## 0. TL;DR — the five things that changed after reading

1. **Our absolute numbers are not as bad as they look.** The best published
   EDM-subgenre result — Academia Sinica, 75,000 songs, 30 subgenres,
   purpose-built CNN+ResNet with tempogram fusion — lands at **60.6%
   accuracy** (18× chance). Our 0.444 on 7 families is 3.1× chance. Headroom
   is real, but "90% genre accuracy" was never on the table for EDM.
   **Recalibrate the target to 0.65–0.75, not 0.9.**
2. **We probably measured MERT wrong, and the variant sweep tested the wrong
   axis.** MuQ's layer-wise analysis shows genre/structure peak at **higher**
   layers while key/pitch/instrument/singer peak **lower**; MARBLE probes
   _every layer_. Our three MERT variants all varied _time pooling_ and landed
   within 1 point — "the failure is the representation" was concluded without
   ever varying layer selection. We also benchmarked the 95M; the literature
   benchmarks MERT-v1-**330M**.
3. **"Should I fine-tune?" is answered empirically, on MuQ, by someone else.**
   MuQ-Eval ships frozen-encoder+MSE-head (A1), LoRA r=16 (A3a), and full FT
   of MERT-95M (A4). **The recommended checkpoint is A1 — the frozen one.**
   Full FT needed ~12 GB VRAM and didn't win.
4. **The architecture we'd propose already exists and is published.**
   TuneJury (arXiv:2606.17006): a **2.8M-parameter MLP head over frozen
   LAION-CLAP-Music + MERT-v1-330M embeddings**, pairwise-logistic objective,
   ~17.5K human A-vs-B preferences. Frozen towers + tiny head + preference
   data is a validated recipe (Donahue, Mitsufuji et al.).
5. **Stem-weighted similarity works, needs ~330 labels, and Demucs artifacts
   beat ground truth** (86.8% → **90.4%** on MuQ-MuLan ABX). **But** it only
   helped MuQ — CLAP got _worse_ with stems, and effnet is architecturally
   closer to CLAP. Test on 200 tracks before paying the Demucs bill.

**The label-noise ceiling math (the reframe everything hangs on).** Our audit
measures labels at p ≈ 0.68 audio-consistent. Under _random_ label noise with
7 classes, plurality-of-5 noisy votes recovers truth ~85% of the time → LOO
ceiling ≈ 0.68 × 0.85 ≈ **0.58**. effnet at 0.444 is already ~77% of that
maximum: ~14 points of headroom in this basin, not 40 — which is also why all
fusion deltas were 1–2 points. **But that only holds if the noise is random.**
If mislabels are _systematic_ (a whole imprint filed wrong, tech-house
consistently bucketed as house), it's a consistent relabelling kNN tracks
fine — no ceiling, and the "we're capped by labels" story is wrong. **The
diagnostic that decides everything: group label errors by artist / release /
imprint.**

---

## 1. Calibration — what is actually achievable

| Reference point                      | Task                                    | Data                 | Result       |
| ------------------------------------ | --------------------------------------- | -------------------- | ------------ |
| Hsu/Chen/Yang 2021 (Academia Sinica) | 30-way EDM subgenre                     | 75,000 songs         | **60.6%**    |
| MuQ_iter, MARBLE                     | 10-way GTZAN genre, linear probe        | 160K h pretrain      | 85.6%        |
| MERT-v1-330M, MARBLE                 | 10-way GTZAN genre, linear probe        | 160K h               | 78.6%        |
| MuQ-MuLan zero-shot                  | MagnaTagATune top-50 tags               | 130K h               | ROC-AUC 79.3 |
| MuQ-MuLan cosine                     | Perceptual ABX, full mix, all-different | —                    | 72.4%        |
| MuQ-MuLan + 6-stem ridge             | Same                                    | ~330 triplets to fit | **90.4%**    |
| **megadj v2, effnet**                | **7-way EDM-heavy family, frozen kNN**  | **3.5K library**     | **44.4%**    |

**Read:** GTZAN's 10 classes span _super_-genres (blues/classical/metal/
reggae). Our 7 are mostly _within_ one (house/techno/trance/edm). **The
correct comparator is the 60.6% row, not the 85.6% row.** Corollaries:

- EDM subgenre is intrinsically hard and the field knows it. 0.444 is a
  mediocre readout of a decent tower, not evidence of a broken tower.
- The realistic local-max target is **0.65–0.75**, and the path there is
  **readout + taxonomy + labels**, not a bigger encoder.

---

## 2. Model landscape — what's trained on what

### 2.1 The current frontier

| Model                           | Params | Arch                                        | Sample rate                           | Pretrain data                               | MARBLE avg        |
| ------------------------------- | ------ | ------------------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------- |
| **MuQ** (Tencent AI Lab / SJTU) | 310M   | 12-layer Conformer                          | 24 kHz, 128-d Mel → 25 Hz, 30 s fixed | Music4all 0.9K h → in-house 160K h          | 76.7              |
| **MuQ_iter**                    | 310M   | same + iterative Mel-RVQ refinement         | same                                  | 160K h                                      | **77.0**          |
| **MuQ_m4a**                     | 310M   | same                                        | same                                  | Music4all **0.9K h only**                   | 75.8              |
| **MuQ-MuLan**                   | 630M   | MuQ + xlm-roberta-base + 8 Tx layers, d=512 | 10 s audio                            | 130K h music+text pairs                     | ROC 79.3 (MTT ZS) |
| **MERT-v1-330M**                | 330M   | HuBERT-style MLM                            | 24 kHz                                | up to 160K h, 8 EnCodec codebooks + CQT aux | 74.4              |
| **MERT-v1-95M**                 | 95M    | same                                        | 24 kHz                                | same                                        | —                 |
| **MusicFM**                     | ~330M  | BEST-RQ random-projection quantizer         | —                                     | MSD                                         | 75.4              |
| **discogs-effnet** (ours)       | ~5M    | EfficientNet-B0                             | mel                                   | Discogs 2M tracks, tag supervision          | —                 |

**The headline result:** `MuQ_m4a`, trained on **0.9K hours** of open data,
already beats MERT (160K h) and MusicFM. A 180× data disadvantage and it still
wins — the lever was the _target_ (trained Mel-RVQ, 8 residual codebooks), not
the data. Ablations: trained VQ vs random VQ = **+2.8 avg**; 8 codebooks >
4 > 1; making the Mel-RVQ encoder deeper made it **worse** (single linear
layer optimal).

### 2.2 MuQ training cost (scale calibration)

- Mel-RVQ tokenizer: <0.3M params, 1 GPU, **<1 hour**.
- MuQ pretrain: 32× A100-40G, batch 192, mask p=0.6 — ~2 weeks wall-clock.
- MuQ-MuLan contrastive: 32× V100-32G, batch 768, 10 s clips.

Call it ~10,000 A100-hours. **We consume these, we don't train them.**

### 2.3 HuggingFace: what's actually there

**Base encoders**

- `m-a-p/MERT-v1-95M`, `m-a-p/MERT-v1-330M` — HF Transformers format, plus
  **fairseq checkpoints in the same repos** for continual pretraining.
  `m-a-p/MERT-v0-public` is the Music4all-only variant (cleanest license).
- `tencent-ailab/MuQ` (GitHub) — MuQ + MuQ-MuLan checkpoints, `pip install
muq`. Open release is the **Music4all 900h** variant, not the 160K-hour one.
- LAION-CLAP `630k-audioset-best.pt` — the checkpoint the perceptual paper
  recommends for music.

**Downstream / derived work — evidence people build on these**

- `TuneJury/tunejury` — frozen CLAP+MERT-330M → 2.8M MLP head, pairwise
  preference. Also ships `tunejury_muq_leave_MA.pt` (MuQ-MuLan encoder swap).
- `zhudi2825/MuQ-Eval-A1` (+ `MuQ-Eval` for the LoRA variant) — quality
  scoring, frozen vs LoRA vs full-FT with bootstrap CIs.
- `nishitanand/FIGMA` (ACL 2026) — **fine-grained music retrieval from text
  specifying tempo, key, chord progression, beat/time signature**, MuQ
  encoder + E5 text. Closest published thing to a DJ query engine.
- `dekelzak/MERT-v1-95M-finetuned-DEAM_stripped_vocals` — the long tail as a
  **negative** example: naive full FT of MERT on a small set (lr 5e-5, batch
  1, grad-accum 8, 1 epoch) → R² −17.9.

**Have people fine-tuned these?** Yes, but the serious work is almost entirely
**frozen-encoder + trained head**, or LoRA. Community full-FT attempts on
small datasets are visibly bad. That pattern is our answer.

### 2.4 Licences (matters — we ship this)

| Weight                              | Licence      |
| ----------------------------------- | ------------ |
| MERT-v1-330M                        | CC-BY-NC 4.0 |
| MuQ / MuQ-MuLan                     | CC-BY-NC 4.0 |
| discogs-effnet, msd-musicnn, openl3 | CC BY-NC-SA  |
| LAION-CLAP-Music                    | CC0 1.0      |
| audioset-vggish                     | Apache 2.0   |

Everything strong is non-commercial. Our stack is already NC, so no
regression — but if webuildstuff ever monetizes CrateDeck, **CLAP (CC0) and
VGGish (Apache) are the only clean towers we have**, and CLAP measured worst.
Worth knowing now rather than later.

---

## 3. Compute: what things actually cost, and the MLX question

### 3.1 Cost table (M-series, single-threaded unless noted)

| Job                                                           | Cost                                         | Notes                                    |
| ------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| effnet embed, full 3.5K library                               | **~33 min** (0.56 s/track), ~5 min multicore | harness exists                           |
| Full-population LOO cosine, n=3,500                           | **seconds**                                  | 3500² float32 = 49 MB numpy              |
| Whitening + CSLS over that matrix                             | **seconds**                                  | ~10 lines                                |
| Logistic-regression probe, 3,500 × 1280                       | **<10 s**                                    | sklearn, CPU                             |
| Linear projection head (1280→256), SupCon/triplet, 100 epochs | **1–3 min**                                  | CPU fine                                 |
| Stem-weight ridge (7 features, ~330 triplets)                 | **<1 s**                                     | the published method verbatim            |
| Demucs htdemucs_6s over 3,500 tracks                          | **~6–12 h** (est.)                           | the one expensive preprocessing step     |
| MERT-95M full fine-tune                                       | ~12 GB VRAM (MuQ-Eval measured)              | rent a GPU-hour, don't do it locally     |
| MuQ-310M LoRA r=16                                            | materially less                              | still a GPU job                          |
| Human labelling, 3,500 tracks naive                           | 10–20 h                                      | the actual bottleneck                    |
| Human labelling, active-learned to ~600                       | **4–6 h**                                    |                                          |
| ABX triplets, 330 judgments                                   | **~1 h**                                     | enough to fit stem weights per the paper |

### 3.2 MLX / Mac verdict — split three ways

**(a) Head training — probe, projection, stem weights, pairwise head.**
Yes, trivially, and **MLX is the wrong tool.** The whole training set is
3,500 × 1280 float32 = **18 MB**. scikit-learn / numpy on CPU finishes in
seconds. Reaching for a GPU framework here is pure overhead. **~90% of the
available gain lives here.**

**(b) Fine-tuning MERT or MuQ.** No MLX port exists; porting a Conformer is
_precedented_ (the NVIDIA Canary-SpeechLM MLX port implements Conformer
blocks, relative attention and projection layers, validated against
PyTorch/NeMo within fp16/fp32) — but it's a multi-day project. The practical
Mac path is **PyTorch MPS**, not MLX: one benchmark has MPS _training_ at
10–14 s/epoch vs MLX 21–27 s (MLX wins single-item inference), and the
Apple-Silicon profiling paper notes MPS still lacks some training-side
optimizations while MLX gains only ~20–30% from FP16. **Verdict: don't
fine-tune; if ever, rent an hour of A10/T4 for ~$1–3.**

**(c) Inference.** MLX could be a large win — RVC-MLX reports **8.71×
faster full-pipeline inference than PyTorch MPS** — but we're on ONNX Runtime
at 0.56 s/track, already fine for 3.5K-track batches. `mlx-audio` exists
(TTS/STT) but nothing for music embeddings. **Revisit only for a real-time
on-device "sounds like" feature in CrateDeck.**

**Bottom line: MLX is a multi-day detour away from the work that pays.**

---

## 4. Methodological findings against our v2 table (F1–F6)

| #      | Finding                                                                                                                                                                                                                                                                           | Confidence        | Action                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1** | **The MERT rejection is unsafe.** Our 3 variants moved _time pooling_; the axis that matters for genre is **layer depth** (MuQ layer-wise: semantic peaks high, acoustic low; MARBLE probes every layer). We benchmarked the 95M; the literature uses the 330M.                   | high              | Before "measured and rejected" stands: re-extract per-layer, probe each. ~1 h. Confirms or overturns.                                      |
| **F2** | **Artist leakage is unmeasured.** Nothing in v1/v2 excludes same-artist/same-release neighbours from LOO. discogs-effnet is trained on Discogs metadata — structurally the tower most likely to win by artist fingerprinting (Sturm's "horse" critique; GTZAN artist repetition). | high (it matters) | Report the share of top-5 neighbours sharing artist/release. If >15%, rerun LOO artist-disjoint. Expect effnet to fall; table may reorder. |
| **F3** | **Our two metrics are ~one metric.** LOO agreement and coherence@5 rank the six towers near-identically (~1.2 independent signals).                                                                                                                                               | high              | Add top-2 accuracy, neighbour BPM/key consistency, hubness statistic.                                                                      |
| **F4** | **Hubness is probably costing retrieval points, untested.** The perceptual paper names it explicitly for bag-of-frames-style similarity; contrastive spaces are strongly anisotropic. We never mean-centred, whitened, or applied CSLS.                                           | high              | Plot k-occurrence distribution. A few tracks at 40+ occurrences = confirmed; fix is ~10 lines.                                             |
| **F5** | **The reciprocal-rank row is unverified.** We fixed a descending-sort sign bug in that path; proper RRF (1/(k+rank), k=60) is normally ≥ mean-cosine, not 3.3 pts worse. And best fuser = z-scored cosine is the standard tell that raw per-tower scales are incomparable.        | medium            | Re-run RRF with the fixed comparator before trusting the fusion verdict.                                                                   |
| **F6** | **Balanced eval, unbalanced library.** Eval is 28/family by construction; the real 3,500 is likely 60%+ house/techno. Tuning on balanced miscalibrates deployment.                                                                                                                | high              | Report balanced _and_ natural-prior accuracy.                                                                                              |

---

## 5. The ranked plan (external; integration verdicts in §8)

### Tier 0 — diagnostics (do first; they decide everything below)

| #   | Action                                             | Cost   | Why                                                                                                                                                                                      |
| --- | -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Cluster label errors by artist / release / imprint | 1 h    | If systematic, the "0.58 label ceiling" story is **wrong** and relabelling buys ~nothing; if random, refold/active-labelling is worth points. Decides whether #7 is worth 8 points or 1. |
| 0.2 | Artist-overlap rate in top-5 neighbours            | 1 h    | F2. Decides whether the v2 tower table is real.                                                                                                                                          |
| 0.3 | k-occurrence / hubness histogram                   | 30 min | F4. Decides whether #3 is nearly-free points.                                                                                                                                            |
| 0.4 | Confusion matrix + top-2 accuracy                  | 1 h    | Tells whether the 0.556 error mass is the house/techno/trance triangle (expected) or structural.                                                                                         |

### Tier 1 — the local maximum (violates none of our parked decisions)

> **effnet-1280, mean-centred + whitened, CSLS retrieval, linear probe for
> genre, 6-family taxonomy (edm umbrella arbitrated), active-learned labels.**
> Estimated landing: **0.66–0.74 genre / meaningfully better coherence.** One
> weekend of code + ~5 h labelling. Zero new models, zero second ledger, zero
> change to batch inference cost. **Still effnet-only, single-tower, one
> ledger.**

| Rank | Action                                                                                                                                                                           | Cost      | Est. delta                                                             | Conf.              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- | ------------------ |
| 1    | **Kill `edm` as a sibling class** — it's an umbrella over house/techno/trance/bass; every plain-`edm` track is a forced error. Arbitrate via the B1-style head+kNN dispute pass. | 1 h       | +6–12 pt                                                               | High               |
| 2    | **Artist-conditional LOO**                                                                                                                                                       | 2 h       | negative on paper, but converts a possibly-fake number into a real one | High               |
| 3    | **Mean-centre + whiten + CSLS** (or all-but-the-top, Mu & Viswanath ICLR'18)                                                                                                     | 1 h       | +3–8 pt _coherence_                                                    | High               |
| 4    | **Linear probe replaces kNN — genre only**                                                                                                                                       | 4 h       | +12–20 pt                                                              | High               |
| 5    | **Full-population LOO, n=3,500**                                                                                                                                                 | 40 min    | 0 pt, but ±6 → ±1 error bars                                           | Certain            |
| 6    | **Projection head, SupCon/triplet, 1280→256**, hard negatives from the 4/4 triangle                                                                                              | 1 day     | +8–15 pt **on both metrics**                                           | Med-High           |
| 7    | **Active-learned label refold to ~1,500–2,000**                                                                                                                                  | 5 h human | +3–8 pt                                                                | Med (gated by 0.1) |
| 8    | **Tempogram + BPM + rhythm-pattern concat**                                                                                                                                      | 1 day     | +3–7 pt on EDM families                                                | Med-High           |

**The distinction our docs were missing:** `megadj genre` is
_classification_ → the probe fixes it. Set "sounds like" is _retrieval_ →
the probe does nothing; whitening/CSLS and the projection head do. Treating
these as one problem measured by two correlated metrics is why the benchmark
stalled.

### Tier 2 — basin jumps, ranked by return

| Rank | Idea                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                               | Cost                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| J1   | **Crate co-occurrence as supervision.** Playlist membership, My Tags, set history → millions of implicit pairs, free, encoding what we actually mix rather than a genre proxy. Sidesteps the 0.58 ceiling entirely (stops optimizing against the noisy variable).                                                                                                                                           | Slaney/Weinberger/White ISMIR'08; West & Lamere 2006 — metric learning from listening history is the original solution | days, no labelling                     |
| J2   | **Pairwise ABX preference head on frozen towers.** 2.8M MLP, pairwise-logistic loss. Also the live-eval stance: 100 A/B "which list would I actually mix" judgments beat another 10K kNN evaluations.                                                                                                                                                                                                       | TuneJury (17.5K prefs); perceptual paper fits useful weights from ~330 triplets                                        | ~1 h labelling + 1 day                 |
| J3   | **Stem-weighted similarity: Demucs htdemucs_6s → per-stem embed → ridge weights.** Drums is the top non-mix stem (w=0.83; mix still dominates w=1.64).                                                                                                                                                                                                                                                      | 86.8 → **90.4%** measured; Demucs stems beat ground-truth stems                                                        | 6–12 h preprocessing + 1 h labelling   |
| J4   | **Transition-point embeddings** — embed intros/outros separately, outro→intro index. DJs mix 32-bar sections, not tracks. **Our version is cheaper than the review thinks: the Essentia patch towers already emit per-~3 s patch embeddings before mean-pooling — pool only first/last-N-second patches with the existing harness, and the cues ledger (32-bar phrases) tells us where those windows are.** | Hsu et al. motivate their paper by DJ set transitions; nobody has built the index                                      | days (ours: S–M, reuse patches + cues) |
| J5   | **Text-query retrieval via MuQ-MuLan / FIGMA** — "punchy tech-house, 126, minor key."                                                                                                                                                                                                                                                                                                                       | FIGMA (ACL 2026) retrieves on tempo/key/chord/time-signature                                                           | GPU-ish                                |
| J6   | **Swap to MuQ.** Highest ceiling, worst cost/benefit on CPU — 310M Conformer, no first-class ONNX, no small "base" size yet.                                                                                                                                                                                                                                                                                | MARBLE 77.0 avg                                                                                                        | park it                                |

**Caveats on J3 before building:** the gain was **MuQ-specific** (CLAP got
_worse_, 84.6 → 83.2; effnet is closer to CLAP's situation) — **test on 200
tracks before paying the 6–12 h Demucs bill**; the authors flag Slakh weights
may be idiosyncratic (refit on our library, don't copy numbers); stems are
_additional_ features, never a replacement for the whole-mix embedding.

---

## 6. Integration verdicts (what we actually adopt, Sep 14)

Each external item, mapped to our docs and code. `ADOPT` = goes on the live
plan; `ADAPT` = adopted in modified form; `PARK` = recorded, gated, not
scheduled.

| Ext. item                           | Verdict                              | Where it lands / why                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1–0.4 Tier-0 diagnostics          | **ADOPT**                            | New G14–G17 work items ([genre-audit](genre-audit.md) §5b.3 step 0); 0.4 rides `genre --eval` (confusion matrix + top-2 are ~20 lines there).                                                                                                                                                                                                                               |
| Recalibrate target 0.65–0.75        | **ADOPT**                            | Replaces the "gated ≥65% post-refold" single number as the _band_ target; ≥65% stays the ship gate. [embedding-models](embedding-models.md) + [genre-audit](genre-audit.md) §5b.3.                                                                                                                                                                                          |
| #1 `edm` umbrella arbitration       | **ADOPT**                            | Extension of the already-flagged B1 (`dance`→edm least-wrong): same head+kNN dispute pass, applied to the plain-`edm` block (353 tracks). Keep `edm` family for genuinely-hard EDM (hard-dance/eurodance/nightcore) — **hardtekk and friends are explicitly kept** (user call, matches §4 of taxonomy: Tier-1 display keeps everything). [genre-audit](genre-audit.md) §5b. |
| #2 artist-disjoint LOO              | **ADOPT**                            | `genre --eval --artist-disjoint` mode + one-shot overlap census. [genre-audit](genre-audit.md) §5b.1 note.                                                                                                                                                                                                                                                                  |
| #3 whiten + CSLS                    | **ADOPT**                            | `src/archive/similar.ts` retrieval path (flag-gated `--space raw                                                                                                                                                                                                                                                                                                            | whitened`, A/B-able). F4 histogram first. |
| #4 linear probe for genre           | **ADOPT** (experiment first)         | `genre --eval --probe` mode; promotion gate identical to the tower gate: probe must beat kNN vote by ≥3 pts on the guarded population to become the production readout.                                                                                                                                                                                                     |
| #5 confusion matrix + top-2         | **ADOPT**                            | `genre --eval` output.                                                                                                                                                                                                                                                                                                                                                      |
| #6 projection head (SupCon/triplet) | **ADAPT**                            | Parked behind #3+#4 results — it's the retrieval-side payoff; single ledger still (a 256-d _derived_ view of the same vectors, not a second model).                                                                                                                                                                                                                         |
| #7 active-learned refold            | **ADAPT**                            | Merge with the existing refold + LLM-residue plan: the refold is mechanical (already queued); active learning concentrates _human_ hours on the low-margin tail. Gated by 0.1's verdict. Also add the review's **imprint prior** (Drumcode→techno, Anjuna→trance) as free high-precision seeds.                                                                             |
| #8 full-population tower LOO        | **ADOPT**                            | `tools/emb_benchmark.py` already caches `vecs_*.npy` — run the full 3.5K matrix instead of n=180. Error bars ±6 → ~±1.                                                                                                                                                                                                                                                      |
| F1 MERT per-layer re-test           | **ADOPT**                            | ~1 h; before the MERT rejection is quoted as final. Uses the HF transformers features (hidden states), no ONNX needed for a research verdict.                                                                                                                                                                                                                               |
| J1 crate co-occurrence              | **PARK** (unchanged from "Not next") | We have too little mixed-set history yet; revisit when rekordbox play/playlist history accumulates. The MegaMem search side already gives _text_ co-occurrence, not crate co-occurrence.                                                                                                                                                                                    |
| J2 pairwise ABX head                | **PARK**                             | Real but needs human-preference data collection; the live A/B eval stance is recorded as the cheaper first step.                                                                                                                                                                                                                                                            |
| J3 stems                            | **PARK** with a 200-track test gate  | MuQ-specific caveat + effnet-closer-to-CLAP note recorded; do not pay the Demucs bill without the 200-track probe.                                                                                                                                                                                                                                                          |
| J4 transition embeddings            | **ADOPT (ADAPTed, cheaper)**         | Patch-level pooling over intro/outro windows using the **existing** tower + the **existing** cues/phrase ledger; no second model, no Demucs. Becomes the "sounds like the part you mix" feature.                                                                                                                                                                            |
| J5 text-query retrieval             | **PARK**                             | GPU-ish; NC licence; different product surface.                                                                                                                                                                                                                                                                                                                             |
| J6 MuQ                              | **PARK**                             | No ONNX, no small base; gate unchanged (ONNX export + ≥3 pt win on the guarded population).                                                                                                                                                                                                                                                                                 |
| MLX anything                        | **REJECT (for now)**                 | §3.2 — head training is a CPU sklearn job; fine-tuning is rented-GPU territory; inference is already fast enough.                                                                                                                                                                                                                                                           |
| Licence exposure note               | **ADOPT (recorded)**                 | §2.4 table lives here; CrateDeck monetization would force CLAP/VGGish — both measured weak. Flag for the pricing decision, not for today.                                                                                                                                                                                                                                   |

### 6.1 The user-directed additions (Sep 14, same session)

1. **Genre before set generation.** All of the above is ordered ahead of any
   further set-builder work — genre is the cheaper goal and the better input
   to pools ([10-findings](../set/10-findings.md) §3 reorder).
2. **Chunk-based similarity from cues** — the user's instinct, and it is J4:
   the cues ledger already stores 32-bar phrase boundaries (`src/fulltags/
cues.ts`, `grid-audit-plan` §structure); the patch models already emit
   per-window embeddings. **Intro/outro-window similarity is S–M with zero
   new models.**
3. **Bandcamp as a genre source + multi-source voting.** The genre ladder is
   currently `SC → Beatport → AI(opt-in)` (`tools/fetch-stages.ts`).
   Plan: add a **Bandcamp arm** (direct page fetch — yt-dlp's Bandcamp
   extractor is broken upstream since Aug 2026, but album pages expose the
   publisher tags + label cleanly) and make the ladder a **vote**: claims
   from {RB mirror, ingest pool (Bandcamp/Hypeddit), SC, Beatport, Bandcamp,
   Discogs-400 head, kNN consensus}, weighted by the measured trust table
   (G6: RB > ingest), kNN consensus as tie-breaker, disputes flagged —
   exactly the §5c disputed-pass design with two more arms. Web search
   (exa/brave) is a **research-harness** arm for the disputed residue only
   (imprint→scene confirmation feeding the LLM residue pass), never a
   runtime ladder dependency.
4. **Keep main + sub, deeper wins when possible, config later.** Already our
   design (§5b.2 ranked secondaries + "specificity at intake"); now explicit
   as a future **display-depth config** (`tier1` vs `tier1+tier3` display
   choice for the DJ). File-format reality: ID3v2.3 carries one TCON (slash-
   joined is the convention), so the **DB stays the multi-value SSOT**;
   file tags carry primary (current behavior).

---

## 7. Full resource list

### Core papers

1. **MuQ: Self-Supervised Music Representation Learning with Mel-RVQ** — Zhu
   et al., Tencent AI Lab/SJTU, AAAI 2025. arXiv:2501.01108. Code+weights:
   `github.com/tencent-ailab/MuQ`
2. **MARBLE: Music Audio Representation Benchmark for Universal Evaluation**
   — Yuan et al., NeurIPS 2023 D&B. arXiv:2306.10548.
   `github.com/a43992899/MARBLE-Benchmark` — **copy this protocol**
3. **MERT: Acoustic Music Understanding Model with Large-Scale Self-supervised
   Training** — Li et al., ICLR 2024. arXiv:2306.00107.
   `github.com/yizhilll/MERT`
4. **Interpretable and Perceptually-Aligned Music Similarity with Pretrained
   Embeddings** — Vohra et al., Jan 2026. arXiv:2601.19109 — _most directly
   relevant paper to Set_
5. **Deep Learning Based EDM Subgenre Classification using Mel-Spectrogram
   and Tempogram Features** — Hsu, Chen & Yang, Academia Sinica, 2021.
   arXiv:2110.08862 — _our exact problem, 60.6% on 30 classes_
6. **Disentangled Multidimensional Metric Learning for Music Similarity** —
   Lee, Bryan, Salamon, Jin, Nam. ICASSP 2020 — canonical
   conditional-similarity-network / per-facet metric paper
7. **Parameter-Efficient Transfer Learning for Music Foundation Models** —
   Ding & Lerch, arXiv:2411.19371
8. **TuneJury: An Open Metric for Improving Music Generation Preference
   Alignment** — Kim, Lee, Ma, Koo, Saito, Mitsufuji, Donahue, 2026.
   arXiv:2606.17006 — _the frozen-tower + tiny-head + pairwise-preference
   recipe_
9. **FIGMA: Towards Fine-Grained Music Retrieval** — ACL 2026.
   arXiv:2606.06615

### Supporting / methodological

- **Sturm**, _A simple method to determine if a MIR system is a horse_, IEEE
  TMM 2014 — artist-leakage critique (F2)
- **Sturm**, _The GTZAN dataset: its contents, its faults…_ 2013 — artist
  repetition
- **Mu & Viswanath**, _All-but-the-Top: Simple and Effective Postprocessing
  for Word Representations_, ICLR 2018 — anisotropy fix (Tier-1 #3)
- **Conneau et al.**, _Word Translation Without Parallel Data_ — CSLS, the
  hubness correction (Tier-1 #3)
- **Caparrini et al.**, _Automatic subgenre classification in an electronic
  dance music taxonomy_, JNMR 49(3), 2020
- **McCallum et al.**, _Similar but faster: manipulation of tempo in music
  audio embeddings_, ICASSP 2024
- **McCallum**, _Controllable embedding transformation for mood-guided
  music retrieval_, ICASSP 2026
- **Knees et al.**, _Two data sets for tempo estimation and key detection in
  EDM annotated from user corrections_, ISMIR 2015 — Giantsteps,
  EDM-specific, useful as an external validation set
- **Hashizume & Toda**, _Investigation of perceptual music similarity
  focusing on each instrumental part_, arXiv:2502.02138 — the Inst-Sim-ABX
  dataset
- **Imamura et al.**, _Music Similarity Representation Learning Focusing on
  Individual Instruments with Source Separation and Human Preference_,
  arXiv:2503.18486 — Cascade-PAFT
- **Rouard, Massa, Défossez**, _Hybrid Transformers for Music Source
  Separation_ (Demucs v4), arXiv:2211.08553
- **Feng et al.**, _Profiling Apple Silicon Performance for ML Training_,
  arXiv:2501.14925 — the MLX vs MPS numbers

### Code / checkpoints

- `tencent-ailab/MuQ` · `pip install muq`
- `m-a-p/MERT-v1-95M`, `m-a-p/MERT-v1-330M`, `m-a-p/MERT-v0-public` (+
  fairseq ckpts for continual training)
- `TuneJury/tunejury` · `github.com/yonghyunk1m/TuneJury`
- `zhudi2825/MuQ-Eval-A1` · `github.com/dgtql/MuQ-Eval` — frozen vs LoRA vs
  full-FT, with bootstrap CIs
- `nishitanand/FIGMA`
- `a43992899/MARBLE-Benchmark` — supports MuQ, MuQMuLan, MERT, CLaMP3,
  DaSheng
- `mlx-audio`, `ml-explore/mlx` · `speechllms/canary-speechlm-mlx`
  (Conformer-in-MLX reference)

---

## 8. If we only do three things first

1. **Tier-0 diagnostics 0.1–0.4** (~4 h). They decide whether the rest of
   this page is worth 20 points or 5.
2. **Arbitrate the `edm` umbrella, run the probe, run full-population LOO**
   (~1 day). Highest points-per-hour on the page.
3. **Re-extract MERT per-layer before letting the rejection stand** (~1 h).
   Cheapest way to find out whether our headline "MERT is measured and
   rejected" conclusion is sound.

Everything else — stems, fusion, second ledgers, MuQ, MLX — stays parked
until those three land.

