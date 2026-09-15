# FullTags — Genre Audit & Inclusion Policy (MegaSet §genre consumer)

**Status:** 📚 REFERENCE — current genre inclusion and source-precedence policy.
**Sep 15 pipeline walkthrough:** [genre-pipeline.md](genre-pipeline.md) —
how a track's genre actually flows (write points → hygiene → inference →
scoring → gate), with invariants and live state.

v3 · 2026-09-14 · **Audit** → [PRD](../megaset/01-prd.md) · [Benchmarks](../megaset/04-sequencing-benchmarks.md) · [Analysis](../megaset/03-competitive-analysis.md) · [Taxonomy sources & family map](genre-taxonomy-sources.md)

> Glossary (LOO, CI, McNemar, Jaccard, kNN, duration guard):
> [10-findings §5](../megaset/10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

> v2: baselines refreshed post-`rb-comment-sync`; LOO corrected to
> full-population methodology; §5c source ranking. v3: **statistical
> re-validation** — duration guards (90–480 s), full-population exact LOO,
> bootstrap 95% CIs, McNemar tests, 6-cluster sub-genre survival (replaces
> deep-house-only), §2-vs-5b discrepancy reconciled, §5c precedence
> corrected to follow the measurement, junk-label criterion stated.
> §5b.3 eval target updated to gated ≥65%.

Questions this doc answers, with live data (`archive.db`, 3,458 genre-labeled
of 3,664 downloaded rows, 2026-09-14):

1. Can we trust our genre mapping? (No — measured.)
2. Sub-genres: keep, alias, or rank? (Two-tier: labels for humans, families
   for math, embeddings for fine similarity.)
3. How does genre enter MegaSet? (Family-level diversity guard only.)
4. `deep house` vs `house` — which is "better"? (Neither is audio-real;
   measured below.)
5. Six candidate sources — which wins? (§5c: audio consensus > curated pool
   > RB > SC free-text; file tags never — measured round-trip pollution.)
   > v3.1: the table now lists ALL live sources (adds MusicBrainz/enrich
   > and getdat-sync's YouTube fallback — both missing from v3).

---

## 1. The measured mess

> Snapshot from the pre-refold audit (2026-09-14) — kept because the
> §2/§5b baselines were computed on this state. The Sep 15 refold
> collapsed the case/spacing twins (241 distinct labels remain, zero
> case-duplicates); the _proportions_ below (dup mass, singleton tail,
> junk labels) are the honest picture of how the mess was built.

| Measure                                              | Value                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distinct raw genres (case-sensitive)                 | 459 pre-refold → **241 post-refold (Sep 15)**                                                                                                         |
| Rows that are case/spacing duplicates of another row | **3,339 of 3,798 (88%)** — eliminated by the refold (idempotent re-runs propose 0 changes)                                                            |
| Example variants                                     | `Afro House`×22 / `Afro house`×3 / `AFRO HOUSE`×1 · `House`×483 / `house`×355 · `Hip-Hop`×116 / `hiphop`×7                                            |
| After casefold+trim                                  | 440 distinct pre-refold                                                                                                                               |
| Singleton genres (1 track each)                      | **304** — 69% of the vocabulary describes 8% of the library                                                                                           |
| Top-10 coverage                                      | `house` 838, `edm` 353, `techno` 322, `tech house` 207, `music` 154, `pop` 139, `progressive house` 128, `electronic` 128, `hip-hop` 116, `dance` 113 |
| Junk labels present                                  | `music` (154), `edits / bootlegs` (26), `dance & edm`, `dance / electro pop`, `edm bass`                                                              |

Sources are the usual suspects — now fully inventoried in
[genre-pipeline §2](genre-pipeline.md#2-where-genre-comes-from--every-write-path-the-full-inventory):
SoundCloud free-text (artist-chosen, wildly
inconsistent), plus tags from pool rips. The 88% duplicate rate means the
first cleanup is mechanical, not intellectual — and it was: the refold
did exactly that, mechanically, in one pass.

## 2. Do embeddings agree with genres? (the trust test — v3 corrected)

v3 re-measurement (full population, duration-guarded n=2,982, current
93.4%-coverage family map; replaces the old 150-query sample whose 39%
figure is explained in §5b.1):

| Level                                      | 5-NN keeps it                                          |
| ------------------------------------------ | ------------------------------------------------------ |
| Specific sub-genre label (`deep house`, …) | **3–27% survival across six clusters** (see below)     |
| Family level                               | **57.6%** LOO ungated · 62.7% gated (95% CIs in §5b.1) |

Sub-genre label survival by cluster (does a track's 5 nearest
audio-neighbors share its SPECIFIC label?):

| Cluster             | Survival     |
| ------------------- | ------------ |
| `deep house`        | 3% (3/102)   |
| `melodic techno`    | 0/10         |
| `afro house`        | 12% (4/32)   |
| `tech house`        | 18% (41/227) |
| `progressive house` | 27% (30/112) |
| `hardtekk`          | 44% (4/9)    |

Reading: **audio almost never encodes our specific sub-genre labels — and
this is now measured across six clusters, not one.** Niche scene labels
(`hardtekk`) survive best (small coherent scenes); big-tent labels
(`deep house`) survive least. Family mapping recovers real structure
(~58% ≫ 3–27%). Labels still carry _scene_ information audio can't know —
both are true; they answer different questions.

**Verdict (corrected wording): specific labels get a 3–27% survival band —
mostly folklore, occasionally real. Families are weak-but-real; embeddings
are the fine-grained similarity source.**

## 3. The policy: two-tier genre

### Tier 1 — canonical label (display + browsing)

- One-time `megadj genre --refold` pass (SHIPPED, §5b.3.1): casefold+trim →
  alias-map (inside `src/fulltags/genre-refold.ts` — the
  `shared/genre-aliases.ts` file once planned here was folded into the
  refold engine; one SSOT) → canonical. `Hip-Hop`/`hiphop`/`HipHop` →
  `hip-hop`; `House`/`house` → `house`. Mechanical wins first: applied
  live 2026-09-15 — zero case-twins remain in the column.
- **Aliases, not deletion.** The raw string stays in provenance
  (`tracks.genre_raw` conceptually; we keep the source string in the
  fetch ledger/history) so nothing is lost — the canonical column is what
  every consumer reads.
- **Ranked specificity is GOOD for display** (`deep house` tells a human
  more than `house`), as long as nothing downstream treats "deep house"
  and "house" as unrelated bins. Hierarchy: `label ⊂ family`.

### Tier 2 — family (scoring)

- `genreFamily()` (existing SSOT, 9 families: bass/house/techno/trance/
  hiphop/edm/pop/groove/mood) is the ONLY genre signal MegaSet
  consumes. It already handles `deep house → house` via the regex chain,
  including the ordering traps (bass before house, melodic → techno).
- **Do we filter `deep house` out of a `house` pool? No.** Pool filters
  run at family level; sub-genre selection within a family is the
  embeddings' job (cosine kNN gives you "the deep end of the house pool"
  without trusting labels). Exception: explicit label filters in the UI
  are allowed because they're a human's explicit choice, not a scoring
  assumption.

### New sub-genres

Ignore-as-blockers, capture-as-data: an unseen label maps to `other` →
its tracks still score via audio (BPM/key/mood/embeddings). The alias
table grows when a new label appears ≥5 times with a clear mapping —
the refold's dry-run proposal census lists unmapped labels by frequency
(`megadj genre --refold` dry + `--json`), so extending the table is a
5-minute data-driven task, not a
guess. No LLM mapping, no cloud genre APIs (the one-shot residue pass
in §6 of [genre-taxonomy-sources](genre-taxonomy-sources.md) is the
single, constrained exception — queued, #65).

### Is generic-better or specific-better?

Both, at different tiers: **generic (family) is better for scoring**
(only level with audio support), **specific is better for browsing**
(human meaning). The one thing we must NOT do is score specificity —
the 7% purity number says sub-genre distance is fiction.

## 4. Inclusion in MegaSet (this product)

| Use                                                 | Signal                 | Where                   |
| --------------------------------------------------- | ---------------------- | ----------------------- |
| Diversity guard (B6): penalize same-family runs >3  | Tier 2 family          | Phase B                 |
| Pool presets ("warmup pool: house family, 124–128") | Tier 2 family          | S19                     |
| Fine "sounds like" within a family                  | embeddings kNN         | T10 (≤0.1 weight)       |
| Display (track rows, crate hover)                   | Tier 1 canonical label | UI only                 |
| Never: transition scoring between specific genres   | —                      | audio already covers it |

Genre NEVER gates (a missing/unknown genre never excludes a track — same
rule as the missing-BPM philosophy, just softer: genre has no gate role at
all, only soft penalties and filters).

## 5. The refold plan (FullTags work, ahead of B6) — ✅ SHIPPED Sep 15

> Steps 1–3 shipped and applied live 2026-09-15 (details + measured
> results in §5b.3.1/§5b.3.2); kept for the record. Step 4 remains the
> long-horizon item.

1. ~~`megadj genre --refold` (S, one session): casefold+trim → alias table
   (`shared/genre-aliases.ts`, tested SSOT) → write canonical back;
   `--report` lists unmapped labels by count. Expected: 459→~120.~~
   SHIPPED — alias logic folded into `src/fulltags/genre-refold.ts`; the
   dry-run census is `megadj genre --refold --json`; case-twins: 0.
2. ~~Family coverage check~~ DONE: 93.4% (target >90%; `music`/
   `edits / bootlegs` intentionally unmapped).
3. ~~Diversity guard consumes `genreFamily()`~~ DONE — B6 unblocked.
4. Optional later: embedding-neighborhood seeding — cluster the embedding
   space and see which clusters have coherent _unlabeled_ identity;
   propose new canonical labels from data, not from tag folklore. (= #62,
   the only fix aimed at the remaining house↔techno error mass.)

## 5b. Deep plan — multi-genre storage, inference evaluation & the FullTags-owned fix (Sep 14, measured)

The question "can't FullTags just fix all this?" — mostly **yes**, because
every fix lands in data FullTags already owns. What follows is the deeper
plan plus the benchmark numbers that size each step.

### 5b.0 Do we need to re-run FullTags first? (measured answer: no)

The worry: "most of the genre stuff is junk, we only ran FullTags on ~500
recent imports — re-run everything, then re-embed, then clean up?" The
ledgers say otherwise: `mood` 3,659/3,664, `beats` 3,610, `cues` 3,605,
`embeddings` 3,618 — analysis is **library-wide** (3,531 rows analyzed on
Sep 12 alone), not a 500-track batch. Genre labels are a _metadata_
problem, not an _analysis_ problem: 94.4% coverage with a 30-row spot
check finding zero placeholder labels. The refold pipeline (§5b.3)
relabels from data we already have; **no FullTags re-run and no
re-embedding is queued** — embeddings are tower-fixed (effnet stays) and
re-embedding would change nothing about label quality. The post-refold
`--eval` rerun is the checkpoint that would catch any surprise.

### 5b.1 Measured baselines (v3, Sep 14: duration-guarded, full-population, with statistics)

> **v3 methodology (supersedes the v2 table):** every number is computed on
> the **duration-guarded population** (90–480 s: drops DJ mixes, edits,
> shorts — 3,664 → 3,163 downloaded; 2,982 family-evaluable embedded) at
> **k=5 full-population leave-one-out** (exact, no query sampling), with
> **bootstrap 95% CIs** (2,000 resamples, track-blocked) and **McNemar's
> test** where two methods are paired. The §2-vs-5b headline discrepancy is
> reconciled below — sampling noise plus the old 88%-coverage family map,
> not a second scoping bug.

| Measure (guarded, n=2,982)                                        | Value                                                                                                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOO k=5 family agreement, ungated**                             | **57.6%** · 95% CI [55.8, 59.5]                                                                                                                                                                     |
| **LOO k=5 gated ≥0.6**                                            | **62.7%** · CI [60.7, 64.6] · refuses 19.8%                                                                                                                                                         |
| Old §2 methodology re-run (150-query sampled majority, 30 rounds) | 55.9% ±3.5 — consistent with full LOO once sampling is accounted for                                                                                                                                |
| Same at 750 queries                                               | 58.1% ±1.6                                                                                                                                                                                          |
| **Duration-guard effect (same map, guarded vs unguarded)**        | **−0.2 pt — neutral.** Guard kept for analysis hygiene (mixes/edits poison TagData), not for this metric                                                                                            |
| **Discogs-400 head family agreement (top-1)**                     | 46.1% · CI [44.3, 47.9]                                                                                                                                                                             |
| kNN vs head (paired, same population)                             | +11.6 pts for kNN · **McNemar p=2×10⁻³⁰ — conclusive**                                                                                                                                              |
| **Jaccard(kNN-top5-families, head-top5-families)**                | 0.486 — ~half-overlapping family sets; genuinely complementary signals                                                                                                                              |
| Genre coverage (downloaded)                                       | **3,458/3,664 = 94.4%**; 30-row spot check: 0 suspicious labels (real labels, not placeholders)                                                                                                     |
| Coverage by source                                                | `ingest` 526/531 · `rekordbox` 2,932/3,133 · 206 unlabeled (203 embedded). Live recount Sep 15 (post-refold): 360 rows now `Music`/empty — 206 never-labeled + 154 `Music` placeholders (issue #61) |
| Labels covering 90% of rows                                       | **105** — the alias table has a hard, small target                                                                                                                                                  |
| Distinct raw labels / casefolded                                  | 459 / 440 → **241 after the Sep 15 refold** (idempotent; twins gone)                                                                                                                                |
| Multi-genre strings already in the wild                           | **389 rows** — the data is ALREADY multi-genre, stored as slash-soup (refold now splits these)                                                                                                      |
| Numeric SC genre IDs in DB                                        | **0** — the write-point guard holds                                                                                                                                                                 |

Readings (what changed vs v2, and why the two headline numbers now
reconcile):

1. **§2's "39% @150 queries" vs §5b's "61–66%" is explained, not a bug.**
   Re-running the exact old methodology (150 sampled queries, plain 5-NN
   majority) 30× gives 55.9% ±3.5 — statistically consistent with the
   full-population 57.6%. The old 39% was depressed by small-sample noise
   plus a family map that left 12% of labels unmapped (coverage is now
   93.4%). §2 below is corrected to the same population and map.
2. **Sub-genre label survival generalizes — `deep house` was not an
   outlier.** The §2 claim rested on one sub-genre (0/60). Re-tested on
   six clusters: deep house **3%** (3/102), afro house **12%** (4/32),
   melodic techno **0/10**, tech house **18%** (41/227), progressive house
   **27%** (30/112), hardtekk **44%** (4/9). Specific labels survive a
   5-NN audio neighborhood 3–27% of the time across the board (niche
   scene labels survive best). **The two-tier policy stands on broader
   evidence; the "never will" language is corrected to a measured 3–27%
   survival band.**
3. **kNN beats the Discogs-400 head conclusively** (McNemar p=2×10⁻³⁰) —
   kNN stays the inference oracle; the head stays the ranked-secondary
   source (Jaccard 0.49 family overlap = complementary, not redundant).
4. **No source is truth, now measured with CIs:** per-source LOO (guarded,
   full population) — `rekordbox` **58.4%** CI [56.4, 60.2] (n=2,568) vs
   `ingest` **53.1%** CI [48.6, 58.0] (n=414); difference +5.2 pts,
   z=2.00, **p=0.046 — conclusive at 0.05**. §5c's precedence table is
   corrected to follow the measurement (RB above ingest among label
   sources) with the curation caveat stated explicitly.
5. **k=5 and the 0.6 gate stay:** gated 62.7% vs ungated 57.6% (+5.1 pts
   for 19.8% refusal). Eval target: **gated ≥65% post-refold** (baseline
   62.7%). The 19.8% refusals are the split neighborhoods (melodic techno
   ↔ progressive house) — refused, not guessed.

### 5b.2 Multi-genre: yes — as ranked secondary values in our DB, single-value in tags

- **Files stay single-genre (TCON).** Tag-space multi-genre breaks Pioneer
  browsers, rekordbox filters, and our equality checks; the comment format
  (`Key · Energy · Mood`) is already the structured side-channel.
- **`archive.db` gains a ranked list**: a `track_genres` side table or
  `tracks.genres` JSON (`[{label, conf, src, as_of}, …]`). Ranked =
  primary first; the canonical primary drives folders/filters, secondaries
  stay queryable ("tech-house-adjacent house"). This kills the slash-soup
  properly: `Electronic/House` becomes primary `electronic` + secondary
  `house` instead of an unmatchable string.
- **Family sets derive from the ranked list** (an afro-house track
  genuinely belongs to `house` AND `groove`) — the B6 diversity guard
  counts a family-run hit if ANY of a track's families continues the run;
  softer and fairer than primary-only.

### 5b.3 The FullTags-owned pipeline (what "FullTags fixes it" concretely means)

All stages write to ledgers/DB FullTags owns; `--apply` gates and the
ground-truth philosophy unchanged.

0. **Tier-0 diagnostics (run before/refold-adjacent; they decide what
   the later steps are worth).** From the
   [external research review](embedding-research-2026-09-14.md) §4/§5:
   (a) **label-error clustering by artist/release/imprint** — if errors are
   systematic the 0.58 ceiling story is wrong and relabelling buys ~nothing;
   (b) **artist-overlap rate in top-5 neighbours** (Sturm's "horse" check —
   effnet is the tower most likely to win LOO by artist fingerprinting; >15%
   overlap ⇒ add `--artist-disjoint` reruns); (c) **hubness histogram**
   (k-occurrence distribution — a few tracks at 40+ occurrences means
   whitening + CSLS is nearly-free retrieval points); (d) **confusion matrix
   - top-2 accuracy** in `genre --eval` (is the error mass the house/techno/
     trance triangle — arguably not errors — or structural?).
     **✅ IMPLEMENTED + RUN LIVE (Sep 15): one command —
     `megadj genre --eval --diagnostics --artist-disjoint --probe --json`.
     Measured verdicts (n = 2982): label noise RANDOM (top-10 artists hold
     8.4% of disagreements), NO artist leakage (4.2% same-artist top-5;
     disjoint Δ −0.8), hub tail CONFIRMED (408/2643 tracks in ≥10 lists),
     triangle share 17.7% with `edm↔house` the single biggest error block
     (confirms the umbrella arbitration below), probe 5-fold 51.5% (Δ −11.1
     vs kNN — kNN stays the production readout). Full readout + plan
     changes: [tier0-diagnostics-2026-09-15](tier0-diagnostics-2026-09-15.md).**
1. **Refold** (§5, now with the measured target: **105 labels cover 90%**;
   the alias table is small and finite). Split multi-label strings on
   `/ , &` into ranked secondaries (389 rows healed here). **Extended per
   the review + user call (Sep 14):** arbitrate the plain-`edm` umbrella
   block (B1's sibling — `edm` is a parent of house/techno/trance, so every
   plain-`edm` track is a forced LOO error) through the same head+kNN
   dispute pass, keeping genuinely-hard-EDM (hard-dance/eurodance/nightcore)
   and ALL sub-genre labels — **hardtekk and friends are explicitly kept**
   as Tier-1 display; only the _scoring_ family arbitration changes.
   **✅ IMPLEMENTED + APPLIED LIVE (Sep 15): `megadj genre --refold`
   (+ `--eval --refold` A/B), engine in `src/fulltags/genre-refold.ts`.
   Data half applied: 790 canonicalization writes (escape repair,
   multi-label split with specific-outranks-umbrella ranking, casing
   collapse — killed the `House/House/house` ×3 and `EDM/edm` ×3 twins)
   - 71 casing-carried umbrella rows (`edm`→`EDM`, `DANCE`→`Dance`;
     label VALUE preserved) + 43 umbrella split canonicalizations
     (`Dance/Electronic`→`Dance`, kills the case-twin pair). Scoring half
     (`scoringFamily`): plain EDM/Dance/Electronic/Mainstage EDM abstain
     from vote + population. **Live A/B (reproducible, post-write):
     baseline 61.7% → 69.2% with arbitration (+7.4 pts, n 2982→2424,
     refusal 20.7%→13.0%) — TARGET ≥65% PASS; the `--eval` gate now
     judges the refold arm when armed (exit 0).** Junk guards: URL
     spam, word soup (≥5 words), character sanity, and family-mapping
     requirement (`Edits / Bootlegs` proposes nothing — no fake labels).
     Proposal census post-apply: 3458/3458 canonical, 0 changeable,
     0 casing twins in the whole column — idempotent.**
2. **Demote-and-flag pass**: sources get trust weights from the measured
   table (RB 0.62, ingest 0.59, SC free-text lowest); rows whose label
   disagrees with a unanimous kNN consensus get `genre_flag='disputed'` —
   NOT rewritten (a human decision), but excluded from inference seeding
   so one bad label poisons fewer votes.
   **✅ IMPLEMENTED + APPLIED LIVE (Sep 15): `megadj genre --flag`
   (+`--apply`), engine in `src/fulltags/genre-flag.ts`
   (`classifyDisputes`), flag column `tracks.genre_flag` (migration),
   seeding exclusion in `state_tracks.genreSeeds()`. Unanimity is the
   evidence bar (gated prediction + agreement 1.0 + family mismatch);
   split votes and refusals touch nothing. Each run REASSESSES every
   embedded labeled row: disputes set the flag, rows no longer disputed
   clear it — idempotent and self-healing. Live census (Sep 15, k=5):
   96 disputed of 2982 assessed (3.2%) — top claimed-vs-consensus
   blocks: EDM→house ×14, Electronic→house ×11, Techno→house ×9,
   Pop→house/bass ×9, Dance→house ×9; 273 rows UPHELD by unanimous
   consensus (labels the audio confirms), 2613 no-quorum. Labels are
   never rewritten; the 96 stop seeding votes. Post-flag Tier-0 battery
   (§0 numbers re-measured): baseline 61.7% / arbitration 69.2%
   unchanged (the disputed 3.2% sat inside the refusal mass, not the
   error mass), label-noise verdict still RANDOM (top-10 artist share
   8.4%→8.6%), artist leakage still nil (4.2%, Δ −0.8), hub tail
   unchanged (408/2643), triangle share 17.7%→19.1%, top-2 77.4%,
   probe 51.2% (Δ −10.6), artist-disjoint 60.9% (Δ −0.8).**
3. **Inference for the unlabeled 206** (203 already embedded): existing
   `inferGenre` at k=5, minAgreement 0.6 — now benchmark-validated with
   CIs (57.6% ungated → 62.7% gated; the gate trades 19.8%
   refusal for +5.1 pts). `--apply` fills empty columns only;
   disputed/no-quorum stay honest gaps. At 94.4% coverage the remaining
   upside is small — this step is cheap but not load-bearing.
4. **Periodic `megadj genre --eval`** (SHIPPED 2026-09-14; extensions
   SHIPPED 2026-09-15): re-runs the
   leave-one-out harness over the live DB and prints agreement +
   vote-strength distribution — the regression test for label hygiene.
   If refold/inference makes things worse, the number says so. Target
   (v3, set on the duration-guarded baseline): **LOO gated ≥65% after
   refold** (baseline 62.7%). The shipped command
   reproduces the v3 baseline exactly on the live DB (n=2,982, gated
   62.6%, refusal 19.8%, ungated 56.3% — within rounding of the §5b.1
   table). `--no-duration-guard` drops the 90–480 s band for an
   ungated-population rerun; `--k`/`--min-agreement` retune the vote.
   ~~Queued additions: `--probe` (linear-probe readout
   vs the kNN vote — literature-standard; promotion gate = beat kNN by
   ≥3 pts on the guarded population), `--artist-disjoint` reruns,
   confusion-matrix + top-2 output~~ **ALL SHIPPED 2026-09-15** — one
   command: `megadj genre --eval --diagnostics --artist-disjoint --probe
--json`. Calibration note kept: **0.65–0.75
   is the realistic aspiration band** (best published EDM-subgenre result:
   60.6% @ 30 classes, 75K songs), with ≥65% remaining the ship gate.
   Current live readout: **69.2% arbitration — PASS**.
5. **Embedding-neighborhood labels (later, the deep fix)**: cluster the
   3,415 vectors; coherent clusters _propose_ canonical labels from their
   members' consensus, reviewed by a human — new sub-genres enter the
   taxonomy from audio reality, not tag folklore.
6. **Multi-source vote ladder (NEW, Sep 14 — user-directed).** The fetch
   ladder is currently `SC → Beatport → AI(opt-in)` with first-win-writes
   (plus MusicBrainz via `megadj enrich` as the offline gap-filler, and
   file tags via `megadj ingest` at intake — see the pipeline doc §2 for
   the full write-path inventory). Evolve to a **weighted vote** across
   the arms we already have — RB
   mirror, ingest pool (Bandcamp/Hypeddit-quality), SC, Beatport,
   Discogs-400 head, kNN consensus — with the measured trust weights (G6:
   RB > ingest) and the §5c disputed-pass semantics (disagreement flags,
   never clobbers). New arms: a **Bandcamp page-fetch arm** (yt-dlp's
   Bandcamp extractor is broken upstream since Aug 2026, but album pages
   expose publisher tags + label directly) and a **web-search research arm**
   (exa/brave) used ONLY as a harness to confirm imprint→scene mappings for
   the disputed residue (feeding the LLM pass) — never a runtime ladder
   dependency. Replaces "first source wins" with "sources vote, consensus
   writes, disputes flag".
7. **Transition-window embeddings (NEW, Sep 14 — the user's chunking
   instinct, and the cheapest basin jump).** DJs mix 32-bar sections, not
   tracks. The Essentia patch towers already emit per-~3 s patch embeddings
   before mean-pooling, and the cues ledger already stores 32-bar phrase
   boundaries — so **intro/outro-window similarity** (pool only the first/
   last-N-second patches; outro→intro "sounds like" index) is S–M with
   **zero new models** and no Demucs bill. See the research review §5 J4
   (its "days" estimate assumes new infrastructure; ours mostly exists).

### 5b.4 What NOT to build

- No `genre_raw` schema migration — the fetch ledger already preserves
  provenance; a second copy invites drift (house rule: one source of truth).
- No tag-space multi-genre (breaks hardware/interop, §5b.2).
- No third-party genre APIs / LLM classification — measured consensus beats
  both, locally and free.
- No auto-relabeling of disputed rows — flagged-but-untouched is the honest
  state; relabeling is a human decision.

### 5b.5 Effort & order

| Step                                         | Size   | Depends on                             |
| -------------------------------------------- | ------ | -------------------------------------- |
| Tier-0 diagnostics (0a–0d above)             | S      | — (run FIRST; they re-rank below)      |
| Refold + alias SSOT + multi-label split      | S      | diagnostics (edm arbitration rides it) |
| Ranked secondary storage (`track_genres`)    | S–M    | refold                                 |
| Disputed-flag pass + source trust weights    | S      | refold                                 |
| `--eval` harness as a reusable command       | S      | — (this doc's harness, productized)    |
| `--eval` probe / artist-disjoint / confusion | S      | — (extends the shipped command)        |
| Multi-source vote ladder + Bandcamp arm      | M      | disputed pass                          |
| Transition-window similarity (intro/outro)   | S–M    | — (patch embeddings + cues exist)      |
| Inference for unlabeled (k=5 pinned by eval) | exists | —                                      |
| Whitening + CSLS retrieval space             | S      | hubness histogram                      |
| Cluster-proposed labels                      | M      | everything above, later                |

**Tower note (Sep 14, superseded):** the 80-track harness numbers that
named musicnn the candidate were a broken-harness artifact. The repaired
harness (n=180, 0 fails, v2 rerun in
[embedding-models.md](embedding-models.md)) inverts it: effnet 0.444
vs musicnn 0.300, ensemble best +1.1 pt — no production switch. See the
full sweep (fusers × 6 towers, MERT variants) there.

### 5c. Which source wins? (v3 — corrected to follow the measurement)

> **v3 correction:** v2's table ranked `ingest` above `rekordbox` citing
> "curated releases carry real genre" while the measured column said the
> opposite — a plausibility argument overriding the stated ranking
> criterion. Fixed: the order now follows the numbers, and the curation
> argument is kept only as a stated caveat where it still applies
> (specificity of pool labels for display).

Measured audio-consistency (duration-guarded full population, ungated LOO,
95% CIs; §5b.1):

| Rank | Source                                           | Audio-consistency (measured)                                                                                                                                                                               | Role in the pipeline                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Embedding kNN consensus** (our own ONNX)       | the _reference_, not a claim                                                                                                                                                                               | Tie-breaker + inference + dispute flagging. Decides families; never invents sub-genre labels.                                                                                                                                           |
| 2    | **Rekordbox mirror** (RB/artist-entered)         | **58.4%** CI [56.4, 60.2] (n=2,568)                                                                                                                                                                        | Bulk coverage (2,932 rows). Primary display; always family-scored.                                                                                                                                                                      |
| 3    | **Ingest pool tags** (Bandcamp/Hypeddit-quality) | **53.1%** CI [48.6, 58.0] (n=414) — statistically below RB (z=2.00, p=0.046). Caveat kept: pool labels carry richer _specificity_ for display, which consistency does not measure                          | Secondarily primary for display specificity; never outranks RB for scoring. Adopted at intake only (W6).                                                                                                                                |
| 4    | **MusicBrainz folksonomy** (`megadj enrich`)     | not directly measurable (only fires on weak/missing genres; artist-tag harvest, community-curated)                                                                                                         | Gap-filler of record for pre-#61 rows; tag-write-first discipline. The honest answer for "will MB fix the `Music` rows?" is: mostly NO — MB has no/few tags for the obscure artists behind most placeholder rows (spot-checked Sep 15). |
| 5    | **Beatport store genre** (`megadj fetch` W3)     | not directly measurable in bulk (only fires when SC misses; store taxonomy, no junk)                                                                                                                       | Second vote in the fetch ladder, ranked ABOVE the AI fallback.                                                                                                                                                                          |
| 6    | **SoundCloud free-text** (artist-chosen)         | not directly measurable (numeric-ID guard blocks the worst); visible as the junk tail (`music`×154, `edits / bootlegs`)                                                                                    | Lowest trust. Never primary; feeds the alias table only when ≥5 occurrences map cleanly.                                                                                                                                                |
| 7    | **YouTube category / title regex** (getdat sync) | worst by construction (category ≠ genre) — this is the `Music`×154 birthplace (W1, #61)                                                                                                                    | Bootstraps the DB row at download; every other path exists to upgrade or correct it.                                                                                                                                                    |
| 8    | **File TCON tags**                               | **never a source** post-intake — round-trip pollution measured: numeric SC IDs _baked into files_, Beatport tag-soup sentences, slash-soup with newlines. DB↔file exact agreement only 81% (55-tag sample) | Output-only. `rb-comment-sync` writes it; readers treat file TCON as a cache of the DB, never upstream.                                                                                                                                 |
| 9    | **Cluster-proposed labels** (future, §5b.3.5)    | n/a — derived from #1                                                                                                                                                                                      | New canonical labels enter from audio reality; human-reviewed.                                                                                                                                                                          |

**Are these sources any good? (label legitimacy spot-check, Sep 15 —
exa web search against the unmapped tail.)** The claim "we can't map
these" was tested against the ~47 unmapped labels. Verdicts:
**real genres the family map already scores** — speed garage→house,
bassline→bass, UK garage→house, organic house→house, melodic house &
techno→house, future house→house, hardtekk→techno (Wikipedia/Beatport
all confirm these are established, not folklore). **Real genres NOT
scored today (family-map gaps, not junk)** — phonk (Memphis-rap-derived,
Wikipedia), EBM, new wave, D&B (1-row abbreviation — the map has
`drum.?n.?bass` but not bare `d&b`), merengue, bolero, canzone
napoletana (non-electronic, arguably mood-tier). **Confirmed junk, stay
null** — `Music`, `Other`, artist names (`Tuxedo`, `Nvoy`,
`Spencerparker` — verified recording artists, not genres), status words
(`Premiere`, `VIP Mix`, `Hits`), platform artifacts (`Loop Samples` —
ironically mapped to edm by an over-broad regex, a map bug to fix),
URLs/JSON blobs. Net: the unmapped tail is ~⅔ real-but-unmapped, ~⅓
correctly-refused junk — the family map still has real wins on the
table (queued with #65), and the junk refusals are working as designed.

**Junk-label criterion (was implicit, now stated):** a label is junk (not
mapped, excluded from the 105-label target) iff it is (a) a non-genre
string — URL/JSON/escape artifact/artist name/status word (`premiere`,
`vip mix`, `tutorial`) — or (b) a structural placeholder (`music`,
`unknown`, `other`), or (c) deliberately unmapped (`edits / bootlegs`,
`loop samples` — DJ-tool categories, not genres). Low frequency alone
never disqualifies: singletons with clear genre meaning get aliases.

**How precedence executes** (the disputed-flag pass, §5b.3.2 — SHIPPED
Sep 15 as `megadj genre --flag`; the k=5/0.6 production vote, unanimity
bar: gated prediction + agreement 1.0 + family mismatch):

1. Family from primary label (`genreFamily()` SSOT).
2. Family from kNN consensus (k=7, ≥0.6 gate).
3. **Agree** → label stands, `conf` = vote strength.
4. **Disagree** → keep label for display, flag `disputed`, exclude from
   seeding; ranked secondaries gain the consensus family.
5. **No quorum** → honest gap, never a guess.

**Sanitization timing** ("when do we sanitize to align with our groups?"):
at the **refold boundary only** — one mechanical pass (casefold+trim →
multi-label split → alias map), one write. Never sanitize at read time
(every consumer paying the cost, drift between readers) and never
sanitize at write time per-source (sources disagree; the disputed pass,
not the sanitizer, is where disagreement gets handled). After refold,
every consumer reads canonical labels + ranked secondaries and no source
ever raw-dogs the scoring path again.

**Specificity at intake**: keep whatever specificity the source gave
(`deep house` stays `deep house`, display-tier), map to family for math.
Do NOT broaden at intake (`deep house → house` at the write point) — that
destroys the display signal (measured 3–27% survival band, §2) that humans
still want, and refold can always broaden later; it can't recover what
intake threw away.

### 5b.4 What the Sep 15 hygiene work taught us (learnings)

The refold → flag → Tier-0 re-run cycle, executed in one day, produced
measured lessons that shape everything queued next:

1. **The biggest "error" was a policy bug, not a data bug.** The
   confusion matrix's largest block (`edm→house` 250 + `house→edm` 78)
   was never a mislabelling problem — it was plain-`edm` umbrella rows
   being forced to score against sub-genre families. Arbitrating the
   umbrella (abstain, don't reclassify) bought +7.4 LOO points in one
   pass — more than any relabelling could have. _Lesson: re-score the
   task before relabelling the data._
2. **Unanimity is the right evidence bar for disputes.** Requiring
   agreement 1.0 (not just a gated majority) kept the flag count at a
   reviewable 96/2982 (3.2%) — the near-miss majority votes (0.8–0.99)
   flagged ZERO extra rows in testing but would have inflated the
   census with sub-genre ambiguity, which is not a label error.
3. **Flagging beats rewriting for medium-trust labels.** Rewriting the
   96 disputed labels would have destroyed the evidence of WHY they
   were flagged and closed the human-review door. Flagged rows now
   stop seeding votes (the actual harm), and the pass self-heals: fix
   a label, re-run, the flag clears.
4. **Label hygiene moved nothing on its own — and that's a verdict.**
   Post-refold+flag, baseline agreement held at 61.7%, label-noise
   stayed RANDOM (top-10 artist share 8.6%), hubness was byte-identical
   (vector geometry, not labels). The hygiene passes cleaned the
   data's _provenance and future_ (canonical labels, clean seeding),
   not the current score. The remaining error mass (`house→techno` 100
   disagreements) is genuine sub-genre ambiguity → only the
   cluster-proposed-labels fix (§5b.3.5) attacks it.
5. **Gates must judge the readout they name.** The first `--eval
--refold` gate judged the baseline arm and reported "below target"
   while the arbitration arm passed — a gate-semantics bug caught in
   verification. The gate now judges the refold arm when armed
   (regression-pinned). _Lesson: a metric named "post-X" must be
   computed post-X._
6. **Dry-by-default with reassess-everything semantics is the pattern
   that made both passes idempotent.** Each run recomputes proposals
   from the full population (not a delta log), so re-runs converge to
   zero changes and stale fixes self-heal. Both passes verified
   idempotent on the live DB (refold 3458/3458 canonical; flag stable
   at 96 on re-run).

**Sub-genre handling**: ranked secondaries (§5b.2), not more primaries.
`Deep House/Indie Dance/Nu Disco` → primary `deep house` + secondaries
`indie dance`, `nu disco`; each maps to family independently. New
sub-genres arrive via the ≥5-occurrence alias rule or cluster proposals —
never by trusting one track's SC string.

## 6. Bonus: vocal display on the XDJ-XZ (the hardware question)

The XDJ-XZ shows **memory-cue marks with rekordbox-set colors** on both
waveforms (manual §12: "The colors for cue points and Hot Cue points can
be set in rekordbox") — but **no text labels**; hardware shows colored
marks only (CDJ-3000/XDJ-AZ add phrase display, XDJ-AZ even shows
"scale or phrase" waveform divisions). So the easy, supported way:

- **Color convention on memory cues**, written by our rb-cues seam
  (already WIP): e.g. red = vocal section start, blue = instrumental/
  drop start, green = breakdown. `megadj` derives vocal/instrumental
  segments from the analysis we already run; the booth reads color at a
  glance.
- Hot cues A–H stay reserved for performance points (semantic placement,
  per AGENTS) — the vocal layer lives in _memory_ cues, which are also
  displayed above the waveform and don't consume the 8 pads.

One honest caveat: XDJ-XZ pad lighting for hot cues follows its own
`HOT CUE COLOR` utility setting; memory-cue colors come through from
rekordbox reliably, which is exactly why the convention uses memory cues.
