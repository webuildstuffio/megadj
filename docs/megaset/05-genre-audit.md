# MegaSet / FullTags — Genre Audit & Inclusion Policy

v1 · 2026-09-14 · **Audit** → [PRD](01-prd.md) · [Benchmarks](04-sequencing-benchmarks.md) · [Analysis](03-competitive-analysis.md)

Questions this doc answers, with live data (`archive.db`, 3,798 genre-carrying
rows, 2026-09-14):

1. Can we trust our genre mapping? (No — measured.)
2. Sub-genres: keep, alias, or rank? (Two-tier: labels for humans, families
   for math, embeddings for fine similarity.)
3. How does genre enter the set builder? (Family-level diversity guard only.)
4. `deep house` vs `house` — which is "better"? (Neither is audio-real;
   measured below.)

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
