# MegaSet embedding model analysis — learnings from the megamem dev-docs corpus

**Status:** 📚 REFERENCE — measured cross-pollination review, complete. **v2 (Sep 18):**
re-read against the grown corpus (2,003 catalog files, findings through F1284),
corrected v1 counts, added §7 architecture-transfer, §8 experimentation-process,
§9 second-pass findings, and expanded the action list to a ranked top-10.

v1 · 2026-09-17 · v2 · 2026-09-18 · Owner: MegaSet T10 / B10p (embedding similarity
prior). Consumes [embedding-models](../fulltags/embedding-models.md) (the tower
decision) and [tier0 diagnostics](../archive/tier0-diagnostics-2026-09-15.md)
(hubness verdict); feeds the [architecture §2b T10 row](02-architecture.md).

**Sources analyzed (Sep 17–18, 2026):** the `megamem-devdocs` megamem workspace
via MCP (2,091 docs / 10,930 chunks; health restored in-pass — see §11) plus the
underlying corpus on disk: `mem-bench/experiments/catalog/` (**2,003 cataloged
experiments as of the Sep 18 re-census — v1 quoted 1,786; the catalog grew**,
family census: SCR 412 · IDX 310 · INF 261 · QRY 244 · PAR 212 · SPD 142 ·
**MDL 127** · VERIFY 94 · MCP 63 · CTX 59 · SES 32 · MEM 27 · DIV 19),
`mem-bench/docs/findings.md` (8,710 lines, F-numbered findings through F1284),
the megamem engine docs (`retrieval-engine-decision-guide.md`,
`perf-deep-dive.md`, plus the engine's own ARCHITECTURE reference under
mem-bench docs/megamem/), and the MLX embed server
(`embed-server-mlx/server.py`). Frontmatter status census (live, Sep 18):
**1,001 `failed` · 681 `done` · 279 `skipped` · 40 `queued`** — of the 681 done,
only ~94 carry explicit POSITIVE verdicts and ~131 explicit NEGATIVE ones.
Megamem runs **stella_en_400M_v5** (1024-d text embeddings) as its production
tower; megadj runs **discogs-effnet** (1280-d audio embeddings). Domains differ
(text retrieval vs audio similarity), but the _measurement discipline_ and the
_geometry learnings_ transfer with the caveats stated per section.

---

## 1. What megamem proves about how to run embedding work (methodology)

These are the process patterns megamem validated over ~140 sprints and ~4,000
runs of embedding-model experiments — directly applicable to our B10p /
`genre --eval` harness:

