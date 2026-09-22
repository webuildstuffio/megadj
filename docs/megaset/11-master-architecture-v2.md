# MegaSet v2 — Master Architecture (the synthesis doc)

**Status:** 📐 PROPOSAL — master v2 architecture, synthesized. Every choice below is
evidence-linked to a measured finding in megadj, the megamem corpus (2,003
experiments, ~140 sprints), third-party research, or the engine benchmarks.
Nothing here overrides the [plan of record](03-competitive-analysis.md); this
doc is the architecture layer that binds the evidence together and proposes
what v2 builds, in what order, and what it refuses to build.

v1 · 2026-09-18 · Consumes [01-prd](01-prd.md) (product story),
[02-architecture](02-architecture.md) (v1 engine map — unchanged by this doc),
[10-findings](10-findings.md) (distilled verdicts), the embedding docs in
`../fulltags/` and their archives, and
[embedding-learnings-from-megamem-2026-09-17](embedding-learnings-from-megamem-2026-09-17.md)
(the cross-shop evidence base, v2 same day).

> Naming rule for this doc (census-enforced): backticks are reserved for names
> that exist in this repo. Findings from other repos are cited in prose
> without backticks.

---

## 0. What MegaSet v2 is, in one paragraph

MegaSet v1 is a propose-only set builder: pool the archive census, drop
dead/duplicate files, chain tracks through hard tempo/key/arc gates with a
0.45/0.30/0.25 blend, beam search under 250-track pools, serve the same engine
through CLI/HTTP/MCP/web. **v2 adds exactly four layers, each one already
evidenced, none speculative:** (1) the B10p embedding similarity prior wired
as a capped post-gate tie-break under a pre-registered paired-test protocol;
(2) the Phase D phrase-cue handoff layer, which needs zero new analysis
because the cues ledger is already library-wide; (3) family/ranked-secondary
pools from the Discogs-400 head for "deep end of the family" requests and
hard-cap diversity guards; (4) an ops-hardening set (ledger model pinning,
coverage counters, serve-path refusal, failure taxonomy) that closes every
silent-rot class the megamem corpus documented. Everything else the corpus
taught us to try — solvers, second towers, learned readouts, soft diversity,
co-occurrence reranks, post-fusion reordering — is on the explicit reject
list (§5) with the experiment that killed it.

## 1. Sources synthesized

| Source (all read Sep 17–18, 2026)                                                                                    | What it contributes to v2                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| megamem engine ARCHITECTURE + retrieval decision guide (mem-bench repo, cited in prose — foreign)                    | The 7 cross-shop invariants (§2); reranker negativity; hybrid/fusion calibration discipline; oracle-ceiling method |
| mem-bench experiment catalog (2,003 files; 1,001 failed / 681 done / 279 skipped / 40 queued)                        | The negative-results base: what never wins, across both shops                                                      |
| [embedding-learnings v2](embedding-learnings-from-megamem-2026-09-17.md)                                             | Shipped-wins ledger, ops incidents (poisoned caches, serve-path leaks), the top-10 action list                     |
| [02-architecture](02-architecture.md) §2 variable inventory                                                          | The S1–S20 / T1–T24 frames; v2 only promotes variables whose measurement already exists                            |
| [10-findings](10-findings.md) E1–E8, G1–G13, M1–M7, R1–R10, P1–P3                                                    | The measured verdicts this doc binds into architecture                                                             |
| [tier0 diagnostics](../archive/tier0-diagnostics-2026-09-15.md)                                                      | Hubness tail, no artist leakage, probe loss, refold +7.4 — the readout/architecture split                          |
| [embedding-models](../fulltags/embedding-models.md) + [research review](../archive/embedding-research-2026-09-14.md) | Tower decision (M1–M7); third-party: EDM-subgenre benchmarks, MuQ/TuneJury, licences (R1–R10)                      |
| [genre-audit](../fulltags/genre-audit.md) + [taxonomy sources](../fulltags/genre-taxonomy-sources.md)                | The label pipeline (refold, disputed flags, gates) MegaSet consumes; T2–T5 head-as-signal design                   |
| Engine benchmarks (archived 04) + [08-audit](08-audit-and-plan.md)                                                   | E1–E8 sequencing verdicts; per-item implementation sketches                                                        |
| GitHub issues (roadmap SSOT) — #59 #107 #171 #172 #176 #121 #220 #236 #238 #247 #249                                 | Live scope markers; issues own WHAT/status, this doc owns WHY + architecture                                       |

