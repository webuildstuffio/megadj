# MegaSet / FullTags — Genre Audit & Inclusion Policy

v3 · 2026-09-14 · **Audit** → [PRD](01-prd.md) · [Benchmarks](04-sequencing-benchmarks.md) · [Analysis](03-competitive-analysis.md) · [Taxonomy sources & family map](07-genre-taxonomy-sources.md)

> v2: baselines refreshed post-`rb-comment-sync` (coverage 56%→94.4%),
> LOO numbers corrected to full-population methodology (§5b.1 method note),
> new §5c source-precedence ranking with measured file-tag round-trip
> pollution. v3: family map upgraded to 93.4% coverage with audio-verified
> placements (§7 of the taxonomy doc); escape-artifact repair shipped;
> Discogs-400 head evaluated as the ranked-secondary source.

Questions this doc answers, with live data (`archive.db`, 3,458 genre-labeled
of 3,664 downloaded rows, 2026-09-14):

1. Can we trust our genre mapping? (No — measured.)
2. Sub-genres: keep, alias, or rank? (Two-tier: labels for humans, families
   for math, embeddings for fine similarity.)
3. How does genre enter the set builder? (Family-level diversity guard only.)
4. `deep house` vs `house` — which is "better"? (Neither is audio-real;
   measured below.)
5. Six candidate sources — which wins? (§5c: audio consensus > curated pool
   > RB > SC free-text; file tags never — measured round-trip pollution.)

---

## 1. The measured mess

| Measure                                              | Value                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distinct raw genres (case-sensitive)                 | 459                                                                                                                                                   |
| Rows that are case/spacing duplicates of another row | **3,339 of 3,798 (88%)**                                                                                                                              |
| Example variants                                     | `Afro House`×22 / `Afro house`×3 / `AFRO HOUSE`×1 · `House`×483 / `house`×355 · `Hip-Hop`×116 / `hiphop`×7                                            |
| After casefold+trim                                  | 440 distinct                                                                                                                                          |
| Singleton genres (1 track each)                      | **304** — 69% of the vocabulary describes 8% of the library                                                                                           |
| Top-10 coverage                                      | `house` 838, `edm` 353, `techno` 322, `tech house` 207, `music` 154, `pop` 139, `progressive house` 128, `electronic` 128, `hip-hop` 116, `dance` 113 |
| Junk labels present                                  | `music` (154), `edits / bootlegs` (26), `dance & edm`, `dance / electro pop`, `edm bass`                                                              |

Sources are the usual suspects: SoundCloud free-text (artist-chosen, wildly
inconsistent), plus tags from pool rips. The 88% duplicate rate means the
first cleanup is mechanical, not intellectual.

## 2. Do embeddings agree with genres? (the trust test)

kNN purity on real data (150 queries over 3,415 embedded+genre tracks):
does a track's 5 nearest embedding-neighbors share its label?

| Level                     | 5-NN majority agreement                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| Raw label (`deep house`)  | **7%**                                                                 |
| Family level (`house`)    | **39%**                                                                |
| `deep house` specifically | **0 / 60** tracks keep the specific label; 31/60 agree at family level |