| Practice                                                                                                                                                              | Megamem evidence                                                                                                                                                                                                                                                                                      | Megadj status                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model is the quality ceiling** — when a metric is stuck, a tower/model swap is the highest-leverage lever; param tuning exhausts first                              | Repeated finding: "embedding model is the quality ceiling — model swaps are highest leverage" (F32/F65, cited across MDL-009/026/087/089). GTE-small swap: +0.85pp blended, "largest single-experiment gain" (F170); pplx-embed swap +2.2pp (MDL-026 SHIPPED)                                         | Our analog is validated: the effnet→X tower question is owned by `embedding-models.md`; v2 measured MERT/musicnn/clap/openl3/vggish and kept effnet. **Keep the reflex:** when the genre gate stalls, reach for the tower/readout, not more weight-tuning. The refold (+7.4 pts) was a _data_ fix, not a tower fix — both levers exist |
| **Architecture compatibility pre-checks before any swap** — pooling type, prefix/instruction requirements, tokenizer must match, or the swap _fails catastrophically_ | MDL-017 Jina −7.0pp (causal+last-token pooling, F176); MDL-001 Granite −10.8pp (CLS pooling, F229); MDL-005 LEAF −5.3pp; MDL-032 model soup closed at pre-check (HTTP 401 on second checkpoint — no bench wasted); QRY-229 domain instruction prefixes −7.5pp (prefixes are part of the contract too) | Partially covered: our v2 rerun measured towers as-is. **Gap:** we never pre-check _pooling_ compatibility when adding a tower — e.g. MERT was mean-pooled over 30-s windows; the per-layer re-test (research review F1) should state the pooling plan up front                                                                        |
| **10–20 item embedding diagnostic before any full reindex**                                                                                                           | MDL-026 pre-check: embed 10 benchmark queries, require mean query-passage cosine ≥ 0.3, else close; MDL-032: 20 texts, mean paired cosine ≥ 0.90 between checkpoints, else close                                                                                                                      | Cheap to add as a sanity flag on `genre --eval`/`emb_benchmark.py`: verify per-tower fails=0 and finite norms on a 20-track sample _before_ the full LOO run. Our v1 broken-harness incident (invalid-row mapping) is exactly the class this catches early                                                                             |
| **Wilcoxon signed-rank on paired per-query scores, with bootstrap CI** — never ship/block on mean deltas alone                                                        | PAR-046 SHIPPED: ±0.2pp "noise threshold" replaced by p-value + 95% CI; detectable effect ~0.08pp at 80% power for n=392. Rule: Wilcoxon over t-test because per-query scores are ordinal/bimodal. PAR-049 retroactively re-audited near-misses with it                                               | We already use bootstrap CIs + McNemar in the genre audit v3 — **same spirit, keep it**. Apply the same gate to _B10p A/B runs_ (megaset with/without the similarity bonus): a +0.1pp chain-quality delta at n=180 sets is noise; require paired-test significance before touching `MEGASET_SIMILARITY_WEIGHT`                         |
| **Flat/one-number "wins" get an attribution pass**                                                                                                                    | MDL-087: pplx→stellar total +1.37pp decomposed into model +0.58pp vs calibration +0.79pp — **calibration contributed more than the model swap**; F1201: six experiments showing an identical +0.1pp were a display-precision floor, not signal                                                        | Directly mirrors our finding that the _label refold_ (+7.4) beat any plausible tower swap (+1–2 at 2–6× cost). Before any future tower promotion, decompose: labels vs readout vs tower                                                                                                                                                |
| **Every experiment writes its Result into the catalog entry** — negative results are first-class                                                                      | 2,003 catalog files, each with frontmatter status + Result section; negatives like MDL-027/028 prevent re-litigation; the status census (1,001 failed / 681 done) is itself the honest scoreboard                                                                                                     | megadj equivalent is GitHub-issues-as-roadmap + findings docs; the archived diagnostics follow this. Keep B10p A/B verdicts written _where the decision lives_ (this doc / 08-audit), not in chat                                                                                                                                      |

## 2. Geometry learnings that transfer to 1280-d audio cosine kNN

Megamem's hardest-won space-geometry lessons, with our transfer verdicts:

### 2.1 Anisotropy and whitening — VALIDATED, matches our live result

- Their text towers are extremely anisotropic: stella-400m effective dimensionality
  **d_eff ≈ 34/1024** (F1233) — ~97% of dimensions carry mostly noise; raw cosines
  saturate in a narrow band ("0.3–0.5 for everything"). The follow-up geometry
  baseline (PAR-199, F1161) measured **effective rank 479–598/1024** by
  participation-ratio and mean pairwise cosine 0.47–0.52 — healthy for a domain
  corpus, and a template for what our own baseline should record.
- Full PCA/ZCA whitening **repeatedly failed or was skipped as dangerous** in their
  domain: α sweep showed monotone degradation (IDX-031: α=1.0 → −1.5pp QL, −3.3pp
  safety — "catastrophic"); IDX-031's verdict: _"the corpus mean … contains useful
  semantic information that should NOT be removed"_ for domain-specific corpora;
  MDL-025 skipped citing that failure curve; IDX-297/302 never shipped (one
  build-failed — S143's F1280 whitening-without-eigenbasis variants went −8 to
  −10.6pp, the sharpest confirmation yet that whitening without the real basis is
  a random projection).
- **But the lightweight versions worked:** mean-centering blended at α=0.3 shipped
  (+0.34pp, QRY-026), and "all-but-the-top" (remove top-1/2 dominant components)
  is their standing recipe for the retrieval space.
