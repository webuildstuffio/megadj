# FullTags — Genre Taxonomy: Authoritative Sources, Family Map, Embedding Validation (Sep 14, 2026)

**Status:** 📚 REFERENCE — current taxonomy authorities, family map, and validation.

**Audit** → [genre-audit](genre-audit.md) · [embedding-models](embedding-models.md) · [MegaSet PRD](../megaset/01-prd.md)

> Glossary (Discogs-400 head, Tier 1/2/3, kNN, tower):
> [10-findings §5](../megaset/10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

The follow-up to the genre audit: _which external taxonomy is authoritative,
is our 9-family map right, how deep do sub-genres go, and is the embedding
tower any good?_ Every claim below is measured on the live archive or
sourced from the taxonomies themselves.

---

## 1. Authoritative anchors (researched, not guessed)

There is no ISO standard for music genres. Four sources dominate, each with
a clear scope:

| Source                                      | Scope                                    | Structure                                                                                                                                 | Status                                                                    | Role for us                                                                     |
| ------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Beatport**                                | DJ/electronic sales — _our exact market_ | 2-tier: ~36 main genres + subgenres (e.g. Techno → Peak Time/Driving, Raw/Deep/Hypnotic; House → Deep/Tech/Afro/Funky/Jackin/Progressive) | Live, curated, updated Sep 2025 (added open-format Hip-Hop/R&B/Pop/Latin) | **Primary anchor for electronic labels** — the words DJs and pools actually use |
| **Discogs**                                 | All physical releases, community-curated | 2-tier: ~15 genres → **400 styles** (fixed list)                                                                                          | Live, monthly data dumps                                                  | **Primary anchor for sub-genre styles** — and structurally special for us (§4)  |
| **Every Noise at Once** (Spotify/Echo Nest) | All streaming, algorithm-derived         | ~6,291 flat micro-genres, no hierarchy                                                                                                    | **Frozen** — Glenn McDonald laid off Dec 2023, site static since Feb 2024 | Breadth reference for niche/scene names; _not_ a maintained authority           |
| **SoundCloud**                              | Uploads                                  | Free-text genre field + hashtag tags                                                                                                      | Live, unvalidated                                                         | Provenance only — never an authority (§5)                                       |

**Decision: Beatport is the standard for what we sell (DJ genres), Discogs
is the standard for what we describe (styles).** Every Noise is a lookup
table for scene names, frozen in time — useful for mapping `hardtekk`-style
niche labels that Beatport hasn't admitted yet, but it will never gain a
new genre. SoundCloud fields are artist free-text: the _raw_ provenance of
most of our mess.

For your specific example: **`hip-hop` is the standard form** — Beatport
(added 2025), Discogs (`Hip Hop`), and Every Noise all agree on the
hip-hop/rap axis, and our library's dominant spellings (`hip-hop` 116,
`hip-hop & rap` 39, `hiphop` 7) fold to it. `House`/`house` → `house`:
Beatport lists House with subgenres; Discogs has `House` as a style under
Electronic; our casefold already handles it.

## 2. The Discogs-400 discovery: a classification head for our own tower

Essentia ships `genre_discogs400-discogs-effnet` — a 2 MB classification
head that predicts all **400 Discogs styles directly from our existing
1,280-d embeddings**. No new audio analysis: it's a frozen TF graph taking
`(n, 1280) → (n, 400)`. Our tower was trained on Discogs style labels, so
this is the taxonomy the embedding space was _built_ to speak.

Measured on the full embedded+labeled population (v3 guarded numbers,
n=2,982 family-evaluable; the unguarded n=3,001 run scored top-1 49.3 /
top-3 68.7 / top-5 77.2 — consistent, guard is neutral per §5b.1):

| Metric                              | Value                               |
| ----------------------------------- | ----------------------------------- |
| Label family in head top-1          | **46.1%** · CI [44.3, 47.9]         |
| Label family in head top-3          | ~69%                                |
| Label family in head top-5          | ~77%                                |
| Inference cost on cached embeddings | ~1 ms/track (batched), 2.1 MB model |

