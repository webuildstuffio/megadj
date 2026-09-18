# MegaSet embedding model analysis — learnings from the megamem dev-docs corpus

**Status:** 📚 REFERENCE — measured cross-pollination review, complete.

v1 · 2026-09-17 · Owner: MegaSet T10 / B10p (embedding similarity prior). Consumes
[embedding-models](../fulltags/embedding-models.md) (the tower decision) and
[tier0 diagnostics](../archive/tier0-diagnostics-2026-09-15.md) (hubness verdict);
feeds the [architecture §2b T10 row](02-architecture.md).

**Sources analyzed (Sep 17–18, 2026):** the `megamem-devdocs` megamem workspace
via MCP (2,091 docs / 11,032 chunks; health restored in-pass — see §8) plus the
underlying corpus on disk: `mem-bench/experiments/catalog/` (1,786 cataloged
experiments, incl. **127 MDL model/embedding experiments**), `mem-bench/docs/findings.md`
(8.7k lines of findings), the megamem engine docs (`retrieval-engine-decision-guide.md`,
`perf-deep-dive.md`), and the MLX embed server (`embed-server-mlx/server.py`).
Megamem runs **stella_en_400M_v5** (1024-d text embeddings) as its production tower;
megadj runs **discogs-effnet** (1280-d audio embeddings). Domains differ (text
retrieval vs audio similarity), but the _measurement discipline_ and the _geometry
learnings_ transfer with the caveats stated per section.

---

## 1. What megamem proves about how to run embedding work (methodology)

These are the process patterns megamem validated over ~140 sprints of
embedding-model experiments — directly applicable to our B10p / `genre --eval`
harness:

| Practice                                                                                                                                                              | Megamem evidence                                                                                                                                                                                                                                              | Megadj status                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model is the quality ceiling** — when a metric is stuck, a tower/model swap is the highest-leverage lever; param tuning exhausts first                              | Repeated finding: "embedding model is the quality ceiling — model swaps are highest leverage" (F32/F65, cited across MDL-009/026/087/089). GTE-small swap: +0.85pp blended, "largest single-experiment gain" (F170); pplx-embed swap +2.2pp (MDL-026 SHIPPED) | Our analog is validated: the effnet→X tower question is owned by `embedding-models.md`; v2 measured MERT/musicnn/clap/openl3/vggish and kept effnet. **Keep the reflex:** when the genre gate stalls, reach for the tower/readout, not more weight-tuning. The refold (+7.4 pts) was a _data_ fix, not a tower fix — both levers exist |
| **Architecture compatibility pre-checks before any swap** — pooling type, prefix/instruction requirements, tokenizer must match, or the swap _fails catastrophically_ | MDL-017 Jina −7.0pp (causal+last-token pooling, F176); MDL-001 Granite −10.8pp (CLS pooling, F229); MDL-005 LEAF −5.3pp; MDL-032 model soup closed at pre-check (HTTP 401 on second checkpoint — no bench wasted)                                             | Partially covered: our v2 rerun measured towers as-is. **Gap:** we never pre-check _pooling_ compatibility when adding a tower — e.g. MERT was mean-pooled over 30-s windows; the per-layer re-test (research review F1) should state the pooling plan up front                                                                        |
| **10–20 item embedding diagnostic before any full reindex**                                                                                                           | MDL-026 pre-check: embed 10 benchmark queries, require mean query-passage cosine ≥ 0.3, else close; MDL-032: 20 texts, mean paired cosine ≥ 0.90 between checkpoints, else close                                                                              | Cheap to add as a `--sanity` flag on `genre --eval`/`emb_benchmark.py`: verify per-tower fails=0 and finite norms on a 20-track sample _before_ the full LOO run. Our v1 broken-harness incident (invalid-row mapping) is exactly the class this catches early                                                                         |
| **Wilcoxon signed-rank on paired per-query scores, with bootstrap CI** — never ship/block on mean deltas alone                                                        | PAR-046 SHIPPED: ±0.2pp "noise threshold" replaced by p-value + 95% CI; detectable effect ~0.08pp at 80% power for n=392. Rule: Wilcoxon over t-test because per-query scores are ordinal/bimodal                                                             | We already use bootstrap CIs + McNemar in the genre audit v3 — **same spirit, keep it**. Apply the same gate to _B10p A/B runs_ (megaset with/without the similarity bonus): a +0.1pp chain-quality delta at n=180 sets is noise; require paired-test significance before touching `MEGASET_SIMILARITY_WEIGHT`                         |
| **Flat/one-number "wins" get an attribution pass**                                                                                                                    | MDL-087: pplx→stellar total +1.37pp decomposed into model +0.58pp vs calibration +0.79pp — **calibration contributed more than the model swap**                                                                                                               | Directly mirrors our finding that the _label refold_ (+7.4) beat any plausible tower swap (+1–2 at 2–6× cost). Before any future tower promotion, decompose: labels vs readout vs tower                                                                                                                                                |
| **Every experiment writes its Result into the catalog entry** — negative results are first-class                                                                      | 1786 catalog files, each with status + Result section; negatives like MDL-027/028 prevent re-litigation                                                                                                                                                       | megadj equivalent is GitHub-issues-as-roadmap + findings docs; the archived diagnostics follow this. Keep B10p A/B verdicts written _where the decision lives_ (this doc / 08-audit), not in chat                                                                                                                                      |