- **Megadj convergence (independent validation):** our whitened+CSLS retrieval
  space (all-but-the-top + CSLS, `src/shared/leaf/vector-space.ts`, shipped
  flag-gated Sep 15) measured **raw-space score saturation at 0.90+ with junk
  "gym mix" hubs in every top-5**, vs whitened spreading 0.70→0.05 and demoting
  hub junk (tier-0 run). Same pathology, same fix family, measured independently
  in a different domain. **The lesson: expect saturation in any raw cosine space;
  prefer all-but-the-top + CSLS over full whitening; never full mean-subtraction
  at α=1.0 — it deletes the domain signal (for us: the "all music sounds
  directionally similar" component IS signal).**

### 2.2 Hubness — our confirmed tail is their unexecuted one

- Radovanović hubness: a few vectors appear as near-neighbors for a
  disproportionate share of queries. Their PAR-211 designed the two-phase
  protocol (diagnostic → CSLS only if hub_pct > 1–5%) but **never executed it**
  (frontmatter `status: skipped`); SCR-412 (rank-penalty demotion) build-failed.
  So megamem has the _recipe_ but no _measurement_.
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
  the model ran 1024-d internally regardless, so RAM didn't drop either. IDX-169
  re-confirmed at 768-d (kodo −2.15pp past the hard gate).
- Post-hoc binary/sign quantization pruned valid candidates before rerank could
  rescue them (MDL-028 NEUTRAL-to-negative; AMB −2.5pp). RaBitQ (SPD-105) −0.8 to
  −1.5pp across workspaces — "corpus 3K–22K too small for binary scan to beat
  brute-force".
- TurboQuant 3-bit: −0.1pp quality but RAM +23MB from dequant overhead (SPD-127);
  the honest note (MDL-049) is that pure same-repo quantization loss was never
  isolated — measure before believing any model-card loss claim in _either_
  direction.
- **Transfer:** effnet's 1280-d is only ~4.4 MB/1000 tracks at f32 (5 KB/track ≈
  18 MB total for 3,618) — we have **zero storage or scan-speed pressure** at
  library scale (brute-force cosine over 3.6k vectors is microseconds). Never
  copy a compression/quantization mechanism from text-RAG contexts; at 10× our
  current library it would still be premature.

### 2.4 Ensembles/fusion of towers — our settled verdict matches their pattern

- Their multi-embedder panel idea (MDL-127, N models → quadratic supervisory
  signal) is **queued, never measured**; their one measured ensemble analog
  (BM25+vec complementarity diagnostics, SCR-334: 79–97% top-30 overlap) showed
  high overlap = the legs are "retrieval-redundant-but-ranking-complementary" —
  the lever is reranking, not a third leg.
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

### 2.6 Diversity machinery — a whole family that died (new in v2)

- Megamem's DIV family — **all 19 experiments** (DIV-001 MMR, DIV-006 DPP,
  DIV-007 k-means interleave, DIV-009 soft MMR, DIV-010 recal, DIV-011 source
  caps, DIV-012/016 temporal spread, DIV-003 idiotypic suppression, DIV-002
  crop rotation…) — closed **NEUTRAL or worse** at their scale. DIV-008's
  verdict is the survivor: a **hard limit already provides all the diversity
  benefit; a soft 0.85× penalty just redistributes scores without changing
  outcomes** (and occasionally demotes the genuinely best item).
- Post-hoc dedup variants (DIV-017, QRY-176b) were re-verified dead twice with
  the note "**do not re-queue at any threshold**".
- **Transfer to S17 (megadj diversity knobs):** design artist-adjacent and
  family-run guards as **hard caps, not soft penalties**; a soft penalty needs a
  paired-test-positive A/B before it ships, and the prior from 19 failed
  experiments says it won't. Our planned "artist-adjacent = 0" is the
  max_chunks_per_doc=2 analog — keep it hard and cheap.

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
- **Co-occurrence/second signal lane: measured neutral at their scale —
  repeatedly.** INF-169 built the co-retrieval graph from 58k–131k real
  queries/workspace and benched **0.00pp**; the S133 class re-run (MEM-026
  spreading activation, MEM-027 pre-fusion injection, IDX-215 heading hyperedge)
  added three more structural zeros with the same root cause: _top-K results
  already contain the correct items, so neighbors add nothing at fusion time_;
  the class is formally "exhausted (F855+F1271)". Our T15 scene-affinity
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
  `embed_model_id` in the manifest makes every index self-describing (INF-143
  model-versioned cache); a model change forces reindex (F238: config/model
  mismatch produced "fresh-reindex artifacts, not true measurements"). Our
  `embeddings` ledger has `source_path` + `analyzed_at` but **no model id
  column** — verified against `src/archive/state-core.ts` on Sep 18: the
  `cues` table already carries a `model` column and the `addColumnIfMissing`
  migration seam exists, so this is a one-line DDL + one write-site change.
  Effnet is currently the only writer so the gap is theoretical; add `model`
  _before_ a second tower ever writes, so mixed-ledger states are detectable.
  (Cheap now, painful later — their F238 class.)
