# MegaSet / FullTags — Consolidated Findings, Learnings & Next Actions

**Status:** ✅ CURRENT — the single entry point for everything measured across
the MegaSet doc set (2026-09-13/14). Deep dives live in the linked docs; this
page holds the distilled verdicts, the critical-bug list, and the prioritized
next steps.

---

## 1. What we now know (every finding, one line each)

### Set-builder engine ([04-sequencing-benchmarks](04-sequencing-benchmarks.md))

| #   | Finding                                      | Number                                                 |
| --- | -------------------------------------------- | ------------------------------------------------------ |
| E1  | Greedy sequencing collapses in sparse pools  | −56 to −59% chain score vs beam                        |
| E2  | Engine speed is a non-issue                  | 29 ms @ 3.6k tracks, 157 ms @ 20k                      |
| E3  | 2-opt repair is worthless at scale           | +0.0% on real pools (only fragile chains)              |
| E4  | The compatibility graph is sparse            | 12.3% of pairs pass both gates                         |
| E5  | Exact solvers are infeasible                 | Held-Karp OOM at n=30                                  |
| E6  | Score weights barely matter                  | 5 weight variants moved mean <0.006 → frozen constants |
| E7  | **Beam search under ~250 tracks is the win** | +59% chain length at 0 ms cost (B=8)                   |
| E8  | Arc adherence holds across presets           | warmup/peak/afterhours envelopes track                 |

### Genre ([05-genre-audit](05-genre-audit.md) v3, [07-taxonomy](07-genre-taxonomy-sources.md))

| #   | Finding                                                   | Number                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| G1  | Labels are a formatting mess, not a truth problem         | 459 raw → 440 casefolded; 88% duplicates; 105 labels cover 90%                 |
| G2  | Family-level audio structure is real                      | LOO k=5: **57.6%** ungated, **62.7%** gated, CI-stable                         |
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

### Taxonomy sources ([07](07-genre-taxonomy-sources.md))

| #   | Finding                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Beatport** is the DJ-genre standard (live 2-tier, ~36 mains); **Discogs** the style standard (400 fixed styles); **Every Noise** frozen Feb 2024 (lookup only); SC = provenance |
| T2  | Essentia ships a `genre_discogs400` head that runs on our cached embeddings — free ranked styles                                                                                  |
| T3  | Head as oracle: top-1 46.1% — kNN beats it conclusively (McNemar p=2×10⁻³⁰)                                                                                                       |
| T4  | Head as signal: top-3/top-5 ≈ 69/77% family recovery; Jaccard vs kNN 0.486 = complementary → ranked-secondaries backbone                                                          |
| T5  | Deterministic LLM residue-pass design: ~459 labels, temp 0, vocabulary-constrained, validated before write — last resort after refold + head                                      |

### Embedding towers ([06-embedding-models](06-embedding-models.md))

| #   | Finding                                                         | Number                                                                               |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M1  | **effnet-discogs-1280 is the measured best single tower**       | LOO 0.444, coherence 0.362, 0.56 s/track (0.8 h per 5k)                              |
| M2  | v1's "musicnn wins" was a broken-harness artifact               | inverted: musicnn 0.300 vs effnet 0.444 at n=180                                     |
| M3  | MERT-v1-95M fails on this library — representation, not pooling | 0.256–0.267 across 3 pooling schemes, at 7× cost                                     |
| M4  | Ensembles buy almost nothing                                    | best +1.1 pt (mean-cos effnet+musicnn+mert) at 2–6× cost                             |
| M5  | Rank-fusion is a silent trap                                    | descending-rank fusion selects _least_-similar neighbors                             |
| M6  | CLAP is worst-in-class for music kNN                            | 0.244 — text-alignment towers don't cluster music                                    |
| M7  | 5k-library projections (single pass)                            | effnet 0.8 h · musicnn 1.0 h · vggish 1.0 h · openl3 4.1 h · MERT 5.4 h · clap 0.7 h |

### Sequencing-adjacent (08/09 plans)

| #   | Finding                                                                     |
| --- | --------------------------------------------------------------------------- |
| P1  | Full surface parity (CLI/MCP/web) + freshness payloads shipped for setbuild |
| P2  | `rb-playlist` writes twinned rows through one seam, dry-run default         |
| P3  | `setbuild → megaset` identifier migration fully planned (09), not started   |