Reading: **audio does not encode our sub-genre labels.** A `deep house`
track's nearest audio neighbors are labeled tech house, progressive house,
melodic house & techno — the _labels_ differ but the _sound_ is one
continuum. Family mapping recovers real structure (39% >> 7%); specific
sub-genre labels are metadata folklore with ~zero audio reality. (Labels
still carry _scene_ information — what the artist/label calls it — which
audio can't know. Both are true; they answer different questions.)

**Verdict: we do NOT trust specific genre labels as audio truth, and never
will at this label hygiene.** Families are weak-but-real; embeddings are
the fine-grained similarity source.

## 3. The policy: two-tier genre

### Tier 1 — canonical label (display + browsing)

- One-time `megadj genre --refold` pass: casefold+trim → alias-map →
  canonical. `Hip-Hop`/`hiphop`/`HipHop` → `hip-hop`; `House`/`house` →
  `house`. Mechanical wins first: ~440 → ~120 canonical labels.
- **Aliases, not deletion.** The raw string stays in provenance
  (`tracks.genre_raw` conceptually; we keep the source string in the
  fetch ledger/history) so nothing is lost — the canonical column is what
  every consumer reads.
- **Ranked specificity is GOOD for display** (`deep house` tells a human
  more than `house`), as long as nothing downstream treats "deep house"
  and "house" as unrelated bins. Hierarchy: `label ⊂ family`.

### Tier 2 — family (scoring)

- `genreFamily()` (existing SSOT, 9 families: bass/house/techno/trance/
  hiphop/edm/pop/groove/mood) is the ONLY genre signal the set builder
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
an audit report (`megadj genre --report`) lists unmapped labels by
frequency so extending the table is a 5-minute data-driven task, not a
guess. No LLM mapping, no cloud genre APIs.

### Is generic-better or specific-better?

Both, at different tiers: **generic (family) is better for scoring**
(only level with audio support), **specific is better for browsing**
(human meaning). The one thing we must NOT do is score specificity —
the 7% purity number says sub-genre distance is fiction.

## 4. Inclusion in the set builder (this product)

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

## 5. The refold plan (FullTags work, ahead of B6)

1. `megadj genre --refold` (S, one session): casefold+trim → alias table
   (`shared/genre-aliases.ts`, tested SSOT) → write canonical back;
   `--report` lists unmapped labels by count. Expected: 459→~120.
2. Family coverage check: `% of library mapping to a family` before/after
   (target >90%; `music`/`edits / bootlegs` intentionally unmapped).
3. Diversity guard consumes `genreFamily()` — B6 unblocked.
4. Optional later: embedding-neighborhood seeding — cluster the embedding
   space and see which clusters have coherent _unlabeled_ identity;
   propose new canonical labels from data, not from tag folklore.

## 5b. Deep plan — multi-genre storage, inference evaluation & the FullTags-owned fix (Sep 14, measured)

The question "can't FullTags just fix all this?" — mostly **yes**, because
every fix lands in data FullTags already owns. What follows is the deeper
plan plus the benchmark numbers that size each step.

### 5b.1 Measured baselines (live archive, 2026-09-14, post `rb-comment-sync`)

| Measure                                                          | Value                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Genre coverage (downloaded)                                      | **3,458/3,664 = 94.4%** (was 56% before `rb-comment-sync` filled file-tag genres into DB rows)                                                               |
| Genre coverage by source                                         | `ingest` (pool rips) 526/531 = **99.1%** · `rekordbox` 2,932/3,133 = 93.6% · `liked-videos` pending 0/1,087 (unlabeled until downloaded)                     |
| Unlabeled downloaded (inference targets)                         | **206** — of which **203 already embedded**, ready for kNN the moment we choose to fill them                                                                 |
| Embedded + labeled (kNN-eligible)                                | 3,415                                                                                                                                                        |
| Labels covering 90% of rows                                      | **105** — the alias table has a hard, small target                                                                                                           |
| Distinct raw labels / casefolded                                 | 459 / 440 (unchanged — refold not yet run)                                                                                                                   |
| Junk-label mass (`music`, `edits / bootlegs`, …)                 | 180 rows                                                                                                                                                     |
| Multi-genre strings already in the wild                          | **389 rows** (`Electronic/House`, `Deep House/Indie Dance/Nu Disco`, `Techno (Peak Time / Driving)`) — the data is ALREADY multi-genre, stored as slash-soup |
| Numeric SC genre IDs in DB                                       | **0** — the write-point guard holds (`1482891500`-style labels never enter `tracks.genre`)                                                                   |
| **Leave-one-out kNN family agreement, ungated (label vs audio)** | **k=5: 60.8% · k=7: 61.3%** (full n=3,008 population)                                                                                                        |
| Same, gated at ≥0.6 vote strength                                | k=5: 65.6% (n=2,482, refuses 17.5%) · k=7: 72.5% (n=1,633, refuses 45.7%)                                                                                    |
| Vote strength @k=7                                               | unanimous ≥6/7: 31% · majority 4–5: 53% · split ≤3: 16%                                                                                                      |
| Agreement by source (gated LOO sample)                           | `rekordbox` (RB-analyzed) **62.2%** · `ingest` (pool) **58.7%**                                                                                              |

> **Method note (Sep 14 correction):** the earlier "k=5: 76.5%" figure was
> computed on the ≥0.6-gated _subset_ only (n=601 at k=7). The honest
> full-population numbers are ~61% ungated / ~66–72% gated. Same
> conclusions, smaller margin: k=5 stays (best gated coverage per refusal),
> the 0.6 gate stays (gated ≫ ungated at k=7: +11.2 pts), and no single
> label source is audio-truth. Eval targets updated: **LOO ≥70% gated**
> post-refold (not 80% — that would require label quality the sources
> don't have).

Readings:

1. **k=5 is measurably the right neighborhood** — at k=5 the gate refuses
   only 17.5% of tracks while keeping a +4.8-pt agreement lift; at k=7 it
   refuses 45.7% for +11.2 pts. For _inference_ (filling 203 blanks) use
   k=5 (more answers); for _dispute flagging_ use k=7 (more confidence
   per answer). `inferGenre` keeps k=5 default.
2. **Every label source is ~59–66% audio-consistent.** No source is truth;
   the _consensus of neighbors_ outperforms any single label. This is the
   argument for genre as **ranked, multi-valued** data rather than one
   string.
3. **16% of tracks sit in split neighborhoods** (≤3/7 agreement) — the
   genuine genre-boundary tracks (melodic techno ↔ progressive house).
   Forcing a label is lying; the existing ≥0.6 min-agreement gate correctly
   refuses roughly this share. Gate stays.

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

1. **Refold** (§5, now with the measured target: **105 labels cover 90%**;
   the alias table is small and finite). Split multi-label strings on
   `/ , &` into ranked secondaries (389 rows healed here).
2. **Demote-and-flag pass**: sources get trust weights from the measured
   table (RB 0.62, ingest 0.59, SC free-text lowest); rows whose label
   disagrees with a unanimous kNN consensus get `genre_flag='disputed'` —
   NOT rewritten (a human decision), but excluded from inference seeding
   so one bad label poisons fewer votes.
3. **Inference for the unlabeled 206** (203 already embedded): existing
   `inferGenre` at k=5, minAgreement 0.6 — now benchmark-validated on the
   full population (60.8% ungated → 65.6% gated; the gate trades 17.5%
   refusal for +4.8 pts). `--apply` fills empty columns only;
   disputed/no-quorum stay honest gaps. At 94.4% coverage the remaining
   upside is small — this step is cheap but not load-bearing.
4. **Periodic `megadj genre --eval`** (new, small): re-runs the
   leave-one-out harness over the live DB and prints agreement +
   vote-strength distribution — the regression test for label hygiene.
   If refold/inference makes things worse, the number says so. Targets
   (corrected Sep 14 against full-population baselines): **LOO gated
   ≥70% after refold** (baseline 65.6% @k=5, 72.5% @k=7 — target the
   k=5 number), disputed share <10%.
5. **Embedding-neighborhood labels (later, the deep fix)**: cluster the
   3,415 vectors; coherent clusters _propose_ canonical labels from their
   members' consensus, reviewed by a human — new sub-genres enter the
   taxonomy from audio reality, not tag folklore.

### 5b.4 What NOT to build

- No `genre_raw` schema migration — the fetch ledger already preserves
  provenance; a second copy invites drift (house rule: one source of truth).
- No tag-space multi-genre (breaks hardware/interop, §5b.2).
- No third-party genre APIs / LLM classification — measured consensus beats
  both, locally and free.
- No auto-relabeling of disputed rows — flagged-but-untouched is the honest
  state; relabeling is a human decision.

### 5b.5 Effort & order

| Step                                         | Size   | Depends on                          |
| -------------------------------------------- | ------ | ----------------------------------- |
| Refold + alias SSOT + multi-label split      | S      | —                                   |
| Ranked secondary storage (`track_genres`)    | S–M    | refold                              |
| Disputed-flag pass + source trust weights    | S      | refold                              |
| `--eval` harness as a reusable command       | S      | — (this doc's harness, productized) |
| Inference for unlabeled (k=5 pinned by eval) | exists | —                                   |
| Cluster-proposed labels                      | M      | everything above, later             |

**Tower note (Sep 14):** musicnn is the measured genre candidate on the
80-track harness (**53.8%** leave-one-out family agreement vs 41.3% for
effnet). The tested effnet+musicnn ensemble improves effnet to 46.3% but
trails musicnn, so there is no production switch until the repaired harness
repeats the result on the larger post-refold set. Tower numbers and gate:
[06-embedding-models.md](06-embedding-models.md).

### 5c. Which source wins? (the "6 sources — do we take SoundCloud?" question)

The candidate sources, ranked by **measured** audio-consistency (gated LOO)
and by role. Precedence rule that falls out: **audio consensus outranks
every human/label source; among label sources, the curated pool outranks
RB metadata outranks SC free-text; file TCON is never a source** — it's an
_output_ we wrote.

| Rank | Source                                           | Audio-consistency                                                                                                                                                                                                                                                                                                               | Role in the pipeline                                                                                         |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | **Embedding kNN consensus** (our own ONNX)       | the _reference_, not a claim                                                                                                                                                                                                                                                                                                    | Tie-breaker + inference + dispute flagging. Decides families; never invents sub-genre labels.                |
| 2    | **Ingest pool tags** (Bandcamp/Hypeddit-quality) | 58.7% (n=443 sample)                                                                                                                                                                                                                                                                                                            | Highest-quality _human_ labels — curated releases carry real genre. Primary for Tier-1 display when fresh.   |
| 3    | **Rekordbox mirror** (RB/artist-entered)         | 62.2% (n=793 sample)                                                                                                                                                                                                                                                                                                            | Bulk coverage (2,932 rows). Primary display only where pool didn't label; always family-scored.              |
| 4    | **SoundCloud free-text** (artist-chosen)         | not directly measurable (numeric-ID guard blocks the worst); visible as the junk tail (`music`×154, `edits / bootlegs`)                                                                                                                                                                                                         | Lowest trust. Never primary; feeds the alias table only when ≥5 occurrences map cleanly.                     |
| 5    | **File TCON tags**                               | **never a source** — round-trip pollution measured: numeric SC IDs _baked into files_ (`Jerome Isma-Ae · Smile…` carries TCON `1482891500`), Beatport tag-soup sentences (`…dance indie electronic electronic pop…`), slash-soup with embedded newlines. DB↔file exact agreement only 81% (55-tag sample); family agreement 70% | Output-only. `rb-comment-sync` writes it; readers must treat file TCON as a cache of the DB, never upstream. |
| 6    | **Cluster-proposed labels** (future, §5b.3.5)    | n/a — derived from #1                                                                                                                                                                                                                                                                                                           | New canonical labels enter from audio reality; human-reviewed.                                               |

**How precedence executes** (the disputed-flag pass, §5b.3.2, concretely):

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
destroys the display signal the 0/60-purity result says is folklore but
humans still want, and refold can always broaden later; it can't recover
what intake threw away.

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