## 2. The cross-shop invariants (v2 design law)

These seven are forced by convergent evidence from two independent shops
(megadj audio + megamem text). v2 treats them as constitution, not preference:

1. **Cheap hard gates first; soft signals last and small.** Megamem: every
   post-fusion reordering measured −5% to −12%; the calibrated fusion core is
   never touched after the fact. Megadj: tempo/key/anchor gates → weighted
   blend → similarity capped at 0.1. v2 adds no term that mutates a chain
   after scoring.
2. **kNN readout + space hygiene beats learned post-processing.** Probe lost
   here (51.5% vs 62.6%); LoRA/projection-head/CE-replacement all failed
   there; the single learned win (a cross-encoder added as an _additional_
   fusion leg, +0.17pp) defines the only legal shape for a learned component:
   additive leg, never replacement.
3. **One well-chosen tower per leg; ensembles never won in either shop.**
   effnet stays the only audio tower (M1–M4); any future tower change must
   beat it by ≥3 points on the guarded population AND re-quote backfill cost
   AND clear the label ceiling (~60–76% audio-consistent labels — R1/R2).
4. **Enrich the data, not the score.** Both shops' biggest wins were input
   fixes: the label refold (+7.4) here; enrichment/chunking/model-choice
   there. v2's quality budget goes to label/pool/data work first (§7).
5. **Calibration is a first-class lever with a stats gate.** Wilcoxon +
   bootstrap CI on paired per-request scores before any behavior change ships;
   a uniform +0.1-level delta at display precision is a rounding artifact
   until p<0.05 (the F1201 lesson from the megamem corpus).
6. **Honest payloads everywhere.** Coverage, freshness, and exclusion counters
   ride every response (invariant 4 of v1 — now with named counters, §4f);
   the megamem poisoned-cache incident (5 weeks of silent 3–8pp loss under a
   correct-looking model name) is the standing proof of what happens without
   this.
7. **Index-time and serve-time are different trust domains.** Only writers
   create; readers refuse loudly on absence; every stored vector is
   self-describing (model id) and integrity-checkable (sentinel re-embed).

## 3. The v2 shape

Extends [02-architecture](02-architecture.md) §1 — the engine and its four
surfaces are unchanged; everything new is upstream of the engine or a capped
post-gate term:

```
                    ledgers (FullTags owns)
    archive.db ── beats · mood · cues · track_keys
                 embeddings (1280-d) + model column + sentinel-checked cache
                 genre (refolded canonical + disputed flags) + ranked secondaries (head)
    rekordbox mirror (read-only seam) ── BPM×100 · KeyName
         │
         ▼
    space model (fit per corpus, cached): mean-centre + all-but-the-top + CSLS
         │            [vector-space.ts — one SSOT, already shipped]
         ▼
    setCandidates() ── pool census + coverage counters (vectors/eligible, ledger age)
         │             family pools via Discogs-400 head secondaries (v2, T4)
         │             diversity = HARD caps (artist-adjacent=0, family-run≤3)
         ▼
    buildMegaset() ── pure engine, zero I/O (unchanged)
         │            hard gates: ±6% tempo, Camelot clash, opener neighborhood
         │            blend: 0.45 tempo + 0.30 key + 0.25 arc-fit (frozen, E6)
         │            B10p prior (v2): whitened-space cosine kNN bonus,
         │              weight ≤ 0.1, applied AFTER all gates as tie-break only,
         │              gated behind the pre-registered A/B (§4b)
         ▼
    MegasetResult ── steps[] · excluded[] + reasons · pool/freshness/coverage
         │             + failure-taxonomy block (v2: aggregate reasons, §4e)
         ├─▶ CLI / HTTP(+m3u8) / MCP / web — parity-pinned, no new surfaces
         └─▶ rb-playlist (Phase D, v2): M3U8 comments carry typed handoff
               windows from the cues ledger — propose-only, never auto-writes
```

## 4. Component specs (the v2 delta)

### 4a. Embedding subsystem — effnet-only, self-describing, diagnosable