Per-family top styles confirm the space is sane: `house ← House(623),
Progressive House(197), Techno(170)`; `hiphop ← Trap(28), Cloud Rap(22)`;
`trance ← Tech Trance(20), Trance(11)`.

**Interpretation.** As an _oracle_ the head is worse than our kNN (top-1
46% vs kNN 57.6% ungated / 62.7% gated — McNemar-conclusive, §5b.1) —
expected, since it was trained on human Discogs
labels, the same kind of noisy truth we're measuring against. As a _signal_
it's a gift: **ranked, fine-grained Discogs styles for every track,
including the 206 unlabeled ones, for free** — no rescan. This becomes the
backbone of ranked secondary genres (§7 of the audit): primary = label,
secondaries = head top-3 styles, family = agreed union.

## 3. Are the 9 families right? (audited against live data + audio)

Ran every distinct raw label through the real `genreFamily()` SSOT:

- Coverage was **87.9%** (3,039/3,458 tracks). The 419 unmapped tracks were
  not noise — they contained real genres the map had never claimed.
- Every unmapped label with n≥2 was arbitrated by the Discogs-400 head's
  placement of its members:

| Label (tracks)                                                           | Head says                                            | Family            | Added?    |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------- | --------- |
| `grime`                                                                  | Bassline/Dubstep cluster                             | bass              | ✅        |
| `jersey club` (2), `donk` (4), `wall slappers` (2)                       | bass-music cluster                                   | bass              | ✅        |
| `minimal` (2), `minimal / deep tech` (4), `hardtekk` (8), `softtekk`     | techno families                                      | techno            | ✅        |
| `eurodance` (2), `nightcore` (3), `uptempo`, `hard dance / hardcore` (2) | EDM/hard-dance cluster                               | edm               | ✅        |
| `idm`, `chillwave`, `synthwave`, `world`, `spoken word`                  | downtempo/abstract cluster                           | mood              | ✅        |
| `country` (3)                                                            | pop cluster                                          | pop               | ✅        |
| `groove` (10)                                                            | — (self-named family)                                | groove            | ✅        |
| `dance` (113)                                                            | **house 65 / trance 17 / bass 14** — genuinely mixed | edm (least-wrong) | ✅ + flag |

- **Bugs found and fixed along the way:** 19+ rows stored HTML-escape
  artifacts (`r\u0026b`, `hip-hop \u0026 rap`) — `normalizeGenre` now
  repairs `\uXXXX` sequences before matching (tested). Junk-URL labels
  (`djsoundtop.com` ×5) stay null by construction.

Post-fix coverage: **93.4%** (3,230/3,458). The 228 still-unmapped are the
by-design honest gaps: `music` (154, normalization-nulled), `edits /
bootlegs` (18, intentionally unmapped), `other`, and single-track junk.

**Are 9 families the right count?** Measured answer: yes for _scoring_ —
the B6 diversity guard needs bins the embedding space actually separates,
and these 9 are exactly the clusters the head + kNN find. Beatport's 36
main genres are for _browsing_ (Tier 1). Never collapse scoring below 9
(house+techno → "club" would erase the sharpest boundary in the library)
and never grow scoring past ~12 (families without cluster support fragment
the vote pools).

## 4. Sub-genre depth: how far, and what's the limit?

Three tiers, each with a different owner — depth is unlimited upward from
the family because _the family set stays fixed_:

```
Tier 1  display    raw/canonical label     unlimited, data-driven
        e.g. deep house, progressive house, hardtekk
Tier 2  scoring    9 families              FIXED (the only scoring unit)
Tier 3  audio      Discogs-400 styles      unlimited, head-proposed
        e.g. Electronic---Bassline, Hip Hop---Cloud Rap
```

- **Display can go as deep as the data does** (`hardtekk` is a fine Tier-1
  label — humans know what it means), as long as nothing scores it.
