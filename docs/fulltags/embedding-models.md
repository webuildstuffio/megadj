# FullTags — Audio embedding model benchmark (Set §similarity consumer) (Sep 14, 2026)

**Status:** ✅ DECISION RECORDED — effnet confirmed primary by the v2 rerun
(six towers incl. MERT); fusion/variant sweep settled below, follow-up
implementation gated by the larger post-refold evaluation.

> Glossary (tower, LOO, coherence, effnet/musicnn/MERT, ONNX, 5k proj):
> [10-findings §5](../set/10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

**Reproduction (Sep 14, 2026, ~28 min, background).** Full 6-tower rerun
on `eval_set_v2.json` (180 tracks, 120 s cap) matched the recorded table
tower-for-tower to the fourth decimal (effnet 0.4444 / 0.3622; musicnn
0.3000 / 0.2922; mert 0.2556 / 0.2333; openl3 0.2722 / 0.2433; vggish
0.2778 / 0.2311; clap 0.2444 / 0.2500) — and the MERT window-statistics
variant reproduced at 0.2667. The full mean-cosine ensemble sweep
re-confirmed: best combo is `effnet+musicnn+mert` 0.4556 (+1.1 pt over
effnet alone) — inside noise, gate still closed. (The run's raw
rank-fusion ensemble block printed 0.02–0.12: that is the known
descending-rank trap documented below, not a new result.)

**Question.** We ship `discogs-effnet` (1280-d) as the "sounds like" tower. Is
there a better _free, local, ONNX_ tower for (a) genre-family inference and
(b) similar-track retrieval?

**Protocol.** One eval set — 80 real library tracks (10 per family × 8
families: house, techno, trance, edm, hiphop, dnb, pop, rock), all with
human labels from `archive.db`. Leave-one-out kNN family agreement
(majority vote, cosine) + top-5 neighbor family coherence + wall clock per
track on this M-series CPU. Same files, same splits, every tower. This is
exactly the metric our `megadj genre` kNN and Set "sounds like" rely on.

**Towers (all free, all local, all ONNX, CPU-only):**

| #   | Tower                                    | Dim  | Train data                              | License                |
| --- | ---------------------------------------- | ---- | --------------------------------------- | ---------------------- |
| 1   | discogs-effnet-bsdynamic (**incumbent**) | 1280 | Discogs 2M                              | CC BY-NC-SA            |
| 2   | msd-musicnn (200)                        | 200  | Million Song Dataset                    | CC BY-NC-SA            |
| 3   | openl3-music-mel128-emb512               | 512  | AudioSet music (audio-visual, self-sup) | CC BY-NC-SA            |
| 4   | audioset-vggish (**incumbent #2**)       | 128  | AudioSet                                | Apache 2.0             |
| 5   | clap-htsat-unfused (LAION)               | 512  | LAION-Audio-630k                        | Apache 2.0 (MIT model) |

Considered and rejected pre-benchmark: **MERT-v1-95M** (best published
numbers — 93.9% GTZAN-linear-probe — but 360 MB transformer, ~50 fps
frame output needing pooling, CC-BY-NC, and 10–30× slower per track than
effnet on CPU; wrong cost/benefit for a 3,700-track batch pipeline);
**PANNs CNN14** (2 GB, no first-class ONNX); **music2vec** (superseded by
MERT); **JukeMIR/MuLaP** (no maintained ONNX export).

## Results (80 tracks, LOO kNN, cosine)

| Tower                                   | LOO family agree (k=5) | LOO (k=7) | Family coherence @5 | s/track |
| --------------------------------------- | ---------------------- | --------- | ------------------- | ------- |
| **msd-musicnn-200**                     | **0.538**              | 0.463     | 0.323               | 1.60    |
| effnet-discogs-1280 (incumbent)         | 0.413                  | 0.400     | **0.335**           | 0.85    |
| openl3-music-512                        | 0.400                  | —         | 0.275               | 7.77    |
| vggish-128                              | 0.300                  | —         | 0.220               | 1.27    |
| clap-htsat-512                          | 0.213                  | —         | 0.175               | 0.50    |
| **ensemble effnet+musicnn** (mean-rank) | **0.463**              | —         | —                   | ~2.5    |

Reading:

1. **musicnn wins genre inference by +12.5 points** (0.538 vs 0.413) — it
   was trained on MSD _tag_ prediction, so its penultimate layer keeps
   timbre-genre information effnet's artist-collapsed tower partially
   discards.
2. **effnet wins retrieval coherence** (0.335 vs 0.323, basically tied) and
   is 2× faster. Its neighbors are also more _novel_ — only **0.324
   top-10 Jaccard overlap** with musicnn's neighbor lists. The two towers
   see genuinely different things in the same audio.
3. **The ensemble improves effnet but does not win genre.** Mean-rank fusion
   reaches 0.463: +5.0 points over effnet, but **7.5 points below musicnn**.
   The low overlap makes musicnn interesting as a diversity signal; it is not
   evidence that this ensemble should replace the stronger single tower.
4. OpenL3 is mid at 8× the cost. VGGish is dominated (we only keep it for
   valence/arousal, where it's the only game in town). CLAP is _worse than
   coin flip_ here — it's a text-alignment model, optimized to match
   captions, not to cluster music; zero-shot text-probe was its real use
   case, not kNN.

## Honest caveats

- n=80, one seed of `ORDER BY RANDOM()` — family agreement has ±5-6pt
  error bars at this n. The musicnn > effnet gap (12.5pt) is at the edge of
  significance; neither that ranking nor the weaker ensemble result is a
  sufficient production-switch gate without a larger post-refold rerun.
- Families are unevenly hard (hiphop/dnb/rock are easy; house/techno/trance
  boundary is genuinely fuzzy — that's the library, not the tower).
- Genre labels are the noisy ground truth we have; the [genre
  audit](genre-audit.md) measured them at ~60-76% audio-consistent. Any tower
  measured against them is
  capped by that ceiling. Towers could be re-ranked by retrieval-quality
  human eval later.
- Speed numbers are single-threaded CPU with per-track session reuse; batch
  runners would amortize differently.
- The historical table predates the harness fix that correctly maps failed
  embeddings from source rows into the compact valid-row matrix. Treat these
  numbers as provisional until the same eval set is rerun with the repaired
  harness and its `fails` count recorded.

## Decision & plan

> **Superseded in part by the v2 rerun below (2026-09-14).** The v1
> "musicnn is the measured candidate (0.538)" claim was a broken-harness
> artifact — the corrected metrics put effnet ahead on both metrics and
> the musicnn promotion gate stays closed. The effnet-primary decision
> below stands; the fusion/second-ledger steps below are parked pending
> the in-flight sweep. v1 numbers kept for the record only.

**Keep effnet retrieval-primary; validate musicnn before adoption:**

1. **Genre inference (`megadj genre`) stays on its current tower** until a
   larger post-refold rerun reproduces musicnn's lead. If it does, musicnn is
   the measured candidate (0.538 here); rank fusion ships only if it also
   beats musicnn, not merely the 0.413 effnet baseline.
2. **"Sounds like" (Set similar/set building) keeps effnet-primary**
   because it has the best measured retrieval coherence. Musicnn can be
   evaluated as a diversity re-ranker, but the current results do not justify
   a hard-coded interleave ratio.
3. **Re-benchmark after refold** ([genre audit §5b](genre-audit.md)): cleaner
   labels → tighter ceiling → re-measure; promote MERT only if the ensemble
   stalls
   below 0.55 AND the compute budget allows 10-30× slower batch runs.
4. **VGGish stays** for VA (no competitor at that price) and **CLAP stays
   out** (measured worst; text-probe niche is a different product).

### Implementation steps

- [ ] Re-run the repaired harness after the genre refold on a larger,
      recorded eval set; require zero unexplained failures and report the
      musicnn-vs-ensemble comparison directly.
- [ ] If musicnn passes that gate, add `msd-musicnn-1.onnx` to MODEL_FILES
      (url `autotagging/msd/msd-musicnn-1.onnx`, 3.2 MB).
- [ ] Python seam, after the gate: second tower in the same worker process; emit
      `embedding200` alongside `embedding` when `withEmbedding`.
- [ ] `archive.db` ledger: `track_embeddings_mnn` table (mirror of the
      1280-d ledger; 200-d rows).
- [ ] `megadj genre` selects the best validated genre tower; add rank fusion
      only if the rerun shows it beating musicnn. `similarTracks` may use the
      second ledger for a separately measured diversity re-rank.
- [ ] Backfill command: `megadj genre --backfill-mnn` (batch, resumable,
      ~1.6s/track × 3,400 ≈ 90 min once).
- [ ] Re-run this benchmark harness post-refold; store numbers here.

_Harness:_ `tools/emb_benchmark.py` (manual research harness; productize as
`megadj genre --eval-models` only after the evaluation protocol is pinned).

---

## v2 rerun — COMPLETE (2026-09-14, measured; supersedes v1)

> The post-harness-fix rerun landed (commit `3715e9f fix: correct
embedding benchmark metrics`), the fusion/variant sweep completed, and
> every [genre-audit](genre-audit.md) number was re-validated with duration
> guards, full-population LOO, bootstrap CIs and McNemar tests (v3, below).

### Protocol changes vs the v1 table above

- **n=180 (28/family × 7 families; dnb only had 12 qualifying tracks; rock
  dropped — v1's "rock" bucket was a pop-regex artifact).** Same LOO kNN
  (k=5, cosine) + top-5 coherence + s/track protocol; 120 s audio cap;
  `fails` now recorded per tower (**0 across all six**).
- 6th tower added: **MERT-v1-95m** (768-d, 30-s windows mean-pooled,
  ONNX export) — v1 rejected it pre-benchmark on cost; v2 measures it.
- Harness: `tools/emb_benchmark.py` adapters + metrics, driven by the
  ephemeral `/tmp/emb-bench/bench2.py` runner (research scratch, kept out
  of the repo); vec caches `vecs_*.npy` make the ensemble sweep cheap.

### Results (n=180, LOO kNN k=5, cosine) — COMPLETE, exit 0, 0 fails

| Tower                               | LOO family agree (k=5) | Coherence @5 | s/track | 5k-library proj. |
| ----------------------------------- | ---------------------- | ------------ | ------- | ---------------- |
| **effnet-discogs-1280 (incumbent)** | **0.444**              | **0.362**    | 0.56    | 0.8 h            |
| msd-musicnn-200                     | 0.300                  | 0.292        | 0.75    | 1.0 h            |
| vggish-128                          | 0.278                  | 0.231        | 0.75    | 1.0 h            |
| openl3-music-512                    | 0.272                  | 0.243        | 2.97    | 4.1 h            |
| mert-v1-95m-768                     | 0.256                  | 0.233        | 3.88    | 5.4 h            |
| clap-htsat-512                      | 0.244                  | 0.250        | 0.50    | 0.7 h            |

Readings:

1. **v1's musicnn lead did not survive the harness fix.** The corrected
   metrics put effnet **+14.4 points ahead on genre agreement** (0.444 vs
   0.300) _and_ +7.0 on retrieval coherence — the exact inversion of the
   provisional v1 table (musicnn 0.538 / effnet 0.413). v1's numbers were
   produced by the broken harness (invalid-row mapping) and are superseded.
2. **MERT at 7× effnet's cost scores 19 points worse.** The v1 "rejected
   pre-benchmark on cost" call is now measured and stands — **provisionally**:
   all three variants varied time-pooling; layer depth (the axis MuQ's
   layer-wise analysis shows matters for genre) was never varied, and the
   95M was benchmarked where the literature uses the 330M. The per-layer
   re-test is queued (research review F1) before the rejection is final.
3. **CLAP is last on agreement again** — consistent with v1; text-alignment
   towers don't cluster music. VGGish stays VA-only.
4. Caveats carry over from v1 (one seed, label ceiling ~60–76%, families
   unevenly hard) — but `fails=0` closes the invalid-row confound that
   made v1 provisional.

### Fusion & variant sweep — COMPLETE (2026-09-14, measured)

Ran over the cached per-tower vectors (`vecs_*.npy`, n=180, `fails=0`):

**Fusers (pairwise + triples, best of each family):**

| Fuser           | Best combo              | LOO k=5   | vs effnet alone (0.444) |
| --------------- | ----------------------- | --------- | ----------------------- |
| **mean-cosine** | **effnet+musicnn+mert** | **0.456** | **+1.1 pt**             |
| mean-cosine     | effnet+musicnn          | 0.450     | +0.6 pt                 |
| z-scored cosine | effnet+clap             | 0.461     | +1.7 pt                 |
| reciprocal-rank | effnet+musicnn+mert     | 0.411     | −3.3 pt                 |

(NB: naive descending-rank fusion is a trap — it silently selects the
_least_-similar neighbors; every rank-fused combo scored 0.02–0.12 until
fixed. Mean-cosine is the honest default and what the numbers below use.)

**MERT variants (is it pooling or representation?):**

| Variant                              | LOO k=5 | s/track |
| ------------------------------------ | ------- | ------- |
| mean-pool 30 s windows (v2 table)    | 0.256   | 3.88    |
| window-statistics 3072-d (μ/σ stack) | 0.267   | 6.35    |
| mid-60 s single window               | 0.267   | 3.19    |

Three pooling schemes within 1 point ⇒ **the failure is the
representation, not the pooling**. MERT stays out.

**Verdict:** ensembles buy **+1–2 points at 2–6× the batch cost and a
second/third ledger**. The gate (parked steps reopen) is: post-refold rerun
where effnet alone stalls below ~0.50 _or_ an ensemble leads effnet by
≥3 points on the guarded population. Neither holds today. `megadj genre`
and Set stay **effnet-only single-tower**; the second-ledger and
fusion implementation steps stay parked.

### Impact on the plan of record

- **Set B10p (embedding prior): effnet-only, weight ≤0.1** — unchanged
  from the re-ranked roadmap, now with v2 evidence instead of v1.
- **`megadj genre` kNN: stays on effnet.** The v1 "musicnn is the measured
  candidate" conclusion is withdrawn; the promotion gate (post-refold
  rerun) remains open for any tower that beats effnet by a real margin.
- **No second ledger, no `--backfill-mnn`, no fusion** until the sweep
  contradicts this — the corresponding v1 implementation steps are
  parked, not deleted.

### External research review (Sep 14, 2026) — readout & diagnostics added to the plan

An external deep-read of the tower landscape (MuQ/MARBLE/TuneJury/
EDM-subgenre literature, compute + licence audit) reviewed these v2
conclusions. **The effnet-primary decision stands** — but the review adds
items that change the _plan_, not the tower: Tier-0 diagnostics
(artist-leakage check on the LOO itself, hubness histogram, confusion
matrix + top-2, label-error clustering), a **linear-probe readout
experiment** for genre (literature-standard; kNN-on-raw-cosine is the
weakest readout), **whitening + CSLS** for the retrieval side, **target
recalibration to 0.65–0.75** (best published EDM-subgenre result: 60.6% on
30 classes with 75K songs), and a full-population LOO (error bars ±6 →
~±1). Also flagged: our MERT rejection varied time-pooling but never layer
depth (and used the 95M, not the 330M) — the rejection stays in force but
is quoted as _provisional_ until the ~1 h per-layer re-test. Full findings,
cost tables, licences, and the ranked ladder with adoption verdicts:
[embedding-research-2026-09-14](embedding-research-2026-09-14.md).

**Plan deltas (live):**

1. `genre --eval` gains `--probe`, `--artist-disjoint`, confusion-matrix +
   top-2 output, and a hubness histogram — the diagnostics are the next
   work, ahead of any further tower work. **✅ SHIPPED Sep 15 (measured
   verdicts: [tier0-diagnostics-2026-09-15](tier0-diagnostics-2026-09-15.md)).**
2. `megadj similar` / Set retrieval gains a flag-gated
   `--space raw|whitened` (mean-centre + whiten + CSLS; ~10 lines) for A/B.
   **✅ SHIPPED Sep 15 (CLI + route + MCP; coherence proxy flat, A/B
   judgment pending).**
3. Genre target: ship gate stays **gated ≥65%**; the _aspiration_ band is
   0.65–0.74 via probe + readout fixes, not a tower swap. **Sep 15: the
   probe lost to kNN (51.5% vs 62.6%) — the band must come from the
   `edm` refold + label fixes, not the probe. ✅ Then the refold SHIPPED:
   69.2% gated on the final canonical data (+7.4; pre-write A/B read
   70.3%/+7.7) — the gate is now met and the aspiration band's floor is
   reached WITHOUT a tower swap.**
4. MERT rejection: **provisional** — per-layer re-test queued before the
   verdict is quoted as final anywhere.
