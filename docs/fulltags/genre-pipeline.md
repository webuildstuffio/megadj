# FullTags — Genre Pipeline Architecture (Sep 16, 2026, rev 6)

**Status:** 📚 REFERENCE — how the genre system processes a track, end to
end. Every stage below ships and runs on the live archive.
**Rev 6 (Sep 17): the breakdown's explainability read is wired through
every surface (#215) — `megadj genre-why <id>` (CLI; exit 1 on a DRIFTED
row), `archive_genre_why` (MCP), `/api/archive/genre-why` (HTTP), and
the FullTags ⌗ Genre Why tab (UI, weight bars + drift callout). All
three replay through the write path's exact `electGenre` seam, so a
displayed winner can never disagree with the row.**
**Rev 5 (Sep 16): the weighted multi-source vote ladder is LIVE (#173)
— every rung (SC/BP/BC/imprint/AI/MB/file/sync) casts a vote
(genre + weight + provenance) through `src/fulltags/genre/genre-vote.ts`;
highest total weight elects, ties break toward the harder gate, and the
breakdown persists in `tracks.genre_votes` (every stored genre is
explainable). First-win writes are gone. Also Sep 16: `megadj regate
genre` runs the LOO harness against the ≥65% ship gate (#169).**
**Rev 4 (Sep 15): Bandcamp is now a LIVE ladder source (W2b, third vote
behind SC → BP) with the shared hard artist gate; W1's `Music` mint
removed (#61 stop-new-damage half; unstrand of ~154 legacy rows still
queued). The SC/BP/Bandcamp scorers share one name-matching seam
(`src/fulltags/sources/name-match.ts`).**
**Rev 3 (Sep 15): W2 hard artist gate shipped (`scoreScHits`, mirrors
Beatport's — wrong-uploader hits can no longer win the [0] slot); W1
`Music` mint removed (#61 stop-new-damage half; unstrand of ~154 legacy
rows still queued).**
**Rev 2 (Sep 15): full write-source inventory (§2) — every path that can
put a genre in the DB, including the two the v1 walkthrough missed
(`megadj ingest` W6, `megadj enrich`/MusicBrainz W5); `sc_genre_ids`
cache flagged as orphaned (§5).**

Reading order by question:

- _"Where does a genre come from? Who writes it?"_ → §2 write-source inventory.
- _"What happens to a track's genre, step by step?"_ → §3 flow + §4 invariants.
- _"Why is it built this way?"_ → §8 design rationale.
- _"What's still broken / missing?"_ → §5 known residue (issue-linked).
- _"What are the current numbers?"_ → §6 live state.
- _"Where is the code?"_ → §7 module map.

**Consumers** → [genre-audit](genre-audit.md) (policy + numbers) ·
[genre-taxonomy-sources](genre-taxonomy-sources.md) (authorities + family
map) · [tier0-diagnostics (archived)](../archive/tier0-diagnostics-2026-09-15.md)
(measured verdicts) · [MegaSet PRD](../megaset/01-prd.md) (downstream).

---

## 1. The one-paragraph version

A track's genre enters the archive DB from real sources (SoundCloud →
Beatport → MusicBrainz → AI strictly opt-in — the full inventory is §2),
is canonicalized by the refold, never clobbered by inference (only EMPTY
columns are predicted), scored through a 9-family map with umbrella
arbitration, hygiened by two idempotent passes (refold = rewrite
canonicalization, flag = metadata-only dispute marking), and verified by
a leave-one-out harness with a hard ≥65% ship gate. The file tag is
OUTPUT-only — the DB row is the SSOT, and the DB never claims a genre
the file doesn't carry.

## 2. Where genre comes from — EVERY write path (the full inventory)

There is no hidden eighth source. These eight paths are the only code
that can put a genre into `tracks.genre` (search: `updateGenre` /
`UPDATE tracks SET genre`):

| #   | Path                    | Command                                        | Source of the claim                                                                                                                                                                        | Trust                                                                          | Gate before write                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | **GetDat sync**         | `megadj sync`                                  | YouTube category / regex over title+channel (`src/fulltags/write/metadata-build.ts`) — unknown stays **null** since Sep 15 (no more `Music` mint)                                                | lowest (category, not genre)                                                   | raw non-`Music` genre passes through; nothing else — this path no longer invents labels                                                                                                                                                                                                                                               |
| W2  | **SoundCloud search**   | `megadj fetch`                                 | SC artist free-text via yt-dlp search hit                                                                                                                                                  | low (free-text; junk gate)                                                     | **hard artist gate (Sep 15)**: query artist ≥3 chars must match the hit's uploader, else the hit is dropped (mirrors Beatport's `scoreBpHit` gate; fixes wrong-artist genre writes — remixes still pass via remixer/label channels) + numeric-ID / `Music` refuse → `canonicalizeClaim` → **tag write first**, DB only on tag success |
| W3  | **Beatport lookup**     | `megadj fetch` (when SC misses)                | Beatport store genre (`bpGenre`)                                                                                                                                                           | medium-high (store taxonomy)                                                   | same tag-first discipline as W2                                                                                                                                                                                                                                                                                                       |
| W2b | **Bandcamp vote**       | `megadj fetch` (when SC AND BP miss)           | artist-entered tags on the bandcamp item page (`src/fulltags/sources/bandcamp.ts`) — same junk gate as W2                                                                                          | medium (artist-tagged, label-curated pages; junk rare)                         | **hard artist gate** (band/artist must contain the query artist) before the page fetch; one fetch votes genre + year (publish date) + label (publisher) + art (og:image)                                                                                                                                                              |
| W4  | **AI classifier**       | `megadj fetch` with `aiAllowed`                | OpenRouter, closed `AI_VOCAB` vocabulary, conf ≥ 0.7                                                                                                                                       | medium                                                                         | fires ONLY when SC AND Beatport both missed; **opt-in, off by default**                                                                                                                                                                                                                                                               |
| W5  | **MusicBrainz harvest** | `megadj enrich`                                | MB artist folksonomy tags (`src/fulltags/sources/mb.ts`)                                                                                                                                           | medium (community-curated)                                                     | fills weak/missing only; tag-write-first                                                                                                                                                                                                                                                                                              |
| W6  | **Ingest file tags**    | `megadj ingest`                                | the FILE's own TCON (pool rips — Bandcamp/Hypeddit-quality), MB artist tags as fallback (`src/getdat/commands/ingest.ts`)                                                                  | medium (measured 53.1%)                                                        | real-genre check (refuses `Music`) before adopting the file tag                                                                                                                                                                                                                                                                       |
| W7  | **Imprint prior**       | `megadj fetch` (when SC AND BP miss the genre) | the track's record label (Beatport-filled TPUB / Bandcamp publisher) mapped to a scene family via `IMPRINT_FAMILIES` (`src/fulltags/sources/imprint-prior.ts`, every row cited with source + date) | metadata, not audio truth — near-ground-truth for SCENE on electronic imprints | fires only when SC AND BP both missed the genre; unknown/junk label = abstain (never a guess); every mapping's family must be a live scoring family (test-pinned); the ladder's arbitration point for kNN conflicts is `imprintStands` — the prior stands only when the audio has no contradicting consensus (issue #128)             |
| I1  | **kNN inference**       | `megadj genre`                                 | embedding cosine k-NN family vote                                                                                                                                                          | statistical, not a claim                                                       | EMPTY columns only (COALESCE); never clobbers W1–W7                                                                                                                                                                                                                                                                                   |

Three facts people get wrong, corrected:

1. **W1 minted `Music` — FIXED Sep 15 (#61 stop-new-damage half).** The
   `?? "Music"` fallback is gone from `metadata-build.ts` and
   `getdat/commands/ingest.ts`: an unknown genre now stays null (an
   honest gap `fetch` fills later), and a real raw genre the regex table
   can't match survives instead of being replaced by the placeholder.
   `organize` routes null through `sanitizeGenreFolder` → the single
   "Unknown Genre" bucket. The ~154 legacy `Music` rows: the unstrand
   pass SHIPPED (#61 closed Sep 15 — `genre --refold` detects them,
   `--apply` clears them; the live-DB apply pass is pending).
2. **Bandcamp IS a live ladder source (since Rev 4).** W2b: when SC and
   BP both leave genre/year/label unfilled, `megadj fetch` searches the
   Bandcamp catalog (`src/fulltags/sources/bandcamp.ts`, the official
   autocomplete API — yt-dlp's extractor is still broken), applies the
   SAME hard artist gate (band/artist must contain the query artist),
   then fetches the item page once and votes genre (artist tags),
   year (publish date), label (publisher), and art (og:image). Since
   Rev 5 those votes are cast through the weighted vote ladder (#173),
   not consumed by a first-win write.
3. **YouTube's category is "Music", not a genre.** yt-dlp gives every
   YT Music track the same `category: Music` — that is why W1's regex
   over title/artist/album exists, and why it so often ends in
   `?? "Music"`. The SC search (W2) exists precisely to fix that with a
   real claim.

## 3. Flow

The pipeline is nine stages. Write points (W) put labels IN; the
analysis stage (A) produces the vectors; hygiene passes (H) keep the
column canonical and honest; inference (I) fills gaps; the scoring read
path (R) is what every consumer runs; verification (V) is the standing
gate; transparency surfaces (T) let a human see what any track claims.

```
 yt-dlp download (getdat sync)                    [W1 — see §2]
   │  meta.genre from YT category / title regex — falls back to
   │  "Music" (the placeholder's birthplace; issue #61)
   ▼
 [W1] markDownloaded + updateGenre ────────────► tracks.genre (SSOT)
   │
   ▼
 megadj fetch  (fulltags fetch-pipeline → fetch-stages)
   │  the WEIGHTED VOTE LADDER (#173, since Rev 5 — first-win writes are
   │  gone). Every rung that fires casts a vote (genre + weight +
   │  provenance); the write gate stays tag-first, the election writes
   │  once:
   │  [W2] SC search hit → junk gate (numeric/"Music") → artist gate
   │        (scoreScHits) → vote
   │  [W3] Beatport store genre → artist gate (scoreBpHit) → vote
   │  [W2b] Bandcamp vote (search + artist-gated page fetch):
   │        genre (artist tag) / year (publish date) / label
   │        (publisher)
   │  [W7] imprint prior vote (cited label→family map, #128)
   │  [W4] AI classifier vote (OPT-IN, off by default, conf ≥ 0.7,
   │        closed AI_VOCAB vocabulary) — a missing genre stays an
   │        honest gap, never a guess
   │  ▶ stageGenreElection: highest total weight elects (ties break
   │    toward the harder gate); setFileTags FIRST, then the DB row
   │    (genre + genre_votes breakdown) — "why Techno?" is answerable
   │    from the row, and megadj genre-why replays the exact seam
   │    (#215: CLI genre-why / MCP archive_genre_why / HTTP
   │    /api/archive/genre-why / FullTags ⌗ Genre Why tab; a drifted
   │    row reports matches_db:false, CLI exit 1)
   ▼
 megadj mood  (fulltags analyzeMoods)
   │  essentia ONNX via uv python worker:
   │  [A1] mood heads (dance/aggressive/happy/electronic/party/
   │        valence/arousal) → mood table
   │  [A2] effnet 1280-d mean embedding (same probe run, no extra
   │        model cost) → embeddings ledger (upsert by video_id)
   ▼
 hygiene passes (idempotent, dry-first, each reassesses everything)
   │  [H1] megadj genre --refold  — REWRITE pass on the LABELED
   │        population (no embeddings needed): escape repair,
   │        multi-label split (specific outranks umbrella), casing
   │        collapse, junk refusal (URL/word-soup/insane/family-less
   │        → proposes NOTHING rather than a fake label)
   │  [H2] megadj genre --flag    — METADATA pass on the EMBEDDED
   │        population: LOO harness; label vs UNANIMOUS kNN consensus
   │        mismatch → genre_flag='disputed' (never rewritten),
   │        cleared when no longer disputed (self-healing)
   ▼
 inference (megadj genre, no --eval)
   │  [I1] seeds = embedded + labeled + NOT disputed
   │  [I2] queries = embedded + EMPTY genre only (COALESCE discipline:
   │        inference never clobbers a source label)
   │  [I3] inferGenre: cosine kNN (k=5), gate minAgreement 0.6,
   │        family-majority vote → --apply writes family label
   ▼
 scoring read path (every consumer, every surface)
   │  [R1] normalizeGenre: paren-stripping; music/unknown/fixme → null
   │  [R2] familyOf (genreFamily): 9 families (house/edm/techno/pop/bass/
   │        hiphop/groove/trance/mood) — the SSOT map in
   │        src/fulltags/genre/genre-vocab.ts; junk categories ("loop samples",
   │        "dj tools") abstain, never seed a family (#187)
   │  [R3] scoringFamily (refold): plain EDM/Dance/Electronic/Mainstage
   │        EDM ABSTAIN from scoring (parents, not genres); sub-genres
   │        and hard-EDM keep scoring
   ▼
 verification (megadj genre --eval …)
   │  [V1] leave-one-out over the duration-guarded population (90–480 s)
   │  [V2] SHIP GATE: gated agreement ≥65% (judges the refold arm when
   │        armed; exit 1 below target — scripts fail loudly)
   │  [V3] --diagnostics: label-error clustering, artist-overlap,
   │        hubness histogram, confusion matrix + top-2
   │  [V4] --artist-disjoint LOO · --probe (linear probe, informational:
   │        lost to kNN twice) · --refold A/B block
   ▼
 surfaces (one engine, three faces)
   CLI megadj genre · MCP archive_* tools · web (Set genre columns,
   SimilarTab family coherence) — census strings test-pinned.
 ▼
 transparency surfaces (the tag census / compare, Sep 15)
   [T1] tag census: ONE SQL join per page — archive mirror (genre/key/
        beats-BPM/genre_flag) vs rb-adopt mirror (metadata_json), all
        playable tracks, worst-first sort, per-field disagreement
        counts. Files are NOT read here (3.5k ffprobe reads would be
        the cost of a page view).
   [T2] tag compare (one track, on demand): the file's OWN tags read
        LIVE (ground truth — one ffprobe+mutagen read is the honest
        price when you inspect a single track) beside both mirrors +
        the pipeline ledger (genre_flag, valence/arousal). Differences
        listed per field.
```

## 4. Invariants (the traps this architecture exists to avoid)

| #   | Invariant                                                                                                                                                                                                      | Enforced at                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Numeric SC genre IDs and the `Music` placeholder are never _propagated_ by fetch/enrich                                                                                                                        | `applyScGenre` junk gate (W2), enrich's weak-genre filter (W5), ingest's real-genre check (W6) |
| 1a  | ✅ FIXED Sep 15: W1 no longer mints `Music` — the `?? "Music"` fallback is gone (`metadata-build.ts`, `ingest.ts`); unknown stays null, real raw genres survive. The 154 legacy rows: unstrand SHIPPED (#61 closed, 0254c64 — `clearGenre()` seam; live-DB apply pending) | W1 fixed at source; unstrand via `genre --refold --apply`                                                       |
| 2   | Tag write FIRST, DB row only on success — the DB never claims a genre the file doesn't carry                                                                                                                   | W2/W3/W5                                                                                       |
| 3   | File TCON is output-only cache of the DB, never upstream (round-trip pollution measured) — W6 is the one sanctioned intake exception (there is no DB row yet; the file tag is the only claim available)        | readers (R1–R3)                                                                                |
| 4   | Inference fills EMPTY columns only; a source label is never clobbered                                                                                                                                          | `updateGenre` COALESCE (I2)                                                                    |
| 5   | AI genre fallback is opt-in and OFF by default                                                                                                                                                                 | W4 (`aiAllowed`)                                                                               |
| 6   | Umbrella labels (plain EDM/Dance/Electronic) abstain from scoring but keep displaying                                                                                                                          | `scoringFamily` (R3)                                                                           |
| 7   | Disputed labels are flagged, never rewritten; excluded from seeding only                                                                                                                                       | H2 + `genreSeeds`                                                                              |
| 8   | Refold proposes nothing rather than inventing a junk label                                                                                                                                                     | H1 guards                                                                                      |
| 9   | Every hygiene pass is idempotent (re-run → zero changes) and dry by default                                                                                                                                    | H1/H2                                                                                          |
| 10  | The eval gate judges the CURRENT policy readout (refold arm when armed), exit 1 below target                                                                                                                   | V2                                                                                             |
| 11  | BPM never enters the comment (own RB column); comment = `Key · Energy · Mood`                                                                                                                                  | booth-text                                                                                     |

## 5. Known residue (honest gaps, tracked)

- **154 `Music` placeholder rows**: visible to neither seeds (family
  null) nor inference queries (`genre != ''`) — stranded. The unstrand
  SHIPPED Sep 15 (#61 closed, 0254c64): `genre --refold` detects all 154
  (live receipt: `unstrand:154`, idempotent re-runs 0) and `--apply`
  clears them to NULL through `clearGenre()` so inference re-enrolls
  them as queries; W1 no longer mints new ones (fixed Sep 15). The
  operator `--apply` pass on the live DB is the remaining step — until
  it runs, the 154 rows still sit in the column (measured 2026-09-17;
  tracked on the roadmap rev 7.13 queue).
- **Orphaned `sc_genre_ids` cache — DROPPED 2026-09-15 (issue #108)**:
  the table existed in `archive.db` (269 resolved IDs, last resolved
  2026-09-12) but **no code in the repo read or wrote it** — the one-off
  scraper that built it was never committed (violates the
  no-one-off-scripts rule in hindsight). Verdict: DROP, not resolve —
  the label ladder (#61–#65) is served by the labels themselves, and a
  resolution command would have owned a cache with no remaining
  consumer. Dated backup:
  `~/.local/state/megadj/archive-db-before-sc-genre-ids-drop-2026-09-15.db`
  (+ `sc-genre-ids-dropped-rows-2026-09-15.csv`, 269 rows). The
  `src/sc-genre-ids-census.test.ts` census keeps it dead: any code
  reintroduction fails the suite. AGENTS.md's "orphaned data" trap is
  retired with this verdict.
- **The unmapped tail (~6.6% of labels)**: 63 unmapped labels covering
  265 rows; family coverage 93.0% (2026-09-17). The LLM residue pass
  (one-shot, vocabulary-constrained) is the queued fix — its first
  issue #65 closed Sep 16 WITHOUT the verb shipping; re-filed as
  [#237](https://github.com/webuildstuffio/megadj/issues/237).
- **`edm` 299 rows** display as-is (hard-EDM mixed with umbrella use);
  scoring abstains via R3 — the display split waits for
  cluster-proposed labels (§5b.3.5, #62).
- **240 distinct cohort labels** vs the 105-label 90%-coverage target —
  the refold killed case-twins; alias depth is the remaining gap
  (#155).
- **Disputed rows now have a review door (SHIPPED 2026-09-16, #64):**
  `megadj genre --disputes` lists every flagged row with LIVE evidence
  (recomputed consensus + agreement + embed age), and `--agree <id>`
  (audio wins: label := consensus family, flag cleared, row re-enters
  seeding) / `--keep <id>` (source wins: flag cleared, label untouched)
  resolve one row at a time through `setGenreFlag`/`agreeDispute` only —
  never bulk. `--note "…"` appends an audit trail (flag becomes
  `resolved:<note>`).

## 6. Live state (measured 2026-09-17 22:55 + 23:20 eval rerun, `~/.local/state/megadj/archive.db`)

| Metric                     | Value                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Ledger rows                | 5,921 (decomposed: 3,664 downloaded · 1,100 pending · 602 skipped-not-music · 464 deleted · 90 gone) — ledger ≠ library size   |
| Downloaded cohort          | 3,664 tracks; 3,458 labeled (94.4%)                                                                                            |
| Embedded (effnet 1280-d)   | 3,618 (98.8% of the cohort)                                                                                                    |
| Disputed flags             | 92 live (96 at the Sep 15 flag pass; 4 resolved through the #64 review verbs — review re-computes the live count on every run) |
| Distinct raw labels        | 240 (cohort)                                                                                                                   |
| Top labels                 | House 833 · Techno 337 · EDM 299 · Tech House 221 · Dance 156 · Music 154 · Pop 131                                            |
| LOO baseline / arbitration | 61.9% / **69.3%** (re-measured 2026-09-17: `genre --eval --refold --json`, n=2,982; ship gate ≥65% PASS)                        |
| top-2 accuracy             | 77.6% (2026-09-17 diagnostics rerun; label noise still RANDOM, no artist leakage, hub tail unchanged)                          |
| Family coverage            | 93.0% (3,533/3,798 labeled rows ledger-wide; 63 unmapped labels covering 265 rows — the #65-class tail, [#237](https://github.com/webuildstuffio/megadj/issues/237)) |
| `genre_votes` breakdowns   | 0 rows — the ladder shipped Sep 16 21:00, the last fetch ran Sep 16 07:20; breakdowns populate on the next real fetch run       |

## 7. Where everything lives

| Concern                                                                                                                                            | File                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Family map + kNN vote + LOO harness + embeddings ledger                                                                                            | `src/archive/similar.ts`                                                                                                                                                          |
| Seeding exclusion + flag setter + labeled population                                                                                               | `src/archive/state_tracks.ts`                                                                                                                                                     |
| Refold engine (canonicalization + arbitration)                                                                                                     | `src/fulltags/genre/genre-refold.ts`                                                                                                                                                    |
| Dispute classifier                                                                                                                                 | `src/fulltags/genre/genre-flag.ts`                                                                                                                                                      |
| Dispute review surface (collect + agree/keep verbs, #64)                                                                                           | `src/fulltags/genre/genre-disputes.ts`                                                                                                                                                  |
| Imprint prior vote rung (W7, cited label→family map, #128)                                                                                         | `src/fulltags/sources/imprint-prior.ts`                                                                                                                                                   |
| Tier-0 diagnostics engine                                                                                                                          | `src/fulltags/genre/genre-diagnostics.ts`                                                                                                                                               |
| Linear probe (informational readout)                                                                                                               | `src/fulltags/analysis/linear-probe.ts`                                                                                                                                                    |
| CLI wiring (`--eval/--refold/--flag/--diagnostics/…`)                                                                                              | `src/fulltags/genre/genre.ts`                                                                                                                                                           |
| Fetch ladder + election write + junk gate + tag-first writes (#173/#215)                                                                           | `src/fulltags/fetch/fetch-pipeline.ts` + `src/fulltags/fetch/fetch-stages.ts` + `src/fulltags/archive-ledger.ts` (#184 — re-homed from tools/)                                                |
| Vote ladder weights + election + (de)serialization (#173)                                                                                          | `src/fulltags/genre/genre-vote.ts`                                                                                                                                                      |
| Explainability read — CLI `genre-why` (#215; MCP/UI ride the same `electGenre` replay)                                                             | `src/fulltags/genre/genre-why.ts`                                                                                                                                                       |
| Live-run event protocol (`fetch --json` stderr `@event` lines, #215)                                                                               | `src/fulltags/fetch/fetch-events.ts`                                                                                                                                                    |
| Run-tab server side: `fetch` job kind, feed ring, `/api/fetch/start` + `/api/fetch/feed` (#215)                                                    | `cratedeck/src/job_legs.ts` (`runFetchJob`) + `cratedeck/src/fetch_feed.ts` + `cratedeck/src/api_routes.ts` (`fetchRoutes`)                                                                   |
| Run-tab UI (the ladder deciding live: per-track votes, elections, tally)                                                                           | `cratedeck/web/products/fulltags/GenreRunTab.tsx`; rung display defs: `cratedeck/shared/genre-vote-rungs.ts` (census-pinned to `GENRE_VOTE_WEIGHTS`)                                            |
| Bandcamp arm (search + gated page fetch + genre/label/date/art)                                                                                    | `src/fulltags/sources/bandcamp.ts`                                                                                                                                                        |
| Name-matching SSOT (artist gate, title overlap, tokens)                                                                                            | `src/fulltags/sources/name-match.ts`                                                                                                                                                      |
| Intake vocabularies (`guessFromFreeText` regex, `SC_GENRE_CANON`, `AI_VOCAB`, `canonicalizeClaim`, family map `FAMILIES`/`familyOf`, umbrella set) | `src/fulltags/genre/genre-vocab.ts` (#187 — one module owns every named genre map; `canonGenre` remains a compat alias on `schema.ts`; the old exports.ts bridge was dissolved by #193) |
| YT metadata → tags (W1 — mint removed Sep 15; unknown stays null)                                                                                  | `src/fulltags/write/metadata-build.ts`                                                                                                                                                  |
| Ingest file-tag adoption (W6)                                                                                                                      | `src/getdat/commands/ingest.ts`                                                                                                                                                   |
| MusicBrainz folksonomy harvest (W5)                                                                                                                | `src/fulltags/sources/mb.ts` + `src/fulltags/fetch/enrich.ts`                                                                                                                                   |
| Beatport lookup + store genre (W3)                                                                                                                 | `src/fulltags/sources/beatport.ts` (`bpGenre`)                                                                                                                                            |
| SC search + genre write helper (W2)                                                                                                                | `src/fulltags/sources/art-sources.ts` (`scSearch`)                                                                                                                                        |
| AI classifier (W4)                                                                                                                                 | `src/fulltags/analysis/ai.ts`                                                                                                                                                              |
| Embedding producer (effnet via ONNX worker)                                                                                                        | `src/fulltags/analysis/models.ts` (`analyzeMoods`)                                                                                                                                         |
| File ground-truth reader (TCON/TKEY/TBPM/… + art)                                                                                                  | `src/fulltags/write/readers.ts` (`groundTruth`)                                                                                                                                         |
| Tag census + three-source compare (T1/T2)                                                                                                          | `cratedeck/src/archive_tagcensus.ts`                                                                                                                                              |
| Wire types (census/compare payloads)                                                                                                               | `cratedeck/shared/archive-wire.ts`                                                                                                                                                |

## 8. Design rationale — why the seams are where they are

- **Why the fetch ladder votes instead of first-win-writes (Rev 5):**
  SC free-text, Beatport store tags, Bandcamp artist tags, the AI
  fallback, MusicBrainz, the file's own TCON, sync-time category, and
  the imprint prior each answer "what does this source claim" — and
  since #173 every claim is a VOTE (`src/fulltags/genre/genre-vote.ts`,
  weights versioned in `GENRE_VOTE_WEIGHTS` per the doc's W-table).
  The highest total weight elects; ties break toward the harder single
  gate (deterministic); the full breakdown persists in
  `tracks.genre_votes`, so "why Techno?" is answerable from the row.
  Hard gates stay absolute upstream — a vote only exists for a claim
  that already passed its rung's gates. Migration of existing rows is
  a pipeline re-run, never a hand UPDATE.
- **Why file reads live only on the per-track compare (T2), not the
  census (T1):** the file is ground truth, but a census page over 3.5k
  tracks would pay a ffprobe+mutagen spawn per row — seconds of I/O
  for a table the user scans. The census compares the two mirrors
  (cheap SQL); the compare endpoint pays the read for exactly one
  track you're inspecting. Honesty where it's cheap, truth where it's
  asked for.
- **Why the flag pass never rewrites:** a rewritten label destroys the
  evidence of why it was flagged. The flag does the harm-reduction
  work (seeding exclusion) with zero information loss; the rewrite
  stays a human act (#64 adds the verbs).
- **Why umbrella abstention lives in a scoring wrapper (`scoringFamily`)
  instead of editing `genreFamily`:** display and scoring are different
  questions. The map stays one SSOT; the arbitration is a policy layer
  you can A/B (`--eval --refold`) — and revert — without touching the
  family table.
- **Why inference fills only empty columns:** a genre from SC/Beatport
  is a _source claim_ with provenance; a kNN family is a _statistical
  guess_. COALESCE at the write seam (plus the queries-side filter)
  means the two can never overwrite each other, and re-running
  inference is always safe.