- **Scoring never goes below the 9 families.**
- **Tier 3 (Discogs styles) is the "how specific is this track really"
  layer**, capped at 400 values by the taxonomy itself — a managed
  vocabulary, unlike SoundCloud's infinite tag soup. New sub-genres enter
  when (a) they map to an existing style (alias) or (b) a coherent
  embedding cluster proposes one (human-reviewed, per the audit's
  cluster-plan). There is no explosion risk: Tier 2 is fixed, and Tier 3 is
  bounded.

## 5. SoundCloud: wrong-written, not wrong

You're right that SC is the best _source of truth about intent_ — the
artist meant something real. The evidence agrees: the garbage in our column
is formatting, not semantics. Measured:

- 88% of raw labels are case/spacing duplicates of another label
- 19+ rows are HTML-escape artifacts (`\u0026` for `&`)
- URLs pasted into genre (`djsoundtop.com` ×5), JSON blobs (1), artist
  names (`rihanna`, `spencerparker`), status words (`premiere`, `vip mix`)
- Multi-genre slash-soup (389 rows) that's real signal in the wrong shape

That's a **sanitization problem, not a trust problem** — the 58.7%
audio-consistency of ingest-pool labels vs 62.2% for RB shows no label
source is audio-truth anyway; SC free-text is just the _least formatted_
of them.

## 6. The deterministic LLM mapping pass (bulk, OpenRouter)

Your instinct is right and the design is constrained: LLMs are terrible at
_deciding_ genres from audio and fine at _rewriting strings to fit a
vocabulary_. The task is bounded, auditable, and cheap:

- **Input**: the distinct-label census only — ~459 raw labels, not tracks.
  The unit of work is tiny.
- **Task**: map each raw label to one of {a Beatport main-genre/subgenre
  token, a Discogs style, `other`} — with the taxonomy list _sent in the
  prompt_ (a tag cloud to fit, exactly as you said), temperature 0,
  JSON-schema-forced output.
- **Determinism**: temperature 0 + constrained output + a fixed
  model/version pin makes it a pure function `string → token`. Every
  output is then **validated against the vocabulary before write** — an
  LLM can only ever choose from the list, never invent. Anything invalid
  falls back to `other` and lands in the `--report` queue.
- **Cost/scale**: one-time ~459 calls (or one batched prompt per 50
  labels); re-run only when the unmapped-census grows. Compare: the
  mechanical refold handles the 88% case/spacing duplicates for free —
  the LLM pass is only for the residue where regex aliasing is ambiguous
  (`electro` → edm vs Discogs `Electro` style; `idm` → mood).
- **What it is NOT**: not per-track classification (embeddings own that),
  not a lookup authority (Beatport/Discogs own that), not allowed to touch
  rows whose source is pool/RB (trust weights stand).

Order of operations stays: mechanical refold first (free, deterministic),
head-proposal second (free, deterministic), LLM pass last — and only for
the shrinking residue the first two can't place.

## 7. Is the embedding model any good? (already benchmarked — recap)

The full 6-tower benchmark lives in [embedding-models](embedding-models.md)
(harness committed at `tools/emb_benchmark.py`). Short version — **v2 rerun
(n=180, 120 s cap, 0 fails) is the verdict; the v1 table below it is kept
for the record only**:

| Tower                               | LOO family (k=5) | Retrieval coherence | s/track |
| ----------------------------------- | ---------------- | ------------------- | ------- |
| **discogs-effnet-1280 (v2 winner)** | **0.444**        | **0.362**           | 0.56    |
| msd-musicnn-200                     | 0.300            | 0.292               | 0.75    |
| vggish-128                          | 0.278            | 0.231               | 0.75    |
| openl3-music-512                    | 0.272            | 0.243               | 2.97    |
| mert-v1-95m-768                     | 0.256            | 0.233               | 3.88    |
| clap-htsat-512                      | 0.244            | 0.250               | 0.50    |