## 2. Geometry learnings that transfer to 1280-d audio cosine kNN

Megamem's hardest-won space-geometry lessons, with our transfer verdicts:

### 2.1 Anisotropy and whitening — VALIDATED, matches our live result

- Their text towers are extremely anisotropic: stella-400m effective dimensionality
  **d_eff ≈ 34/1024** (F1233) — ~97% of dimensions carry mostly noise; raw cosines
  saturate in a narrow band ("0.3–0.5 for everything").
- Full PCA/ZCA whitening **repeatedly failed or was skipped as dangerous** in their
  domain: α sweep showed monotone degradation (IDX-031: α=1.0 → −1.5pp QL, −3.3pp
  safety — "catastrophic"); IDX-031's verdict: _"the corpus mean … contains useful
  semantic information that should NOT be removed"_ for domain-specific corpora;
  MDL-025 skipped citing that failure curve; IDX-297/302 never shipped (one
  build-failed).
- **But the lightweight versions worked:** mean-centering blended at α=0.3 shipped
  (+0.34pp, QRY-026), and "all-but-the-top" (remove top-1/2 dominant components)
  is their standing recipe for the retrieval space.
- **Megadj convergence (independent validation):** our whitened+CSLS retrieval
  space (all-but-the-top + CSLS, `cratedeck/shared/vector-space.ts`, shipped
  flag-gated Sep 15) measured **raw-space score saturation at 0.90+ with junk
  "gym mix" hubs in every top-5**, vs whitened spreading 0.70→0.05 and demoting
  hub junk (tier-0 run). Same pathology, same fix family, measured independently
  in a different domain. **The lesson: expect saturation in any raw cosine space;
  prefer all-but-the-top + CSLS over full whitening; never full mean-subtraction
  at α=1.0 — it deletes the domain signal (for us: the "all music sounds
  directionally similar" component IS signal).**

### 2.2 Hubness — our confirmed tail is their unsolved one

- Radovanović hubness: a few vectors appear as near-neighbors for a
  disproportionate share of queries. Their PAR-211 designed the two-phase
  protocol (diagnostic → CSLS only if hub_pct > 1–5%) but **never executed it**
  (status: skipped); SCR-412 (rank-penalty demotion) build-failed. So megamem
  has the _recipe_ but no _measurement_.
- Megadj actually ran it: **408/2643 tracks in ≥10 top-5 lists, max 31, p99=23**
  (tier-0 0.3, "HEAVY TAIL CONFIRMED"). Our CSLS is the live mitigation; their
  unexecuted caution notes remain useful for us:
  - hubness penalties must be computed from **held-out queries, never the eval
    set** (overfitting the penalty to the bench);
  - CSLS adjusted scores can go **negative** — rank them below every positive
    score, don't clamp;
  - narrow-domain corpora are highest-risk (their F1090: 79–97% topical overlap);
    our library is a narrow DJ pool — same risk profile.

### 2.3 Dimensionality and truncation — DON'T

- MRL truncation on a claimed-MRL model failed hard: 512-d → **−12.5pp** (MDL-027);
  the model ran 1024-d internally regardless, so RAM didn't drop either.
- Post-hoc binary/sign quantization pruned valid candidates before rerank could
  rescue them (MDL-028 NEUTRAL-to-negative; AMB −2.5pp).
- TurboQuant 3-bit: −0.1pp quality but RAM +23MB from dequant overhead (SPD-127).
- **Transfer:** effnet's 1280-d is only ~4.4 MB/1000 tracks at f32 (5 KB/track ≈
  18 MB total for 3,618) — we have **zero storage or scan-speed pressure** at
  library scale (brute-force cosine over 3.6k vectors is microseconds). Never
  copy a compression/quantization mechanism from text-RAG contexts; at 10× our
  current library it would still be premature.