- **Embed-server pattern over in-process:** their MLX server (stella on
  Apple Silicon, IDX-211/INF-196) gives 2–4× reindex speedup vs CPU ONNX at
  equal quality, with /health + /metrics and OOM counters; the MPS variant
  (MDL-094) confirmed fp16-output correctness gotchas (mixed-precision drift
  needed a dedicated fix). If a FullTags embedding backfill ever outgrows the
  in-process worker, an HTTP embed server with batch + health is the proven
  shape on this exact hardware — but keep `setFileTags`-adjacent writes
  synchronous per AGENTS.md (embedding _computation_ is batch/offline, not the
  tag-write path, so the rule isn't violated).
- **Poisoned-cache detection (new in v2, F1281 — the scariest ops finding in
  the corpus):** a drifted embed server wrote wrong vectors under a **correct
  model-name header**; every rebuild was a deterministic cache hit and
  reproduced the poison byte-for-byte — **5 weeks of silent 3–8pp quality
  loss** across 5 workspaces, with sprint docs reporting "baseline unchanged"
  the whole time. Detection failed because the cache validated the name string
  only. Their fix (INF-310): sentinel embeddings stored in the cache,
  re-embedded through the live server on load; cosine < 0.995 or dim change →
  discard the whole cache and re-embed, loud warning. Plus the canary rule:
  after any suspicious reindex era, a one-workspace quick bench (~90 s) is the
  cheapest health check — >1pp vs baseline → quarantine caches, not config
  forensics. Megadj keeps its vec cache under `.megamem/megadj/` — same class
  applies the day anything but the current writer populates it.
- **Index-time vs serve-time separation (F1283):** their serve path silently
  created empty vector-store stubs for any workspace name (including test
  litter) because one `create_dir_all` lived on the read path. Fix: directory
  creation is exclusively the indexer's job; serve bails loudly on a missing
  store. Megadj analog: reading surfaces should fail loudly on a missing/empty
  `embeddings` ledger, never fabricate an empty one.
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
  the 3618×1280 matrix — ~2s with NumPy) rather than importing their numbers —
  and record the PAR-199-style baseline triple (effective rank, mean pairwise
  cosine, norm CV) so future tower work has a reference. (Their norm-CV
  monitor, INF-245: healthy normalizing towers hold CV < 0.01; the monitor
  caught their April binary-mismatch incident.)
- **Their negative results on chunking/context assembly** (CTX-*: chunk overlap,
  ordering, token budgets) have no megadj analog — we embed whole tracks, no
  chunks. Skipped deliberately here. (Note the irony: chunking was where their
  biggest non-model wins lived — IDX-140 per-doc adaptive chunking +0.60pp,
  IDX-230 boundary snapping +0.2pp, IDX-247 sentence-TFIDF +0.22pp. Our
  equivalent "chunking" is _label hygiene_, and that is where our +7.4
  refold came from.)
- **Query-side machinery** (query expansion, prefixes, IDF emphasis): megadj's
  "query" is a track id, not text — the entire QRY-* line is inapplicable
  except as methodology. Worth keeping one exception in mind: their prefix
  experiments (QRY-229 −7.5pp, QRY-215 noise) are the closest analog to our
  risk of "helpfully" prepending context to prompts in future audio-caption
  work — domain prefixes shifted embeddings out of useful neighborhoods there;
  treat any prompt/prefix addition to a tower input as a measured change, not
  a freebie.

## 6. Ranked top-10 actions for megadj (v2; all cheap, none blocking B10p as shipped)

1. **Add a per-row `model` column to the `embeddings` ledger before any second
   tower** (effnet today; anything else would poison kNN silently). Verified
   missing Sep 18 (`state_core.ts`); `addColumnIfMissing` + the `cues.model`
   precedent make it a one-liner migration.