<details>
<summary>v1 table (superseded — broken-harness artifact, kept for the record)</summary>

| Tower                           | LOO family (k=5) | Retrieval coherence | s/track |
| ------------------------------- | ---------------- | ------------------- | ------- |
| msd-musicnn-200                 | **0.538**        | 0.323               | 1.60    |
| discogs-effnet-1280 (incumbent) | 0.413            | **0.335**           | 0.85    |
| openl3-512                      | 0.400            | 0.275               | 7.77    |
| vggish-128                      | 0.300            | 0.220               | 1.27    |
| clap-htsat-512                  | 0.213            | 0.175               | 0.50    |

</details>

**Plan of record (v2, measured): effnet stays the single tower for BOTH
retrieval ("sounds like") and genre kNN.** The v1 "musicnn wins genre"
lead was a harness artifact; the fusion sweep settled (best ensemble
+1.1 pt at 2–6× cost — not adopted); MERT measured 19 pts worse at 7×
cost across three pooling schemes (representation failure). The
promotion gate for any challenger: post-refold rerun where effnet
stalls <0.50 or a tower leads by ≥3 pts on the guarded population. How
do we know it's good? Not by vendor numbers — by this library, this
metric, re-run after every label-hygiene step: §5b's `genre --eval` is
the standing regression gate, and `tools/emb_benchmark.py` re-scores
towers on demand.

## 8. What shipped vs what's queued

**Shipped this session (tested, live):**

- `normalizeGenre` escape-artifact repair (+tests)
- Family map additions: grime/jersey/donk→bass, minimal/deep-tech/tekk→
  techno, eurodance/nightcore/uptempo/hard-dance→edm, idm/chillwave/
  synthwave/world→mood, country→pop, groove/dance anchors (+tests)
- Coverage 87.9% → **93.4%**; family totals now house 1,497 / edm 742 /
  techno 356 / pop 217 / bass 120 / hiphop 105 / groove 102 / trance 66 /
  mood 25
- This doc + the Discogs-400 full-population eval numbers

**Queued (in dependency order):**

0. **Tier-0 diagnostics** (S, research review §5) — label-error clustering
   by artist/imprint, artist-overlap rate in top-5, hubness histogram,
   confusion matrix + top-2 in `genre --eval`. Decides everything below.
1. `genre --refold` (S) — mechanical pass; absorbs the escape fixes at the
   data layer, not just the read layer. **Now includes the plain-`edm`
   umbrella arbitration** (keep hardtekk + all Tier-1 sub-genre labels; only
   scoring-family arbitration changes).
2. Ranked secondaries via head top-3 (S–M) — the §2 pipeline; runs on
   cached embeddings in minutes, no rescan
3. LLM residue pass (S, one-shot) — only for labels the first two can't
   place; OpenRouter, temp 0, vocabulary-constrained; **now fed by a
   web-search (exa/brave) research arm for disputed imprint→scene
   confirmations — harness-only, never a runtime ladder dependency**
4. ~~`genre --eval` harness as a command~~ **SHIPPED 2026-09-14** —
   `megadj genre --eval` runs the LOO harness over the live DB (gated
   62.6% vs the ≥65% post-refold target; exit code 1 below target so
   scripts fail loudly). The standing hygiene gate. **Queued extensions:
   `--probe`, `--artist-disjoint`, confusion matrix + top-2.**
5. **Multi-source vote ladder + Bandcamp arm** (M) — the §5c disputed pass
   generalized to a weighted vote across RB / ingest pools / SC / Beatport
   / Bandcamp (direct page fetch; yt-dlp's BC extractor is broken upstream)
   / Discogs-400 head / kNN consensus; deeper label wins for display when
   sources agree, disputes flag, and a future **display-depth config** lets
   the DJ choose Tier-1-only vs Tier-1+Tier-3 display. The DB stays the
   multi-value SSOT (ID3v2.3 TCON carries one slash-joined primary — file
   tags remain output-only).