### 2.4 Ensembles/fusion of towers — our settled verdict matches their pattern

- Their multi-embedder panel idea (MDL-127, N models → quadratic supervisory
  signal) is **queued, never measured**; their one measured ensemble analog
  (BM25+vec complementarity diagnostics) showed low overlap ≠ fusion win.
- Megadj measured the audio-tower ensemble properly: best fusion
  (effnet+musicnn+mert mean-cosine) = **+1.1 pt — inside noise, gate closed**;
  naive rank-fusion is a documented **trap** (silently selects the _least_
  similar neighbors — 0.02–0.12 scores until fixed; use mean-cosine).
- **Lesson:** "more towers" is a hypothesis that must beat the single tower by a
  real margin on a guarded population — in both shops it has never done so.
  B10p stays effnet-only (also megamem's stance: one well-chosen model per leg).

### 2.5 kNN readout vs learned probes — kNN won in both shops

- Megadj: linear probe **51.5% vs kNN 62.6%** (tier-0, "probe does NOT beat kNN,
  contrary to the literature prior"); kNN stays the production readout.
- Megamem's analog: learned components on top of frozen embeddings (contrastive
  projection heads MDL-067, LoRA fine-tunes MDL-055/085/110, meta-embeddings)
  consumed multiple sprints with **no shipped win** in the catalog through
  S143; their shipped wins came from _model choice + space hygiene_ (centering,
  chunking), not learned post-processing.
- **Lesson for B10p:** cosine kNN on effnet + small capped weight is the
  measured-best readout class; a learned scorer over embedding+features would
  need to beat it by ≥3 pts on a guarded eval to exist (same bar the probe
  failed).

## 3. Prior-weight design (direct B10p guidance)

- **Soft prior ≤0.1 with hard gates first is structurally what megamem
  converged to from the other direction:** their fusion keeps BM25 lexical leg
  untouched (safety/precision), and post-fusion _reordering of any kind_ was
  measured harmful (decision guide: "every reranker test was negative, −5% to
  −12%; post-fusion reordering breaks calibrated RRF weights"). Our
  `MEGASET_SIMILARITY_WEIGHT = 0.1` bonus _after_ tempo/key/anchor gates is the
  same architecture: cheap filters first, similarity as a tie-breaker only.
  **Do not promote the weight without a paired-test-positive A/B** (§1
  Wilcoxon); their E6-style finding that weights barely move outcomes (our
  benchmarks E6: 5 weight variants → ΔmeanTr 0.989–0.9945) predicts the
  observable effect is small by construction — the A/B must be powered for
  chain-level metrics, not mean score.
- **Co-occurrence/second signal lane: measured neutral at their scale.**
  INF-169 built the co-retrieval graph from 58k–131k real queries/workspace and
  benched **0.00pp** — root cause: _top-K results already contain the correct
  items, so neighbors add nothing at fusion time_. Our T15 scene-affinity
  (tracklist co-occurrence) is parked pending ~10k matched rows — their result
  says: **expect the payoff to appear only as _pool expansion for sparse
  queries_, not as a reranker**, and design the eval accordingly (measure
  pool-recall effect on sparse pools, not mean transition score).
- **Model swap ≠ free quality:** every "bigger model" swap that ignored
  architecture/cost-fit failed (−5 to −11pp); the successful swaps were
  same-family upgrades with a RAM/latency budget (MDL-089: stella-400m traded
  −0.56pp QL for 3× RAM + 3–13× reindex speed — a deliberate, measured
  _downgrade_). For us: any future tower change must re-quote the full
  backfill cost (s/track × 3,618+) and the label-ceiling cap (~60–76%
  audio-consistent labels — a better tower measured against noisy labels is
  capped by them; that's why refold-first was right).

## 4. Ops gotchas worth stealing

- **Model/version pinning at index time:** their `index_version` +
  `embed_model_id` in the manifest makes every index self-describing; a model
  change forces reindex (F238: config/model mismatch produced "fresh-reindex
  artifacts, not true measurements"). Our `embeddings` ledger has `source_path`
  - `analyzed_at` but **no model id column** — effnet is currently the only
    writer so the gap is theoretical; add `model` (or a `model_version` in the
    row) _before_ a second tower ever writes, so mixed-ledger states are
    detectable. (Cheap now, painful later — their F238 class.)
- **Embed-server pattern over in-process:** their MLX server (stella on
  Apple Silicon, IDX-211/INF-196) gives 2–4× reindex speedup vs CPU ONNX at
  equal quality, with /health + /metrics and OOM counters; the MPS variant
  (MDL-094) confirmed fp16-output correctness gotchas (mixed-precision drift
  needed a dedicated fix). If a FullTags embedding backfill ever outgrows the
  in-process worker, an HTTP embed server with batch + health is the proven
  shape on this exact hardware — but keep `setFileTags`-adjacent writes
  synchronous per AGENTS.md (embedding _computation_ is batch/offline, not the
  tag-write path, so the rule isn't violated).
- **INT8 vs FP32 is not automatically better either way:** their INT8 model
  _beat_ an FP32 variant by −1.1pp→ (MDL-049: the comparison confounded model
  version, and the honest caveat — pure same-repo quantization loss was never
  measured — is itself the lesson). Effnet ONNX runs fp32 today; there is no
  measured reason to quantize, and MDL-049 says measure before believing any
  model-card loss claim.
- **Silent corpus-path starvation (the incident found during this analysis):**
  the `megamem-devdocs` workspace's `[corpus] root` pointed at a path renamed
  away in June — the BM25 leg silently starved (0 docs, DEGRADED) for months
  while the vec leg kept answering; `status` said HEALTHY until a reindex
  forced the failure visible. **Megadj parallel:** ledgers can rot
  half-silently; any surface that reads `embeddings` should surface
  _coverage_ (rows with vectors / eligible tracks) alongside results — the
  "honest payloads" invariant — and `regate`-style re-validation should check
  ledger freshness, not just gate math.

## 5. What does NOT transfer (domain deltas, stated plainly)

- **Text vs audio embeddings:** stella's d_eff≈34 and 512-token truncation
  issues are properties of transformer _text_ towers; nothing in their catalog
  speaks to effnet's spectral-front-end geometry. Our tier-0 hubness histogram
  is _our_ d_eff-equivalent evidence; if we want the full spectral diagnostic,
  run their IDX-245 recipe (SVD eigenvalue spectrum + participation ratio over
  the 3618×1280 matrix — ~2s with NumPy) rather than importing their numbers.
- **Their negative results on chunking/context assembly** (CTX-*: chunk overlap,
  ordering, token budgets) have no megadj analog — we embed whole tracks, no
  chunks. Skipped deliberately here.
- **Query-side machinery** (query expansion, prefixes, IDF emphasis): megadj's
  "query" is a track id, not text — the entire QRY-* line is inapplicable
  except as methodology.

## 6. Ranked actions for megadj (all cheap, none blocking B10p as shipped)

1. **Add a per-row `model` column to the `embeddings` ledger before any second
   tower** (effnet today; anything else would poison kNN silently). Effort:
   schema migration + one write-site change.
2. **Pre-register the B10p A/B protocol** (Wilcoxon + bootstrap CI on paired
   chain metrics; n sized for the 0.1-weight effect; `--space raw|whitened` as
   a factor) _before_ the first run, so the verdict can't be argued post hoc.
   PAR-046 is the template.
3. **Run the IDX-245 spectral diagnostic on our 3618×1280 matrix** (2s of
   NumPy; participation ratio + top-eigenvalue share) to _measure_ our
   anisotropy instead of borrowing stella's — it directly calibrates how much
   all-but-the-top (K) our whitened space should remove. Current K choice is
   un-swept.
4. **State the pooling plan in the MERT per-layer re-test** (research review
   F1) and run the MDL-026-style 20-track sanity diagnostic before any tower
   rerun — catches harness/normalization bugs at 1/10 the cost.
5. **Ledger-coverage counters on every embedding-reading surface** (similar,
   megaset payload, genre kNN): rows-with-vectors vs eligible, same invariant
   as the pool census. Prevents the silent-starvation class (§4).

## 7. Source index (what this doc is built from)

Megamem corpus (mem-bench experiments catalog + engine docs), read Sep 17–18
2026 via the `megamem-devdocs` MCP workspace and the on-disk corpus:

- Model swap arc: MDL-009 (GTE +0.85pp), MDL-026 (pplx +2.2pp, pre-checks),
  MDL-087 (attribution report), MDL-089 (deliberate quality-for-RAM downgrade),
  MDL-049 (INT8-vs-FP32 diagnostic), MDL-063 (corpus-adaptive selection; the
  −38pp wrong-model catastrophe), MDL-032 (pre-check close), MDL-127 (panel,
  unmeasured).
- Space geometry: IDX-031 (centering α-sweep failure curve), MDL-025 (full PCA
  whitening skipped citing F289), IDX-297/IDX-302 (whitening designs, unshipped),
  QRY-237/239 (query-side centering/truncation, skipped), F1233 (d_eff 34/1024),
  PAR-211 (hubness/CSLS design, unexecuted), SCR-412 (build-failed).
- Quantization/size: MDL-027 (MRL −12.5pp), MDL-028 (binary two-pass AMB
  regression), SPD-127 (RSVD), SPD-143 (1-bit), F238 (model/index pinning
  failure).
- Methodology/ops: PAR-046 (Wilcoxon, SHIPPED), INF-169 (co-retrieval graph
  0.00pp), IDX-211/MDL-090/MDL-094 (MLX/MPS embed servers), INF-196 (metrics),
  plus the megamem engine docs — `retrieval-engine-decision-guide` (reranker
  negativity, hybrid guidance) and `perf-deep-dive` — in the megamem repo.

Megadj side: docs/fulltags/embedding-models.md (v2 tower table + fusion sweep),
docs/archive/tier0-diagnostics-2026-09-15.md (hubness/probe/whitened verdicts),
docs/archive/embedding-research-2026-09-14.md (external review + adoption
ladder), docs/megaset/02-architecture.md §2b T10 + §4 (B10p ownership),
cratedeck/shared/megaset.ts (`MEGASET_SIMILARITY_WEIGHT` 0.1),
cratedeck/shared/vector-space.ts (all-but-the-top + CSLS, CSLS_R=10).

## 8. Provenance note — workspace health incident during analysis

While querying the `megamem-devdocs` MCP workspace at the start of this
analysis, `status` reported `DEGRADED` (BM25 leg 0 docs). Root cause found and
fixed in-pass: the workspace's `[corpus] root` still pointed at
`~/github/megamem-prod/devdocs-corpus` (renamed to `megamem-devdocs-corpus` in
the June naming migration), so BM25 had silently starved since then while the
vector leg kept answering. Fix: path corrected in
`workspace-megamem-devdocs/infrastructure/search/search.toml`, index rebuilt
(2,091 BM25 docs / 10,930 vectors), search verified (exact-ID probes hit),
launchd hub service restarted healthy. During recovery the launchd keepalive
hub (`com.nick.megamem`, port 7823) was briefly bootout'ed to release the
tantivy writer lock, then re-bootstrapped; final MCP `status`: HEALTHY. No
megadj state was touched; the config fix lives in the megamem-prod repo
working tree (uncommitted there — that repo treats index/config artifacts as
untracked/ignored).