## 2. Critical bugs to fix (all known, none blocking today)

| #   | Bug                                                                                                | Impact                                                     | Where                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| B1  | **`dance`→edm is a least-wrong mapping** — head says the 113 tracks are house 65/trance 17/bass 14 | soft: diversity guard slightly miscategorizes those tracks | refold should split via kNN dispute-flag pass               |
| B2  | **`melodic house & techno` → house** (regex order)                                                 | soft: melodic-techno tracks vote house                     | family-map ordering; needs head-verified rule before change |
| B3  | **Concurrent rb-dedup WIP failing 9/18 tests** (14:08 timestamps, uncommitted)                     | blocks pre-push gates until it settles                     | theirs — do not touch; wait                                 |
| B4  | 206 unlabeled tracks (203 embedded)                                                                | coverage 94.4→99.9% available                              | `genre --apply` inference exists                            |
| B5  | 389 slash-soup multi-genre rows unrefolded                                                         | Tier-1 display noise                                       | refold pipeline step 1                                      |
| B6  | `genre --eval` harness not yet a command                                                           | hygiene regression gate missing                            | §5b.3 step 4 (S)                                            |
| B7  | `hardtekk` family vote n=9 — fragile regex from tiny sample                                        | soft: misvotes possible                                    | revisit post-refold with bigger pop                         |

## 3. Next 3–5 things (ordered, with why)

1. **Run the genre refold for real** (`megadj genre --refold`, §5b.3 steps 1–2). _Why:_ everything downstream — B6 diversity guard, family-based pools, ranked secondaries, the disputed-flag pass, the eval harness — consumes its output, and it is S-sized with a measured target (105 labels → 90%).
2. **Ship `genre --eval` + `--apply` as standing commands** (§5b.3 steps 3–4, B4/B6). _Why:_ the eval harness is the regression gate that makes step 1's effect measurable (target: gated ≥65%), and `--apply` converts the 203 embedded-but-unlabeled tracks into coverage honestly.
3. **Ranked secondaries via the Discogs-400 head** (§5b.2 + 07 §2, T4). _Why:_ minutes of compute on cached embeddings buys per-track ranked styles for MegaSet's "deep end of the family" pools and the B6 family-union fix — the single biggest quality-per-hour item left.
4. **Beam-search-under-250 in the set builder** (04, E7). _Why:_ +59% chain length at zero cost, already benchmarked; the highest-leverage engine change that doesn't touch data.
5. **Execute the `setbuild → megaset` migration** (09). _Why:_ pure rename, fully planned, do it once the worktree is quiet so docs, code, and skill stop living under two names.

**Not next** (deliberately): LLM residue pass (only after 1–3 shrink the unmapped set), second embedding ledger (M4 says no), any tower switch (gate closed), crowd-sourced co-occurrence, solver engines, cloud anything.

## 4. Doc map (what lives where)

| Doc                                                       | Role                                                      | State     |
| --------------------------------------------------------- | --------------------------------------------------------- | --------- |
| [01-prd](01-prd.md)                                       | Product brief, kill criteria, F1–F7                       | current   |
| [02-architecture](02-architecture.md)                     | Engine shape, variable inventory (20 set + 24 song vars)  | current   |
| [03-competitive-analysis](03-competitive-analysis.md)     | 30 comparators + re-ranked roadmap (plan of record)       | current   |
| [04-sequencing-benchmarks](04-sequencing-benchmarks.md)   | E1–E8 measured engine claims                              | current   |
| [05-genre-audit](05-genre-audit.md)                       | Genre policy + v3 statistical revalidation                | current   |
| [06-embedding-models](06-embedding-models.md)             | Tower benchmark, fusion sweep, MERT verdict               | current   |
| [07-genre-taxonomy-sources](07-genre-taxonomy-sources.md) | Beatport/Discogs/EN anchors, Discogs-400 head, LLM design | current   |
| [08-audit-and-plan](08-audit-and-plan.md)                 | Implementation audit + per-item sketches (reference)      | reference |
| [09-migration-plan](09-migration-plan.md)                 | `setbuild → megaset` atomic rename plan                   | planned   |
| [10-findings](10-findings.md)                             | **this page** — distilled verdicts + next actions         | current   |