2. **Pre-register the B10p A/B protocol** (Wilcoxon + bootstrap CI on paired
   chain metrics; n sized for the 0.1-weight effect; `--space raw|whitened` as
   a factor) _before_ the first run, so the verdict can't be argued post hoc.
   PAR-046 is the template; F1201 adds the display-precision rule — a uniform
   +0.1pp is a rounding artifact until p<0.05.
3. **Run the IDX-245 spectral diagnostic on our 3618×1280 matrix** (2s of
   NumPy; participation ratio + top-eigenvalue share + norm CV, PAR-199
   format) to _measure_ our anisotropy instead of borrowing stella's — it
   directly calibrates how much all-but-the-top (K) our whitened space should
   remove. Current K=2 is un-swept ("measured difference to C=10 is small" is
   _their_ corpus's claim, not ours).
4. **State the pooling plan in the MERT per-layer re-test** (research review
   F1) and run the MDL-026-style 20-track sanity diagnostic before any tower
   rerun — catches harness/normalization bugs at 1/10 the cost.
5. **Ledger-coverage counters on every embedding-reading surface** (similar,
   megaset payload, genre kNN): rows-with-vectors vs eligible, same invariant
   as the pool census. Prevents the silent-starvation class (§4) and the
   F1283 empty-store class in one move.
6. **Guard megadj's embed cache against the F1281 poisoning class:** before
   trusting cache hits, verify writer identity beyond the name string (model +
   dim, sentinel re-embed when cheap). Relevant the moment `.megamem/megadj/`
   has a second potential writer.
7. **Design S17 diversity as hard caps, not soft penalties** (§2.6): all 19
   megamem DIV experiments died; the surviving mechanism is the hard limit.
   Our artist-adjacent=0 / family-run≤3 stays a cap; any soft variant must
   clear a paired A/B first, and the base rate says it won't.
8. **Run a megaset failure taxonomy before adding more scoring terms**
   (PAR-197/F1115/F1205 pattern): classify why tracks are excluded and where
   chains break (no-BPM? key-clash? dead-end opener? budget shortfall?) —
   their FUSION_FAIL 72.5% dominance redirected a whole roadmap to reranking;
   our equivalent single biggest bucket should pick the next lever the same
   way. The excluded[] payload already carries the reasons — this is one
   aggregation query, not new instrumentation.
9. **Eval-harness hygiene rules (the inversion class):** freeze the eval set,
   record `fails` + seed per run, re-verify the baseline before interpreting
   any delta. Megamem's F968 (patch verify bypass → baseline-vs-baseline),
   F1277 (stale cache → phantom +5.2pp), F1163/F1164 (runner bugs → phantom
   +0.8pp) and our own v1 flip (musicnn 0.538 → 0.300 after the harness fix)
   are all one lesson: **a harness bug doesn't lose data, it inverts
   conclusions.**
10. **Spend the next quality effort on labels, not towers:** the measured
    ceiling evidence (refold +7.4 ≫ any plausible tower swap; label noise
    random per tier-0 0.1) says the remaining big block is the
    house→techno ambiguity (tier-0 0.4: still the largest confusion cell
    post-refold) — the §5b.3.5 clustering fix. Keep the MERT layer re-test
    queued as the only live tower question, and re-quote the tower ladder
    only after labels move again.

## 7. Architecture patterns that transfer (new in v2)

The cross-shop invariants — the "design transferal" layer, each stated as a
pattern with both shops' evidence:

1. **Cheap hard gates first; soft signals last and small.** Megamem: BM25 leg
   untouched, every post-fusion reorder negative (−5 to −12pp), RRF weights
   calibrated once and defended. Megadj: tempo/key/anchor hard gates →
   0.45/0.30/0.25 blend → ≤0.1 similarity bonus. The architecture IS the
   finding: ordering by cheapness-and-certainty beats any clever joint score
   either shop tried.
2. **kNN readout + space hygiene beats learned post-processing.** Probe lost in
   both shops (51.5 vs 62.6 here; LoRA/projection-head/CE-as-replacement
   losses there). The one learned component that shipped there (SCR-371,
   +0.17pp) was injected as an **additional RRF leg**, not a replacement — the
   "add a leg, never replace the calibrated core" pattern is the transferable
   form.
3. **One well-chosen tower per leg; ensembles never won.** MDL-127 unmeasured;
   our fusion +1.1 inside noise. Diversity comes from _different evidence_
   (mood heads, keys, tempo), not from averaging towers that mostly agree
   (their SCR-334: 79–97% leg overlap).
4. **Enrich the data, not the score.** Their biggest repeated wins:
   enrichment/chunking (+0.2 to +0.6pp each), model swaps (+0.85 to +2.2pp),
   calibration (+0.79pp of MDL-087's +1.37). Ours: label refold +7.4. All are
   "fix the inputs" moves; every "add a term to the score" move measured ~0 in
   both shops.
5. **Calibration is a first-class lever.** MDL-087's decomposition; F1028's
   `skip_stats` (Welford drift ~0.05–0.09pp/workspace masquerading as
   experiment signal on long-lived services). Megadj form: mood axes go
   through percentile normalization before arc-fit (T17); eval runners must
   not accumulate state across runs.
6. **Honest payloads everywhere.** Their INF-245 norm monitors, INF-146 health
   state machine, MCP-031 provenance ≡ our pool census + counter-carrying
   payloads. Every result carries its own coverage/freshness/health, or the
   surface eventually lies (F1281: five weeks of docs saying "baseline
   unchanged" over a poisoned index).
7. **Index-time and serve-time are different trust domains.** F1283 (serve path
   must not create), INF-143/F238 (self-describing indexes, model-pinned
   caches), INF-310 (sentinels). A write path that can run by accident is a
   future silent corruption.

## 8. The experimentation process, distilled (one section, as promised)

How one shop ran ~2,003 experiments across ~140 sprints and ~4,000 runs — the
process is the artifact:

- **The catalog unit.** One file per experiment: frontmatter (`status:`,
  `category:`, `sprint:`, `priority:`) + a mandatory Result section. Statuses
  today: 1,001 failed / 681 done / 279 skipped / 40 queued. Negatives are
  first-class and searchable — MDL-027's "MRL −12.5pp" has killed every
  truncation proposal since by citation alone. VERIFY-S\* post-deploy
  validation entries close each batch.
- **The statistics gate.** Wilcoxon signed-rank + bootstrap CI on paired
  per-query scores (PAR-046); p<0.05 to ship; F1201's display-precision rule
  (uniform +0.1pp = the metric's rounding floor, seen simultaneously on 6 of
  8 experiments in one sprint). Retroactive re-audit passes (PAR-049,
  PAR-204) re-judged old closes under the new gate instead of quietly
  keeping them.
- **Diagnostics gate features.** PAR-family audits run BEFORE feature
  families: oracle ceilings (PAR-202: rank-1-swap headroom +11.46pp decided
  the reranking roadmap), failure taxonomies (F1115: FUSION_FAIL 72.5%
  dominant; F1205: RANK_FAIL 37.7% for), pre-flight audits that pre-close
  experiments whose premise doesn't exist in the corpus (F1209/F1208: "the
  pattern fires 2 times out of 20 — mechanism wrong for this distribution,
  close before building").
- **Batch reality, reported honestly.** Droughts are on the record: S137–S141
  ran 42 experiments, shipped 0 (F1278) — and the post-mortem extracted the
  class conclusion ("post-RRF scoring exhausted") rather than hiding the
  ratio. S143 went 0-for-14 with a named root cause (staged-patch quality
  gap, F1280). The honest scoreboard is what makes the shipped-wins ledger
  credible.
- **Harness hygiene (the inversion class, again).** F968's verify bypass meant
  some "experiments" never applied their patches; F1277's stale cache minted
  phantom +5.2pp; our own v1 musicnn flip is the same species. The process
  response: pipeline hard-aborts on unverified patches, `fails` counts are
  recorded per run, and any suspicious era gets a quick-bench canary before
  interpretation.
- **The compounding math.** Shipped wins are individually small (+0.08 to
  +0.6pp each), rare (94-ish positive verdicts in 681 done), and additive:
  prose blended climbed ~65% → 77.7% over the campaign. No single hero
  experiment — except the model swaps (+2.2pp class) and one data fix class.
  Which is the whole argument of this document in one sentence: **measure
  everything, expect most things to be zero, and put the effort where the two
  big levers (tower choice, input quality) live.**

## 9. Second-pass readings added in v2 (Sep 18)

New findings integrated above, listed so the delta from v1 is auditable:

- **F1281 poisoning + INF-310 sentinels** → §4 ops, action #6 (v1 had no
  cache-integrity item; it is now the scariest silent-failure class in either
  shop).
- **DIV-19 all-dead + DIV-008 hard-limit survivor** → §2.6 + action #7 (v1
  said nothing about diversity machinery; S17 was designable either way).
- **F1278/F1280 drought post-mortems + F968/F1277 harness incidents** → §8
  (v1's methodology table had the positive practices only; the failure-mode
  catalog was missing).
- **PAR-202/F1115/F1205 oracle + taxonomy pattern** → action #8 (v1 had no
  megaset failure-taxonomy item).