- **Tower:** discogs-effnet 1280-d, decided by M1–M7 and re-confirmed by the
  six-tower v2 rerun. No second tower, no second ledger (fusion M4, cost M7,
  megamem's MDL-127 never won anywhere). The MERT per-layer re-test is the
  only live tower question and stays queued with its pooling plan stated up
  front (the architecture-compatibility lesson: pooling must be declared
  before the run, not discovered after).
- **Ledger:** add a per-row `model` column before anything else writes
  (verified missing Sep 18; `cues` already carries one, and the migration
  seam is one line). This is action #1 of the learnings doc — cheap now,
  prevents the mixed-ledger silent-poison class forever.
- **Cache integrity:** the embed cache must be checkable against the live
  writer (model + dim at minimum; sentinel re-embed when a second writer ever
  becomes possible). The megamem F1281 incident — poisoned vectors under a
  correct model-name header, reproduced byte-for-byte by deterministic cache
  hits for five weeks — is the class.
- **Space model:** whitened+CSLS is shipped and flag-gated; v2's remaining
  work is calibration, not mechanism: run the spectral diagnostic
  (SVD eigenvalue spectrum + participation ratio over the live matrix —
  the recipe is the megamem IDX-245/PAR-199 pattern, ~2s of NumPy) to measure
  our own anisotropy, then sweep the all-but-the-top K instead of trusting
  the imported default of 2.
- **Sanity gate:** any tower/rerun work passes a 20-track sanity diagnostic
  first (finite norms, fails=0, expected score band) — the MDL-026 pattern;
  our v1 broken-harness inversion (musicnn) is the reason this is law.

### 4b. B10p similarity prior — the exact wiring, protocol pre-registered

- **Form:** cosine kNN in the whitened space over the effnet ledger; bonus =
  `MEGASET_SIMILARITY_WEIGHT` (0.1, existing const) × normalized similarity;
  applied strictly after tempo/key/arc gates as a tie-break among
  already-legal transitions. It can reorder near-ties; it can never rescue a
  track the gates excluded, and it can never be promoted without the A/B.
- **Pre-registered protocol (write the verdict criteria BEFORE the run):**
  paired per-request comparison (same preset/pool/minutes/opener, prior on vs
  off), n ≥ 180 requests per arm (the E6-derived effect size is tiny by
  construction — power the test for chain-level metrics: chain length,
  meanTr, excluded-rate, not mean score); Wilcoxon signed-rank + 95%
  bootstrap CI; ship requires p<0.05 AND CI excluding zero AND no preset
  regressing beyond its own CI; a uniform +0.1-level shift is treated as the
  display-precision floor (F1201), not signal. `--space raw|whitened` rides
  as a factor. The protocol and verdict get written into
  [08-audit](08-audit-and-plan.md) when the run happens.
- **Why this shape is safe by construction:** it is the megamem-fusion
  architecture from the other direction — cheap calibrated core untouched,
  one additive secondary signal, capped small. Their INF-169-class result
  (co-occurrence neighbors add 0.00pp at fusion time because top-K already
  contains the right items) predicts the observable effect is small — which
  is exactly why the protocol demands chain-level powering instead of mean
  score.

### 4c. Phase D handoff layer — zero new analysis, all plumbing

- The cues ledger is already library-wide (3,605 rows; avg 22.5 cues/track;
  3,496 tracks with ≥8 cues; mixout p50 = 14.5 s) and downbeats ride the
  beats ledger. v2 computes, per chained transition, the mixout point of the
  playing track (first phrase cue past its intro window) and the mixIn of the
  successor, and emits **typed transition windows as M3U8 comments** —
  list-only export, import into rekordbox stays manual, propose-only holds.
- Acceptance: ≥95% of chained transitions carry a valid handoff window on the
  100-mix test (P100), with honest `no-cue` markers on the remainder — never
  invented cue math for missing data (invariant 5: missing weakens the claim,
  never fakes one).
- Cue semantics stay DB-convention-safe: hot cues are `Kind = 1` (pads),
  memory cues `Kind = 0` — any future write path re-verifies against the
  hand-authored reference before shipping (the intake-cue postmortem rule).

### 4d. Family pools + diversity as hard caps

- The Discogs-400 head runs on cached embeddings for free (~1 ms/track) and
  recovers family at 69/77% (top-3/top-5) with Jaccard 0.486 vs kNN —
  complementary, not redundant (T3/T4). v2 uses it for: per-track ranked
  secondaries feeding **family-scoped pool requests** ("deep end of the
  family"), and the B6 diversity guard over the refolded family map
  (93.4% coverage).
- **Diversity stays hard-capped** (artist-adjacent = 0, family-run ≤ 3): the
  megamem DIV family — all 19 diversity experiments — died neutral or worse,
  and the only surviving mechanism was a hard limit; a soft penalty redistributes
  scores without changing outcomes. Any soft variant would need a §4b-grade
  paired A/B, and the base rate says it loses.
- The genre labels feeding pools are post-refold canonical + disputed-flagged
  (96 rows flagged, 3.2%) — pools consume the ledger's honest state, including
  its refusal rate (20.7% → 13.0% post-arbitration).

### 4e. Failure taxonomy — let the exclusions pick the next lever

Every `MegasetResult` already carries `excluded[]` with reasons. v2 adds one
aggregation: the taxonomy block (counts by reason class: no-BPM, key-clash,
arc-dead-end, budget-shortfall, opener-starved, duplicate-collapsed,
relocated-missing). This is the PAR-197/F1115/F1205 pattern that redirected
megamem's roadmap twice (FUSION_FAIL 72.5% dominance; RANK_FAIL 37.7% forger):
**run the taxonomy first; the biggest bucket picks what v2.1 builds.** No new
instrumentation — it is a query over data already on the wire.

### 4f. Ops hardening (the silent-rot closes)

1. **Coverage counters** on every embedding-reading surface: rows-with-vectors
   vs eligible tracks, ledger age per table — the pool census already reports
   honestly; this extends the invariant to the vector leg.
2. **Serve-path refusal:** retrieval surfaces error loudly on an empty/absent
   embeddings ledger; they never fabricate one (the megamem F1283
   create-on-read leak, inverted for our ledger world).
3. **Ledger freshness rides payloads** (existing invariant, now counted).
4. **No new services:** any future long-running surface must not become an
   orphaned bare process — the deck server's ground truth is an orphan, not a
   launchd service (#247); if v2 ever needs a daemon it gets a supervised
   definition, not a detached spawn.
5. **Workspace hygiene interplay:** tmp fixture families are the measured
   #1 suite-wedge cause (25,892 dirs / 12.5 GB before `tmp-purge`); bench
   scripts use `tempState()` lifecycles, never bare `/tmp/megadj-*` litter.

## 5. Explicitly rejected for v2 (each with its killing evidence)

| Rejected                                         | Evidence that killed it                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact solvers (Held-Karp DP)                     | E5: OOM at n=30; unnecessary at 29 ms greedy / 157 ms beam at 20k (E2)                                                                                                    |
| 2-opt repair                                     | E3: +0.0% on real pools                                                                                                                                                   |
| User-facing weight knobs                         | E6: 5 variants moved mean <0.006 — a knob that does nothing                                                                                                               |
| Second tower / second ledger / tower ensembles   | M2–M4 + MDL-127-class unmeasured panel in both shops; fusion best +1.1 inside noise at 2–6× cost                                                                          |
| Naive rank fusion                                | M5: descending-rank silently selects least-similar neighbors                                                                                                              |
| Linear probe / learned readout                   | tier-0: 51.5% vs kNN 62.6%; megamem's LoRA/projection-head sprints shipped nothing; the one learned win was an additive leg                                               |
| Soft diversity penalties                         | All 19 megamem DIV experiments neutral-or-worse; hard limit was the survivor (§4d)                                                                                        |
| Co-occurrence / co-retrieval reranking           | INF-169 0.00pp + the S133 class closures (spreading activation, injection, hyperedge) — top-K already contains the items; T15 stays parked for sparse-pool expansion only |
| Any post-fusion reordering                       | megamem decision guide: every reranker negative, −5% to −12%; breaks calibrated weights                                                                                   |
| MRL truncation / binary-quant / TurboQuant-class | MDL-027 −12.5pp; MDL-028 regression; RaBitQ negative; we have zero storage/scan pressure at 3.6k vectors (§2.3 learnings)                                                 |
| MLX embed server for our stack                   | R9: wrong tool at every layer (18 MB head job / rent-a-GPU fine-tune); AGENTS sync-writer rule unaffected                                                                 |
| SPLADE/HyDE/classic-PRF-style text machinery     | Inapplicable (no text queries); measured negative in their domain anyway                                                                                                  |
| Stems / Demucs, MuQ, cloud anything              | R8 (effnet is CLAP-side; gains don't transfer), no ONNX/small base, licence + principles (real sources only, local only)                                                  |
| SQLite-FTS-style DB text search for pools        | megamem's engine comparison: 55pp structural gap vs a real index — irrelevant here anyway: MegaSet reads ledgers, not text                                                |
| Genre playlists                                  | House rule: one playlist per dated intake under DJ-Imports, never genre playlists                                                                                         |

## 6. Benchmarks & gates (how v2 proves itself)

- **Standing gates carried forward:** genre ≥65% ship gate (met: 69.2% gated
  LOO post-refold); `genre --eval` is the regression harness; surface-parity
  pins hold for every surface touch.
- **B10p:** the §4b protocol IS the gate; no weight touch without it. Verdict
  lands in 08-audit with the run artifacts.
- **Phase D:** ≥95% valid handoff windows on the 100-mix test; zero invented
  windows.
- **Family pools:** measured as pool-recall improvement on sparse pools
  (chain-length delta via E7's automatic beam pick), not mean transition
  score — the sparse-pool lesson from the co-occurrence post-mortem.
- **Ops:** coverage counters present on all reading surfaces (parity-pinned);
  ledger `model` column migration verified by a round-trip test.
- **Every benchmark run:** records fails=0, seed, eval-set hash, and the
  harness version line — the inversion-class rule (a harness bug doesn't lose
  data, it inverts conclusions: F968/F1277 there, musicnn v1 here).

## 7. Build order (dependency-honest, cheapest-first)

1. **Ledger `model` column + round-trip test** (hours; blocks nothing, gates everything vector-side).
2. **Failure-taxonomy block** on the megaset payload (one aggregation query) — read it before building anything else downstream; it re-ranks steps 4–6.
3. **Coverage counters + serve-path refusal** (small; closes §4f).
4. **Spectral diagnostic + K sweep** (an afternoon; calibrates the space model).
5. **B10p pre-registration → A/B run** (the first §4b-legal behavior change; verdict into 08-audit).
6. **Phase D handoff windows** (plumbing only; data exists; independent of 5 — can parallel).
7. **Family/secondaries pools + hard-cap diversity wiring** (needs the head run + refolded families — both already shipped).
8. **Post-v2 (only on evidence):** MERT per-layer re-test if §4e/§4b show retrieval is the binding constraint; T15 sparse-pool expansion eval; LUFS pass (#172) behind its measured 50-min cost quote.

## 8. Relationship to the doc set (no twins created)

[02-architecture](02-architecture.md) remains the engine map and variable
inventory (its §3 invariants are restated here as law, not replaced);
[10-findings](10-findings.md) remains the distilled-verdict entry point;
[03-competitive-analysis](03-competitive-analysis.md) remains the plan of
record; this doc is the v2 architecture synthesis. When a §4 component ships,
its spec line here gains a shipped marker and the code becomes the SSOT —
this doc documents, never twins.

## 9. Source index (dates; foreign repos cited in prose)

- **Megadj (this repo):** 01-prd, 02-architecture, 03-competitive-analysis,
  08-audit-and-plan, 10-findings (all Sep 13–15 states, verified Sep 18);
  genre-audit, genre-pipeline, genre-taxonomy-sources, embedding-models,
  fulltags-roadmap; archive: embedding-research-2026-09-14,
  tier0-diagnostics-2026-09-15, set-04-sequencing-benchmarks-2026-09-14;
  megaset/embedding-learnings-from-megamem-2026-09-17 (v2, same-day);
  src/deck/shared/megaset.ts (weight const 0.1, beam consts),
  src/shared/leaf/vector-space.ts (all-but-the-top + CSLS, CSLS_R=10,
  CSLS_REF_CAP=1500), src/archive/state-core.ts (embeddings schema — model
  column absent, verified Sep 18).
- **Megamem corpus (foreign, prose):** mem-bench ARCHITECTURE reference
  (R90 baseline table, component map, decision lineage) and retrieval-engine
  decision guide (hybrid-vs-BM25 asymmetry, +8.8pp blended hybrid gain,
  18.1% both-engines-fail ceiling, reranker negativity, sqlite-vec
  normalization failure, corpus-type selection matrix), experiments catalog
  census + findings ledger through F1284, benchmark accomplishments
  (~4,000 runs, ~140 sprints), MLX embed-server writeups (IDX-211/INF-196).
- **Third-party (via the research review, R1–R10):** EDM-subgenre benchmark
  (arXiv:2110.08862 — 60.6% @30 classes sets the realistic band), MuQ-Eval
  (frozen-beats-finetune), TuneJury (projection-head recipe),
  stems study (arXiv:2601.19109), PyTorch-MPS-vs-MLX training
  (arXiv:2501.14925), Radovanović hubness + Conneau CSLS +
  Mu & Viswanath all-but-the-top (the space-correction trio already in
  vector-space.ts).
