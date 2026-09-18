# MegaSet / FullTags — Consolidated Findings, Learnings & Next Actions

**Status:** ✅ CURRENT — the single entry point for everything measured across
the MegaSet doc set (2026-09-13/14). Deep dives live in the linked docs; this
page holds the distilled verdicts, the critical-bug list, the prioritized
next steps, and the glossary (§5).

---

## 0. Read me first (what this product is, in one paragraph)

MegaSet turns megadj's already-measured library data into an **ordered,
playable mix proposal**: it pools the whole archive, drops dead/duplicate
files, then chains tracks that agree on tempo (±6%), musical key (Camelot
wheel), and energy (a preset's arousal arc). It is **propose-only** — it
never writes tags, playlists, or the rekordbox DB without the gated
`rb-playlist` write-off (rekordbox closed → dated backups → twin write →
verify). The same engine serves four surfaces: the `megadj megaset` CLI,
the HTTP API (+ M3U8 export), the MCP tool for agents, and the FullTags
web panel. Everything below is measured evidence for the design choices.

## 1. What we now know (every finding, one line each)

### MegaSet-builder engine ([04-sequencing-benchmarks (archived)](../archive/set-04-sequencing-benchmarks-2026-09-14.md))

| #   | Finding                                      | Number                                                                                                          |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| E1  | Greedy sequencing collapses in sparse pools  | −56 to −59% chain score vs beam                                                                                 |
| E2  | Engine speed is a non-issue                  | 29 ms @ 3.6k tracks, 157 ms @ 20k                                                                               |
| E3  | 2-opt repair is worthless at scale           | +0.0% on real pools (only fragile chains)                                                                       |
| E4  | The compatibility graph is sparse            | 12.3% of pairs pass both gates                                                                                  |
| E5  | Exact solvers are infeasible                 | Held-Karp OOM at n=30                                                                                           |
| E6  | Score weights barely matter                  | 5 weight variants moved mean <0.006 → frozen constants                                                          |
| E7  | **Beam search under ~250 tracks is the win** | +59% chain length at 0 ms cost (B=8) — **SHIPPED 2026-09-14: engine picks automatically, `search` on the wire** |
| E8  | Arc adherence holds across presets           | warmup/peak/afterhours envelopes track                                                                          |

### Genre ([genre-audit](../fulltags/genre-audit.md) v3, [taxonomy sources](../fulltags/genre-taxonomy-sources.md))

| #   | Finding                                                   | Number                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| G1  | Labels are a formatting mess, not a truth problem         | 459 raw → 440 casefolded; 88% duplicates; 105 labels cover 90%                 |
| G2  | Family-level audio structure is real                      | LOO k=5: 57.6% ungated / 62.7% gated at the v3 measure; the Sep 17 refold readout is **61.9% → 69.3%** — live numbers live in [genre-audit](../fulltags/genre-audit.md) |
| G3  | Sub-genre labels mostly don't survive audio               | 3–27% survival across 6 clusters (deep house 3%, tech house 18%, hardtekk 44%) |
| G4  | Old "39% @150 queries" was sampling noise                 | 30-round rerun: 55.9% ±3.5 ≈ full population                                   |
| G5  | Duration guards (90–480 s) are hygiene, not accuracy      | −0.2 pt on this metric                                                         |
| G6  | No label source is audio-truth; RB > ingest is conclusive | RB 58.4% CI[56.4,60.2] vs ingest 53.1% CI[48.6,58.0], p=0.046                  |
| G7  | File TCON is an output, never a source                    | DB↔file exact agreement 81%; numeric SC IDs baked into files                   |
| G8  | Numeric SC genre IDs never entered the DB                 | 0 rows — the write-point guard holds                                           |
| G9  | Coverage is high and real                                 | 94.4% (3,458/3,664); 30-row spot check: 0 placeholders                         |
| G10 | Analysis ledgers are library-wide, not a 500-batch        | mood 3,659 · beats 3,610 · cues 3,605 · embeddings 3,618                       |
| G11 | Escape artifacts were real but shallow                    | 19+ rows `\u0026` — fixed in `normalizeGenre` (+tests)                         |
| G12 | Family map v2 covers 93.4%                                | additions audio-verified via the head (grime→bass, tekk→techno, …)             |
| G13 | Junk-label rule is now explicit                           | non-genre strings / placeholders / DJ-tool categories                          |

### Taxonomy sources ([genre-taxonomy-sources](../fulltags/genre-taxonomy-sources.md))

| #   | Finding                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Beatport** is the DJ-genre standard (live 2-tier, ~36 mains); **Discogs** the style standard (400 fixed styles); **Every Noise** frozen Feb 2024 (lookup only); SC = provenance |
| T2  | Essentia ships a `genre_discogs400` head that runs on our cached embeddings — free ranked styles                                                                                  |
| T3  | Head as oracle: top-1 46.1% — kNN beats it conclusively (McNemar p=2×10⁻³⁰)                                                                                                       |
| T4  | Head as signal: top-3/top-5 ≈ 69/77% family recovery; Jaccard vs kNN 0.486 = complementary → ranked-secondaries backbone                                                          |
| T5  | Deterministic LLM residue-pass design: ~459 labels, temp 0, vocabulary-constrained, validated before write — last resort after refold + head                                      |

### Embedding towers ([embedding-models](../fulltags/embedding-models.md))

| #   | Finding                                                         | Number                                                                                                            |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| M1  | **effnet-discogs-1280 is the measured best single tower**       | LOO 0.444, coherence 0.362, 0.56 s/track (0.8 h per 5k)                                                           |
| M2  | v1's "musicnn wins" was a broken-harness artifact               | inverted: musicnn 0.300 vs effnet 0.444 at n=180                                                                  |
| M3  | MERT-v1-95M fails on this library — representation, not pooling | 0.256–0.267 across 3 pooling schemes, at 7× cost — **provisional: layer depth never varied** (research review F1) |
| M4  | Ensembles buy almost nothing                                    | best +1.1 pt (mean-cos effnet+musicnn+mert) at 2–6× cost                                                          |
| M5  | Rank-fusion is a silent trap                                    | descending-rank fusion selects _least_-similar neighbors                                                          |
| M6  | CLAP is worst-in-class for music kNN                            | 0.244 — text-alignment towers don't cluster music                                                                 |
| M7  | 5k-library projections (single pass)                            | effnet 0.8 h · musicnn 1.0 h · vggish 1.0 h · openl3 4.1 h · MERT 5.4 h · clap 0.7 h                              |

### External research review (Sep 14 — [embedding-research-2026-09-14](../archive/embedding-research-2026-09-14.md))

| #   | Finding                                                                                              | Number / source                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **0.444 is not embarrassing — we compared to the wrong benchmark**                                   | best published EDM-subgenre: **60.6%** @ 30 classes, 75K songs (arXiv:2110.08862); realistic target **0.65–0.75**, not 0.9                                        |
| R2  | **Random-noise LOO ceiling ≈ 0.58** (p≈0.68 × 0.85) — effnet is at ~77% of it                        | ~14 pts of headroom in this basin; systematic (non-random) label errors ⇒ no ceiling — diagnostic 0.1 decides                                                     |
| R3  | **Frozen kNN is the weakest readout**; the literature probes linear heads on frozen features         | comparable towers hit 82–88% on GTZAN with a probe; expected +12–20 pts on genre — **MEASURED OPPOSITE Sep 15: probe 51.5% vs kNN 62.6% — kNN stays (tier-0 §4)** |
| R4  | **Artist leakage unmeasured in our LOO** (effnet = Discogs-metadata tower, likeliest to fingerprint) | Sturm "horse" critique; >15% same-artist top-5 ⇒ rerun artist-disjoint — **MEASURED ABSENT Sep 15: 4.2%, Δ −0.8**                                                 |
| R5  | **Hubness/anisotropy never corrected** (no mean-centre/whiten/CSLS)                                  | fix ≈ 10 lines; expected +3–8 pt coherence — **hub tail CONFIRMED Sep 15; whitened space shipped flag-gated**                                                     |
| R6  | **Fine-tuning is answered: frozen wins**                                                             | MuQ-Eval A1 (frozen) beats LoRA and full-FT (12 GB, didn't win); naive MERT full-FT examples are garbage                                                          |
| R7  | **The projection-head recipe is published**                                                          | TuneJury: 2.8M MLP over frozen towers, pairwise-logistic, 17.5K prefs                                                                                             |
| R8  | **Stems: +3.6 pt on MuQ, but CLAP got worse** — effnet is CLAP-side                                  | 86.8→90.4% (arXiv:2601.19109); gate any Demucs work behind a 200-track probe                                                                                      |
| R9  | **MLX is a detour**: head training is an 18 MB CPU job; fine-tune = rent a GPU-hour                  | PyTorch-MPS beats MLX at training (arXiv:2501.14925)                                                                                                              |
| R10 | **Licences: everything strong is NC**; only CLAP (CC0)/VGGish (Apache) are clean, both weak          | flag for any future CrateDeck monetization decision                                                                                                               |

### Sequencing-adjacent (08/09 plans)

| #   | Finding                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Full surface parity (CLI/MCP/web) + freshness payloads shipped for megaset                                                                                                                                                               |
| P2  | `rb-playlist` writes twinned rows through one seam, dry-run default                                                                                                                                                                      |
| P3  | `setbuild → megaset` identifier migration **EXECUTED 2026-09-15** (evening) — the product is **MegaSet**; verb `megadj megaset`, route `/api/archive/megaset`, tool `megaset_propose`, `Megaset*` identifiers throughout. No alias kept. |

## 2. Critical bugs to fix (all known, none blocking today)

| #   | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Impact                                                | Where                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| B1  | ~~**`dance`→edm is a least-wrong mapping**~~ **FIXED Sep 15** — the refold's umbrella arbitration landed exactly as prescribed: scoring-family arbitration for plain `edm`/`Dance`/`Electronic` + umbrella-split canonicalizations, measured 61.7% → 69.2% gated LOO (+7.4, inside the predicted +6–12 band); the `dance`-family mapping and plain-`edm` arbitration both went through the head+kNN dispute pass. Hard-dance/eurodance/nightcore stayed in `edm`; ALL Tier-1 sub-genre labels (hardtekk etc.) kept. | RESOLVED: +7.4 pts realized                           | refold dispute pass (§5b.3.1) — **done**                         |
| B2  | **`melodic house & techno` → house** (regex order)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | soft: melodic-techno tracks vote house                | family-map ordering; needs head-verified rule before change      |
| B3  | **Rekordbox dedup must remain fingerprint-proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | name-only matching can quarantine distinct recordings | shipped guardrails live in `megadj rb-dedup` tests               |
| B4  | 206 unlabeled tracks (203 embedded)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | coverage 94.4→99.9% available                         | `genre --apply` inference exists                                 |
| B5  | ~~389 slash-soup multi-genre rows unrefolded~~ **HEALED Sep 15** — the refold's multi-label split ranked secondaries on these rows (specific-outranks-umbrella)                                                                                                                                                                                                                                                                                                                                                     | resolved: Tier-1 display cleaned                      | refold pipeline step 1 — **done**                                |
| B6  | ~~`genre --eval` harness not yet a command~~ **SHIPPED 2026-09-14** — `megadj genre --eval` runs the LOO harness over the live DB; reproduces the v3 baseline exactly (n=2,982, gated 62.6%, refusal 19.8%)                                                                                                                                                                                                                                                                                                         | hygiene regression gate now standing                  | §5b.3 step 4 — done                                              |
| B7  | `hardtekk` family vote n=9 — fragile regex from tiny sample                                                                                                                                                                                                                                                                                                                                                                                                                                                         | soft: misvotes possible                               | revisit with a bigger population — refold shipped; pop unchanged |

## 3. Next 3–5 things (ordered, with why)

**Reordered Sep 14 (user call): genre/readout quality BEFORE any further
set-generation work** — genre is the easier goal and the better input to
every downstream pool. **Sep 15 update: the refold (item 2) and the
demote-and-flag pass SHIPPED (61.7% → 69.2% gated LOO, ≥65% target PASS;
96/2982 labels flagged disputed — [genre-audit §5b.3](../fulltags/genre-audit.md),
[tier-0 verdicts](../archive/tier0-diagnostics-2026-09-15.md)); the probe
lost to kNN (item 3 below), so the readout thread is closed.**

1. **Tier-0 diagnostics** (research review §5, ~4 h): label-error clustering
   by artist/imprint · artist-overlap rate in top-5 neighbours · hubness
   histogram · confusion matrix + top-2 in `genre --eval`. _Why:_ they decide
   whether the label ceiling is real (random noise) or a story (systematic
   mislabelling), and whether effnet's LOO lead is genre inference or artist
   fingerprinting. Everything below is re-ranked by their output.
2. **Run the genre refold for real** (`megadj genre --refold`, §5b.3 steps
   1–2), now extended with the **plain-`edm` umbrella arbitration** (B1's
   sibling: `edm` is a parent of house/techno/trance — every plain-`edm`
   track is a forced LOO error; expected +6–12 pts alone). _Why:_ everything
   downstream — B6 diversity guard, family-based pools, ranked secondaries,
   the disputed-flag pass, the (now shipped) eval harness — consumes its
   output, and it is S-sized with a measured target (105 labels → 90%).
3. ~~**Full-population LOO + the probe experiment** (`genre --eval
--probe`, `--artist-disjoint`; n=3,500 instead of 180)~~ **DONE Sep 15**
   ([tier0-diagnostics](../archive/tier0-diagnostics-2026-09-15.md)):
   ran live at full population (n=2,982); the probe **lost** to kNN
   (51.5% vs 62.6%, Δ −11.1 — R3's literature prior does not hold
   here) and artist leakage is absent (4.2%), so the tower-swap/probe
   thread is closed, not opened. _Outcome:_ falsifiable error bars
   delivered; the readout question answered against the probe.
4. ~~**`--apply` the 203 embedded-but-unlabeled tracks** (B4)~~ — still
   open, unchanged. _Why:_ the eval gate is now standing, so the fill's
   effect is measurable before/after; `--apply` converts the gap into
   coverage honestly (COALESCE never clobbers).
5. **Ranked secondaries via the Discogs-400 head** (§5b.2 + 07 §2, T4). _Why:_
   minutes of compute on cached embeddings buys per-track ranked styles for
   MegaSet's "deep end of the family" pools and the B6 family-union fix — the
   single biggest quality-per-hour item left.
6. **Multi-source genre vote ladder + Bandcamp arm + transition-window
   similarity** (genre-audit §5b.3.6–7) — the user-directed additions;
   queued right behind the refold/disputed pass they extend.
7. ~~**Beam-search-under-250 in the set builder**~~ **SHIPPED 2026-09-14**
   (04, E7): `SET_BEAM_POOL_MAX=250`/`SET_BEAM_WIDTH=8` in
   shared/megaset.ts; automatic pick, `search` reported on the wire
   (HTTP/CLI/MCP/UI), `?search=` forces either strategy for A/B.
   Regression-tested: greedy stranded at 2 where beam chains 7+ on the E7
   fixture.
8. **Execute the `setbuild → megaset` migration** (09) — ✅ done 2026-09-15. _Why:_ pure rename,
   fully planned, do it once the worktree is quiet so docs, code, and skill
   stop living under two names.

**Not next** (deliberately): further set-generation work until the genre
ladder above lands (user call, Sep 14); LLM residue pass (only after the
refold + head shrink the unmapped set); second embedding ledger (M4 says
no); any tower switch (gate closed; MERT rejection provisional pending the
per-layer re-test); stems (R8: MuQ-specific gain, effnet is CLAP-side —
200-track probe first); MuQ (no ONNX, no small base); MLX (R9: wrong tool
at every layer of this problem); crowd-sourced co-occurrence; solver
engines; cloud anything.

## 4. Doc map (what lives where)

| Doc                                                                                          | Role                                                                                           | State                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| [01-prd](01-prd.md)                                                                          | Product brief, kill criteria, F1–F7                                                            | current                |
| [02-architecture](02-architecture.md)                                                        | Engine shape, variable inventory (20 set + 24 song vars)                                       | current                |
| [03-competitive-analysis](03-competitive-analysis.md)                                        | 30 comparators + re-ranked roadmap (plan of record)                                            | current                |
| [04-sequencing-benchmarks (archived)](../archive/set-04-sequencing-benchmarks-2026-09-14.md) | E1–E8 measured engine claims                                                                   | current                |
| [genre-audit](../fulltags/genre-audit.md) (was 05)                                           | Genre policy + v3 statistical revalidation (FullTags doc)                                      | current                |
| [embedding-models](../fulltags/embedding-models.md) (was 06)                                 | Tower benchmark, fusion sweep, MERT verdict (FullTags doc)                                     | current                |
| [genre-taxonomy-sources](../fulltags/genre-taxonomy-sources.md) (was 07)                     | Beatport/Discogs/EN anchors, Discogs-400 head, LLM design (FullTags doc)                       | current                |
| [embedding-research-2026-09-14](../archive/embedding-research-2026-09-14.md)                 | External research review: towers, probes, compute, licences + adoption verdicts (FullTags doc) | snapshot               |
| [08-audit-and-plan](08-audit-and-plan.md)                                                    | Implementation audit + per-item sketches (reference)                                           | reference              |
| [09-migration-plan (archived)](../archive/set-09-migration-plan-2026-09-15.md)               | `setbuild → megaset` atomic rename plan                                                        | ✅ executed 2026-09-15 |
| [tier0-diagnostics-2026-09-15](../archive/tier0-diagnostics-2026-09-15.md)                   | Tier-0 diagnostics battery, first live run (Sep 15 verdicts)                                   | current                |
| [10-findings](10-findings.md)                                                                | **this page** — distilled verdicts + next actions                                              | current                |

---

## 5. Glossary — every acronym and term used across the doc set

**Identifier systems used in these docs:** `E#` = engine benchmark experiment
(04), `G#` = genre-audit finding ([genre-audit](../fulltags/genre-audit.md)),
`T#` = taxonomy finding
([genre-taxonomy-sources](../fulltags/genre-taxonomy-sources.md)),
`M#` = embedding-model finding
([embedding-models](../fulltags/embedding-models.md)) — these three live in
`docs/fulltags/` (FullTags owns the analysis stack; MegaSet consumes it) —
_also_ M66-style numbers are idea-IDs
from the archived [docs/archive/ideas-2026-09-15.md](../archive/ideas-2026-09-15.md)
(M66 = the original set-builder idea row), `S#` = set
variable (02 §2a), `T#` in 02 = song/track variable (02 §2b, separate
numbering from 07's T#), `B#` = bug/plan items (08/audit Phase A–D),
`F1–F7` = PRD feature list (01), `P#` = plan/parity findings (§1 here),
`C#` = Phase-C items (08). Same letter, different doc = different series.

**DJ & music theory:**

| Term                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BPM                           | Beats per minute — the tempo measurement from the beats ledger. The ±6% "tempo gate" means a transition's tempo distance must stay inside ±6% (1.0 score within ±2%, linear to 0 at ±6%).                                                                                                                                                                                                         |
| Camelot / TKEY                | Two names for the same key system. **Camelot**: the Open-Key wheel notation where each key is `1–12` + `A` (minor) / `B` (major) — e.g. `8A`. **TKEY**: the tag/file-side key string we parse into Camelot (`shared/camelot.ts` is the single parser). Compatible "moves": same number ±1 same letter (1.0), the diagonal (0.9), or the relative major/minor "mood lift" (1.0); a clash scores 0. |
| Arousal / valence / dance     | The three mood-ledger axes from the ONNX mood heads. Arousal = energy/intensity (1–9); valence = positivity (1–9); dance = danceability (0–1). Measured surprise: valence is nearly flat in this library (stdev 0.12) so it was demoted; `aggressive`/`happy` heads have real spread and are the promoted axes.                                                                                   |
| Energy arc / preset           | The target arousal trajectory a set should follow. Three shipped presets: **warmup** (rises gently), **peak** (climbs to maximum), **afterhours** (drifts down). Registry: `MEGASET_PRESET_DEFS` in `shared/megaset.ts`.                                                                                                                                                                          |
| Hot cue / memory cue          | Rekordbox cue types. Hot cues (A–H) are pad-triggered performance points; memory cues are plain markers. DB rule: `djmdCue.Kind = 1` hot, `0` memory (pads only read `Kind=1`).                                                                                                                                                                                                                   |
| 8-bar phrase / mixout / mixIn | Phrases = structural boundaries every 8 bars (cue ledger rows). Mixout = where the playing track hands over (first cue past the intro); mixIn = where the next track's usable audio starts. Phase D's handoff layer plans these explicitly.                                                                                                                                                       |

**Engine & algorithms:**

| Term                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greedy                      | The shipped default sequencer: repeatedly take the highest-scoring next track. Fast (29 ms at 3.6k tracks) but myopic — a locally-best pick can strand the chain in sparse pools.                                                                                                                                                                                                               |
| Beam search / beam-B8       | A sequencer upgrade: keep the best B=8 partial chains per step instead of 1, so a doomed branch is pruned while alternatives survive. Measured +59% chain length in sparse pools at 0 ms cost. Ships automatically when the pool is < `SET_BEAM_POOL_MAX` (250); force either strategy with `?search=` / `--search` / the MCP `search` param.                                                   |
| 2-opt                       | A repair pass: reverse any chain segment if the total transition score improves. Cheap; fixes ordering, never dead-ends (reversal adds no edges). Measured +0.0% on big pools — kept as free polish.                                                                                                                                                                                            |
| Held-Karp / DP              | The exact longest-path dynamic program: O(2ⁿ·n²). Reference-only in this doc set — it OOMs at n=30, which is why exact solvers are a non-goal.                                                                                                                                                                                                                                                  |
| LOO (leave-one-out)         | Evaluation method: for each track, hide its label, let its k nearest audio-neighbors vote, and see if the vote agrees. The number (e.g. "LOO k=5 = 62.7%") is the share of tracks whose label survives its own neighbors — our genre/audio consistency metric.                                                                                                                                  |
| kNN                         | k-nearest-neighbors: similarity search over embedding vectors (cosine). Powers both "sounds like" and the genre eval.                                                                                                                                                                                                                                                                           |
| Linear probe                | A logistic-regression (or small linear) classifier trained ON TOP of frozen embedding vectors. The literature-standard readout for genre benchmarks — learns which of the 1280 dims carry family information instead of weighting all equally like cosine kNN. Planned as `genre --eval --probe`; gate = beat the kNN vote by ≥3 pts.                                                           |
| CSLS / hubness              | Hubness: in high-dim cosine spaces a few "hub" tracks appear in everyone's top-k, wrecking retrieval coherence. CSLS (Cross-domain Similarity Local Scaling) penalises each candidate by its own neighbourhood density, and mean-centring + whitening removes the few dominant directions that encode loudness/production instead of genre. Fix ≈ 10 lines; hubness histogram = the diagnostic. |
| Classification vs retrieval | Two DIFFERENT problems sharing one tower: `megadj genre` is classification (a probe head fixes it); "sounds like" is retrieval (probe does nothing — whitening/CSLS and a projection head fix that). Measuring both with two correlated metrics stalled the benchmark (research review).                                                                                                        |
| Cosine / coherence          | Cosine = the similarity of two embedding vectors (1.0 = identical direction). Coherence @5 = the share of a track's top-5 neighbors sharing its family — the retrieval-quality metric.                                                                                                                                                                                                          |
| CI / McNemar / Jaccard      | Statistics used in the genre audit v3. CI = 95% bootstrap confidence interval (resampling error bars). McNemar's = paired significance test for two methods on the same tracks (p < 0.05 = conclusive). Jaccard = set overlap,                                                                                                                                                                  | A∩B | /   | A∪B | (0.486 between kNN and head top-5 families = complementary signals). |
| Duration guard              | The eval filter keeping tracks 90–480 s: drops DJ mixes, edits and shorts so metrics aren't skewed. Neutral on the headline metric (−0.2 pt); kept for hygiene.                                                                                                                                                                                                                                 |

**Embeddings & models:**

| Term                    | Meaning                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tower                   | One embedding model ("audio tower"). Vectors = the fixed-length float arrays each tower produces (effnet: 1280-d).                                                                                                                                                     |
| effnet / discogs-effnet | **The incumbent and measured winner**: Essentia's `discogs-effnet-bsdynamic`, 1280-d, trained on 2M Discogs releases. Best on both genre agreement (LOO 0.444) and retrieval coherence (0.362); 0.56 s/track.                                                          |
| musicnn / MSD           | `msd-musicnn`, 200-d, trained on the Million Song Dataset tags. v1's claimed winner — exposed as a broken-harness artifact; measured 0.300 in v2.                                                                                                                      |
| MERT                    | Music Entropy Representation Transformer (v1-95M): a 360 MB transformer tower. Measured 0.256–0.267 across three pooling schemes at 7× cost — representation failure, stays out.                                                                                       |
| ONNX                    | Open Neural Network Exchange — the portable model format all towers run in locally (`onnxruntime`, CPU-only, no cloud).                                                                                                                                                |
| Discogs-400 head        | A 2 MB Essentia classification head that predicts all 400 Discogs styles directly from our cached effnet embeddings (~1 ms/track). Not as good as kNN as an oracle (46.1% vs 62.7%), but free ranked sub-genre data for every track — the ranked-secondaries backbone. |
| VGGish / CLAP / OpenL3  | The other measured towers. VGGish (128-d, AudioSet) — kept only for valence/arousal heads. CLAP (512-d) — a text-alignment model, worst at clustering music. OpenL3 (512-d) — mid, 8× cost.                                                                            |
| LUF / LUFS / LRA        | Loudness Units Full Scale — the EBU R128 perceived-loudness measure (`ffmpeg ebur128`); LRA = loudness range. Planned optional pass (~50 min one-time) enabling a loudness-continuity penalty between transitions.                                                     |

**Pipeline & infrastructure:**

| Term                                   | Meaning                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| megadj / FullTags / GetDat / CrateDeck | The four products. **GetDat** ingests (YouTube Music, drops, scored intake). **FullTags** enriches (beats/mood/cues/key/embeddings/genre ledgers + writers). **MegaSet** proposes sets. **CrateDeck** stages and verifies drives (deckctl, web UI, MCP). |
| archive.db / master.db                 | The two databases. `archive.db` = megadj's local pipeline ledger (analysis results, caches) — never a collection copy. `master.db` = the SHELF1 rekordbox collection DB (the SSOT for the collection); always gate writes on rekordbox being closed.     |
| RB / rekordbox mirror                  | "RB" = rekordbox. The mirror = read-only rows extracted from the shelf master DB (BPM×100, KeyName) used when the beats/key ledgers lack a track.                                                                                                        |
| MCP                                    | Model Context Protocol — how agents (Claude etc.) call tools like `megaset_propose`.                                                                                                                                                                   |
| CLI / HTTP / web surfaces              | The three other ways to drive MegaSet: `megadj megaset`, `GET /api/archive/megaset` (+`?format=m3u8`), and the FullTags web panel. Parity is test-pinned in `docs/surface-parity.md`.                                                                    |
| M3U8                                   | The UTF-8 playlist file format of the export path — a list (Phase D plans typed transition windows in comments) imported into rekordbox by hand; never auto-writes anything.                                                                             |
| rb-playlist                            | The only writer: `megadj rb-playlist` links a proposal to existing master-DB content rows. Dry-run first; `--apply --yes` requires rekordbox quit + dated backups + whole-table verify.                                                                  |
| Ledger / freshness                     | Ledger = a per-track results table in archive.db (beats, mood, cues, embeddings, track_keys). Freshness = the age of those ledger rows, surfaced in every payload so stale pools are visible.                                                            |
| NFC / casefold                         | Unicode normalization (NFC) + case folding — the matching rule that collapses duplicate files and duplicate genre spellings.                                                                                                                             |
| SSOT                                   | Single Source of Truth — one table/module owns a shared surface (presets, Camelot wheel, pool caps); everything else derives. The house answer to drift bugs.                                                                                            |
| Propose-only                           | The product invariant: MegaSet never writes. Proposals are payloads on screen; humans (or the gated rb-playlist) act on them.                                                                                                                            |