- **Co-retrieval class re-confirmed dead (MEM-026/027, IDX-215, F1271–F1275)**
  → §3 (v1 cited only INF-169; the class closure is now 4 experiments deep).
- **PAR-199/F1161 geometry baseline format** → §5 (gives our IDX-245 run a
  concrete output spec beyond "eigenvalues").
- **Catalog recount 1,786 → 2,003 + status census** → header (the corpus is
  alive; quotes of its size need dates).

## 9b. The shipped-wins ledger, read for megadj (new in v2)

Every meaningful positive result in the corpus, with its class and our transfer
verdict. This is the complement to the failure catalog above: it shows where
quality actually came from in ~140 sprints of trying.

| Megamem win                                                                 | Size                     | Class                                       | Megadj transfer verdict                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MDL-026 pplx-embed tower swap (SHIPPED)                                     | +2.2pp                   | **Model choice**                            | The lever that wins biggest. Our ladder is exhausted for genre (v2 six-tower rerun); it reopens only with new towers or the MERT layer re-test          |
| MDL-009 GTE-small swap                                                      | +0.85pp                  | Model choice                                | Same class; same-family upgrades only — every cross-architecture swap failed its pre-check                                                              |
| IDX-140 per-doc adaptive chunking                                           | +0.60pp (xcli +2.42 P@1) | Input representation (chunking)             | Our analog is input selection too: audio window/pooling choices per tower — belongs in the MERT re-test protocol, stated up front                       |
| QRY-026 mean-centering α=0.3                                                | +0.34pp                  | **Space hygiene (light)**                   | Already transferred: our all-but-the-top + CSLS ships the same family. Sweep K (#3) to finish the job                                                   |
| IDX-230 entity-aware boundary snapping                                      | +0.2pp                   | Input representation                        | No direct analog (no chunks). Nearest cousin: our cue/phrase placement quality (Phase D) — same "respect the natural boundaries" principle              |
| IDX-247 sentence-TFIDF importance weighting                                 | +0.22pp                  | Input weighting (index-time)                | Transferable shape for future genre evidence: weight frames/windows by information content before pooling instead of uniform mean                       |
| QRY-222 confidence-gated Rocchio PRF                                        | +0.14pp                  | Gated rescue (fires only on low confidence) | Design template for any future B10p tuning: the similarity bonus should gate on pool _quality_ signals, not fire unconditionally                        |
| QRY-207 local-corpus IDF expansion                                          | +0.2pp                   | Vocabulary grounding                        | Audio analog: corpus-statistics normalization (percentile ranks per T17) rather than raw mood values                                                    |
| F1237 IDX-230-class boundary snapping (chk +3.8/rob +3.6/syn +3.3)          | +0.2pp blended           | Input representation                        | Reinforces the class: boundaries/inputs, not scores                                                                                                     |
| SCR-371 CE-as-additional-RRF-leg                                            | +0.17pp (forger)         | Learned component _as a leg_                | The only learned win. If B10p ever adds a learned scorer it must enter the same way: additive tie-break leg, never a replacement of the calibrated core |
| INF-310 sentinel cache validation                                           | 0pp (prevention)         | **Ops: silent-corruption prevention**       | Directly transferable to our embeddings ledger + cache (action #6) — prevention wins are invisible in the scoreboard and still worth shipping           |
| Label/ground-truth fixes (PAR-196 stale-path audits, F1160 bench-label fix) | recovered 3–8pp          | **Ground-truth hygiene**                    | The megamem confirmation of our refold lesson: when measurement looks bad, audit the labels before the model                                            |

Read as a ledger: **model choice (~2pp) > input representation (~0.2–0.6pp each)

> space hygiene (~0.3pp) > gated rescues (~0.1–0.2pp) > learned legs (~0.2pp)**,
> with ops-prevention and label-hygiene wins sitting outside the scoreboard
> entirely. Megadj's own single biggest win — the refold's +7.4 — is a label
> fix, the class megamem's ledger also treats as real-but-invisible. Per-doc
> verdict for our own doc set through this lens: `embedding-models.md` (tower
> decision) matches their model-class findings exactly; `tier0-diagnostics`
> (hubness/probe/whitening) matches their geometry findings and adds the
> measurement they skipped; `02-architecture.md` §3's invariants (pure engine,
> honest payloads, knobs must earn existence) are the same discipline their
> catalog enforces — no contradictions found in either direction.

## 10. Source index (what this doc is built from)

Megamem corpus (mem-bench experiments catalog + engine docs), read Sep 17–18
2026 via the `megamem-devdocs` MCP workspace and the on-disk corpus:

- Model swap arc: MDL-009 (GTE +0.85pp), MDL-026 (pplx +2.2pp, pre-checks),
  MDL-087 (attribution report), MDL-089 (deliberate quality-for-RAM downgrade),
  MDL-049 (INT8-vs-FP32 diagnostic), MDL-063 (corpus-adaptive selection; the
  −38pp wrong-model catastrophe), MDL-032 (pre-check close), MDL-127 (panel,
  unmeasured).
- Space geometry: IDX-031 (centering α-sweep failure curve), MDL-025 (full PCA
  whitening skipped citing F289), IDX-297/IDX-302 (whitening designs, unshipped;
  S143's eigenbasis-less variants −8 to −10.6pp per F1280), QRY-237/239
  (query-side centering/truncation, skipped), F1233 (d_eff 34/1024), F1161
  (PAR-199 geometry baseline: effective rank 479–598/1024), PAR-211 (hubness/
  CSLS design, `status: skipped`), SCR-412 (build-failed), INF-245 (norm-CV
  monitor).
- Quantization/size: MDL-027 (MRL −12.5pp), IDX-169 (768-d re-confirm),
  MDL-028 (binary two-pass AMB regression), SPD-105 (RaBitQ negative),
  SPD-127 (RSVD/TurboQuant), SPD-143 (1-bit), F238 (model/index pinning
  failure), INF-143 (model-versioned cache).
- Methodology/ops: PAR-046 (Wilcoxon, SHIPPED), PAR-049 (retroactive audit),
  F1201 (precision-floor pattern), INF-169 + MEM-026/027 + IDX-215
  (co-retrieval class closed), IDX-211/MDL-090/MDL-094 (MLX/MPS embed servers),
  INF-196 (metrics), F1281 + INF-310 (poisoned caches + sentinels), F1283
  (serve/index separation), F1028 (skip_stats), F968/F1277 (harness-inversion
  incidents), F1278/F1280 (drought post-mortems), PAR-202/F1115/F1205 (oracle
  ceilings + failure taxonomies), DIV-001…019 (diversity family, all closed),
  SCR-334 (leg-overlap diagnostic), plus the megamem engine docs —
  `retrieval-engine-decision-guide` (reranker negativity, hybrid guidance) and
  `perf-deep-dive` — in the megamem repo.

Megadj side: docs/fulltags/embedding-models.md (v2 tower table + fusion sweep),
docs/archive/tier0-diagnostics-2026-09-15.md (hubness/probe/whitened verdicts),
docs/archive/embedding-research-2026-09-14.md (external review + adoption
ladder), docs/megaset/02-architecture.md §2b T10 + §4 (B10p ownership),
cratedeck/shared/megaset.ts (`MEGASET_SIMILARITY_WEIGHT` 0.1),
src/shared/leaf/vector-space.ts (all-but-the-top + CSLS, CSLS_R=10),
src/archive/state-core.ts (embeddings schema — model column still absent,
verified Sep 18).

## 11. Provenance note — workspace health incident during analysis

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
