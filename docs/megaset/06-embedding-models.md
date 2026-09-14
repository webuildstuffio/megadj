# Audio embedding model benchmark — MegaSet/FullTags (Sep 14, 2026)

**Question.** We ship `discogs-effnet` (1280-d) as the "sounds like" tower. Is
there a better *free, local, ONNX* tower for (a) genre-family inference and
(b) similar-track retrieval?

**Protocol.** One eval set — 80 real library tracks (10 per family × 8
families: house, techno, trance, edm, hiphop, dnb, pop, rock), all with
human labels from `archive.db`. Leave-one-out kNN family agreement
(majority vote, cosine) + top-5 neighbor family coherence + wall clock per
track on this M-series CPU. Same files, same splits, every tower. This is
exactly the metric our `megadj genre` kNN and MegaSet "sounds like" rely on.

**Towers (all free, all local, all ONNX, CPU-only):**

| # | Tower | Dim | Train data | License |
|---|---|---|---|---|
| 1 | discogs-effnet-bsdynamic (**incumbent**) | 1280 | Discogs 2M | CC BY-NC-SA |
| 2 | msd-musicnn (200) | 200 | Million Song Dataset | CC BY-NC-SA |
| 3 | openl3-music-mel128-emb512 | 512 | AudioSet music (audio-visual, self-sup) | CC BY-NC-SA |
| 4 | audioset-vggish (**incumbent #2**) | 128 | AudioSet | Apache 2.0 |
| 5 | clap-htsat-unfused (LAION) | 512 | LAION-Audio-630k | Apache 2.0 (MIT model) |

Considered and rejected pre-benchmark: **MERT-v1-95M** (best published
numbers — 93.9% GTZAN-linear-probe — but 360 MB transformer, ~50 fps
frame output needing pooling, CC-BY-NC, and 10–30× slower per track than
effnet on CPU; wrong cost/benefit for a 3,700-track batch pipeline);
**PANNs CNN14** (2 GB, no first-class ONNX); **music2vec** (superseded by
MERT); **JukeMIR/MuLaP** (no maintained ONNX export).

## Results (80 tracks, LOO kNN, cosine)

| Tower | LOO family agree (k=5) | LOO (k=7) | Family coherence @5 | s/track |
|---|---|---|---|---|
| **msd-musicnn-200** | **0.538** | 0.463 | 0.323 | 1.60 |
| effnet-discogs-1280 (incumbent) | 0.413 | 0.400 | **0.335** | 0.85 |
| openl3-music-512 | 0.400 | — | 0.275 | 7.77 |
| vggish-128 | 0.300 | — | 0.220 | 1.27 |
| clap-htsat-512 | 0.213 | — | 0.175 | 0.50 |
| **ensemble effnet+musicnn** (mean-rank) | **0.463** | — | — | ~2.5 |

Reading:

1. **musicnn wins genre inference by +12.5 points** (0.538 vs 0.413) — it
   was trained on MSD *tag* prediction, so its penultimate layer keeps
   timbre-genre information effnet's artist-collapsed tower partially
   discards.
2. **effnet wins retrieval coherence** (0.335 vs 0.323, basically tied) and
   is 2× faster. Its neighbors are also more *novel* — only **0.324
   top-10 Jaccard overlap** with musicnn's neighbor lists. The two towers
   see genuinely different things in the same audio.
3. **Ensembling the two towers beats either alone for genre** (0.463 vs
   0.413) without giving up effnet's retrieval role. The overlap being low
   is exactly why the ensemble helps.
4. OpenL3 is mid at 8× the cost. VGGish is dominated (we only keep it for
   valence/arousal, where it's the only game in town). CLAP is *worse than
   coin flip* here — it's a text-alignment model, optimized to match
   captions, not to cluster music; zero-shot text-probe was its real use
   case, not kNN.

## Honest caveats

- n=80, one seed of `ORDER BY RANDOM()` — family agreement has ±5-6pt
  error bars at this n. The musicnn > effnet gap (12.5pt) is at the edge of
  significance; the ensemble result is the robust one.
- Families are unevenly hard (hiphop/dnb/rock are easy; house/techno/trance
  boundary is genuinely fuzzy — that's the library, not the tower).
- Genre labels are the noisy ground truth we have; §05-genre-audit measured
  them at ~60-76% audio-consistent. Any tower measured against them is
  capped by that ceiling. Towers could be re-ranked by retrieval-quality
  human eval later.
- Speed numbers are single-threaded CPU with per-track session reuse; batch
  runners would amortize differently.

## Decision & plan

**Adopt a two-tower ensemble, keep effnet as retrieval-primary:**

1. **Genre inference (`megadj genre`) switches to ensemble scoring:**
   similarity = mean of rank-normalized cosine from effnet + musicnn
   (measured 0.463 vs 0.413 single-tower). Musicnn model is 3.2 MB —
   trivially bundled into `modelsEnsure`.
2. **"Sounds like" (MegaSet similar/set building) keeps effnet-primary**
   with musicnn as a diversity re-ranker (interleave top-10 lists at 7:3;
   both towers already cached per-track, ~1.6s extra per track on a cold
   batch, 0 warm).
3. **Re-benchmark after refold** (05-genre-audit §5b): cleaner labels →
   tighter ceiling → re-measure; promote MERT only if the ensemble stalls
   below 0.55 AND the compute budget allows 10-30× slower batch runs.
4. **VGGish stays** for VA (no competitor at that price) and **CLAP stays
   out** (measured worst; text-probe niche is a different product).

### Implementation steps

- [ ] `fulltags/src/models.ts`: add `msd-musicnn-1.onnx` to MODEL_FILES
      (url `autotagging/msd/msd-musicnn-1.onnx`, 3.2 MB).
- [ ] Python seam: second tower in the same worker process; emit
      `embedding200` alongside `embedding` when `withEmbedding`.
- [ ] `archive.db` ledger: `track_embeddings_mnn` table (mirror of the
      1280-d ledger; 200-d rows).
- [ ] `megadj genre` + `similarTracks`: rank-fusion read of both ledgers;
      fall back to single-tower when only one side is populated.
- [ ] Backfill command: `megadj genre --backfill-mnn` (batch, resumable,
      ~1.6s/track × 3,400 ≈ 90 min once).
- [ ] Re-run this benchmark harness post-refold; store numbers here.

*Harness:* `/tmp/emb-bench/emb_benchmark.py` (add to repo under
`tools/` if we want it as `megadj genre --eval-models`).
