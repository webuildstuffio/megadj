# Genre System — Consolidated Reference

**Status:** 📚 REFERENCE — the single source of truth for how genres work
in megadj. Updated 2026-10-01.

**Supersedes:** [genre-audit](../archive/genre-audit-2026-09-14.md),
[genre-pipeline](../archive/genre-pipeline-2026-09-16.md),
[genre-taxonomy-sources](../archive/genre-taxonomy-sources-2026-09-14.md)
(all archived with dates).

**v3 redesign:** this doc describes the **current (v2) system**. The v3
proposal (Dawid–Skene label model, independent answer keys, `genre_evidence`
table) lives in
[fulltags-v3-landscape](fulltags-v3-landscape-and-redesign-2026-09-28.md)
and
[fulltags-v3-rebench-plan](fulltags-v3-rebench-and-build-plan-2026-09-29.md).

---



## 1. One-paragraph summary

A track's genre enters `archive.db` from real external sources via a
10-rung weighted vote ladder. Each rung that fires casts a vote
(genre + weight + provenance); the highest total weight elects the
winner. The raw label is canonicalized by a mechanical refold pass
(casing, escape repair, multi-label split). Nine scoring families
(house / techno / bass / trance / hiphop / edm / pop / mood / latin)
collapse specific labels for math; umbrella labels ("EDM", "Dance",
"Electronic") abstain from scoring. Disputed labels are flagged but
never rewritten. Inference fills only empty columns. A leave-one-out
harness with a hard **≥65% ship gate** guards the whole pipeline. The
file tag (TCON) is output-only — the DB row is the SSOT.

---



## 2. Architecture — the 10-rung vote ladder

Every rung has a fixed weight reflecting its reliability. Votes are
grouped by genre label; the genre with the highest total weight wins.
Ties break toward the higher single-rung weight (harder gate wins).
The full breakdown persists in `tracks.genre_votes` (JSON), so any
stored genre is explainable via `megadj genre-why`.


| #   | Rung      | Source                              | Weight | Trust                                 | Gate                                                  |
| --- | --------- | ----------------------------------- | ------ | ------------------------------------- | ----------------------------------------------------- |
| W3  | `bp`      | Beatport store genre                | 0.60   | Curated commercial taxonomy (highest) | Artist gate (`scoreBpHit`)                            |
| W6  | `file`    | File TCON tag                       | 0.55   | Pool rips (Bandcamp/Hypeddit quality) | `Music`/numeric refuse                                |
| W9  | `discogs` | Discogs CC0 dump (offline SQLite)   | 0.55   | Curated styles ≈ effnet taxonomy      | NFC-casefolded artist+title match                     |
| W2b | `bc`      | Bandcamp artist tags                | 0.50   | Artist/label-entered, junk rare       | Hard artist gate + page fetch                         |
| W4  | `ai`      | AI classifier (OpenRouter)          | 0.45   | Closed `AI_VOCAB`, conf ≥ 0.7         | Opt-in, off by default                                |
| W5  | `mb`      | MusicBrainz folksonomy (recording)  | 0.40   | Community-curated                     | Recording-level tags, artist fallback                 |
| W2  | `sc`      | SoundCloud artist free-text         | 0.35   | Low (free-text; junk-gated)           | Hard artist gate + numeric/"Music" refuse             |
| W8  | `lastfm`  | Last.fm folksonomy (`getTopTags`)   | 0.30   | Community folksonomy, count-gated     | `LASTFM_API_KEY` env, tag count ≥ 25, 4 rps limit    |
| W1  | `sync`    | Download-time regex                 | 0.20   | Lowest (category, not genre)          | Unknown stays null (no `Music` mint)                  |
| W7  | `imprint` | Label/imprint prior                 | 0.15   | Metadata, not audio truth             | Fires only when SC+BP miss; abstains on unknown label |


**Weight ordering invariants** (test-pinned in `genre-vote.test.ts`):

- Catalog taxonomy > artist pages > free-text > file tags > category > imprint
- The imprint prior can never outvote two agreeing catalog rungs

**Election mechanics:**

1. Each rung that fires casts `{rung, genre, weight, detail}`.
2. Votes group by canonical genre label; total weight = sum of rungs.
3. Highest total wins. On a tie: the genre whose best single rung has
  the higher weight wins (harder gate beats two weak agreeing votes).
4. Alphabetical tiebreak as the final deterministic fallback.
5. `electGenre()` in `src/fulltags/genre/genre-vote.ts` is the one seam.
6. Tag write FIRST, DB row only on success — the DB never claims a
  genre the file doesn't carry.

**Imprint prior special rules:** the imprint rung votes a FAMILY, not a
specific genre label. `familyOnly = true` when imprint is the only
voter — the genre column stores the family name as an honest
low-resolution label. One real genre vote from any other rung overwrites
the imprint family (never the reverse).

---



## 3. Refold — label canonicalization

`megadj genre --refold` (engine: `src/fulltags/genre/genre-refold.ts`).
Idempotent, dry by default, reassesses every row on each run.

**What it does:**

1. Repairs `\uXXXX` escape artifacts (19+ rows measured)
2. Strips parenthetical qualifiers: "Techno (Peak Time / Driving)" → "Techno"
3. Protects established `&`-compounds ("Drum & Bass", "R&B",
  "Melodic House & Techno", "Hip-Hop & Rap") before splitting
4. Splits multi-label strings on `/ , &` into ranked tokens
5. Ranks specific labels over umbrella parents: "Electronic/House" → House wins
6. Applies casing/spelling canonicalization via an irregular table
  (e.g. `hiphop` → `Hip-Hop`, `edm` → `EDM`) + title-case fallback
7. Refuses junk: URL spam, word soup (≥5 words), character-insane
  strings, and labels with no genre-family mapping

**What it does NOT do:** invent labels. A junk input returns `null`
(no proposal) — the column stays unchanged. Labels are never broadened
at refold time (`deep house` stays `deep house`, never becomes `house`).

**Result:** 459 pre-refold → **73 distinct labels** post-refold (Sep 30).
Zero case-twins remain.

---



## 4. The 9-family scoring map

Every consumer that needs genre for math reads through `familyOf()`
in `src/fulltags/genre/genre-vocab.ts`. The map is regex-based,
order-matters (bass checked before house), and mutually exclusive.


| Family     | Regex pattern (simplified)                                                        | Example labels                                   |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| **bass**   | drum & bass, jungle, breakbeat, bass, dubstep, footwork, grime, jersey club, donk | Drum & Bass, Dubstep, Bass House                 |
| **house**  | house, disco, garage, boogie (excluding bass house, afro house)                   | House, Deep House, Tech House, Progressive House |
| **techno** | techno, melodic, minimal, deep tech, hardtekk                                     | Techno, Minimal, Hardtekk                        |
| **trance** | trance, psy                                                                       | Trance, Psytrance                                |
| **hiphop** | hip-hop, rap, trap                                                                | Hip-Hop, Trap, Hip-Hop & Rap                     |
| **edm**    | edm, electro, big room, hardstyle, bounce, eurodance, nightcore                   | EDM, Hardstyle, Eurodance                        |
| **pop**    | pop, rock, indie, alternative, punk, metal, folk, country                         | Pop, Rock, Indie                                 |
| **mood**   | ambient, downtempo, chill, lounge, new age, idm, synthwave                        | Ambient, Downtempo, Chillwave                    |
| **latin**  | latin, reggaeton, salsa, cumbia, dembow                                           | Latin, Reggaeton                                 |


**Junk claims** (`JUNK_CLAIMS` regex): "loop samples", "dj tools" —
these map to NO family and never vote.

**Why 9?** Measured against the Discogs-400 classification head and kNN
clustering — these 9 are exactly the clusters the embedding space
separates. Fewer (house+techno → "club") erases the sharpest boundary;
more (>12) fragments vote pools without cluster support.

---



## 5. Umbrella abstention

Labels that name only a parent genre — **"EDM", "Dance", "Electronic",
"Mainstage EDM"** — are real vocabulary (they stay in the column for
display) but carry no child-family evidence.

`scoringFamily()` in `genre-refold.ts` wraps `familyOf()` and returns
`null` for umbrella labels. Effect: these rows abstain from the LOO
evaluation and from seeding the kNN vote pool. Hard-EDM sub-genres
(hardtekk, eurodance, nightcore, big room) keep their `edm` family
unchanged — only the four bare umbrella labels abstain.

**Result of shipping umbrella abstention (Sep 15):** LOO gated
61.7% → **69.2%** (+7.4 pts) — the single largest accuracy gain,
from a policy fix, not a data fix.

---



## 6. Dispute flagging

`megadj genre --flag` (engine: `src/fulltags/genre/genre-flag.ts`).
Idempotent, dry by default, reassesses every embedded labeled row.

**Evidence bar:** unanimity — the kNN consensus (k=5, gated ≥0.6)
must UNANIMOUSLY disagree with the stored label's family (agreement
= 1.0 and family mismatch). Split votes and refusals touch nothing.

**What happens:**

- Disputed: `tracks.genre_flag = 'disputed'` — label stays for
display, row excluded from seeding (the actual harm reduction)
- No longer disputed: flag cleared automatically (self-healing)
- Labels are **never rewritten** — a human resolves via
`genre --agree <id>` (audio wins) / `genre --keep <id>` (source wins)

**Census (Sep 30):** ~92 disputed of ~3,192 assessed (2.9%).
Top blocks: EDM→house, Electronic→house, Techno→house, Pop→house/bass.

---



## 7. Inference for the unlabeled

`megadj genre` (no `--eval`). Engine: `src/core/similar.ts`.

- **Seeds:** embedded + labeled + NOT disputed
- **Queries:** embedded + EMPTY genre only (COALESCE discipline:
inference never clobbers a source label)
- **Method:** cosine kNN (k=5), gate `minAgreement ≥ 0.6`, family-majority
vote → writes the family label on `--apply`
- **The 0.6 gate** trades 19.8% refusal for +5.1 pts accuracy — refused
tracks stay honest gaps, not guesses

---



## 8. Three tiers of genre depth


| Tier                        | Purpose                                                 | Source                                                      | Cardinality            | Mutable                                              |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| **Tier 1 — display label**  | What humans see in RB, UI, file tags                    | Canonical post-refold label from the vote ladder            | 73 distinct (Sep 30)   | Yes (refold + new sources grow it)                   |
| **Tier 2 — scoring family** | What math consumes (diversity guard, pool filters, kNN) | `familyOf()` regex map                                      | **9 families (FIXED)** | No (9 is structurally right for the embedding space) |
| **Tier 3 — Discogs styles** | Fine-grained "how specific is this track"               | Discogs-400 classification head on cached effnet embeddings | Up to 400              | No (bounded by Discogs taxonomy)                     |


**Primary vs secondary genres:**

- `tracks.genre` — the vote-winner (Tier 1), synced to RB via `rb-comment-sync`
- `tracks.genre_secondary` — runner-up votes + embedding kNN (~60% coverage)
- `tracks.genre_votes` — the full vote breakdown (JSON, every rung's claim)
- RB gets the primary only; secondary stays archive-only

---



## 9. Eval harness — the ship gate

`megadj genre --eval` (engine: `src/core/similar.ts`).

**Method:** leave-one-out over the duration-guarded population (90–480 s),
k=5, full-population exact LOO, bootstrap 95% CIs.


| Metric                                     | Value (Sep 20)                      |
| ------------------------------------------ | ----------------------------------- |
| LOO baseline (ungated)                     | 57.0%                               |
| LOO arbitration (with umbrella abstention) | **66.6%** — ship gate ≥65% **PASS** |
| Refusal rate                               | 27.9%                               |
| Top-2 accuracy                             | 77.6%                               |
| Duration-guard effect                      | Neutral (−0.2 pt)                   |


**Ship gate:** `--eval` exits 0 when gated agreement ≥65%, exit 1 below.
The gate judges the refold/arbitration arm when armed. Scripts fail loudly.

**Extended diagnostics** (`--diagnostics --artist-disjoint --probe`):

- Label noise: **RANDOM** (top-10 artist share 8.4%)
- Artist leakage: **nil** (4.2% same-artist top-5; disjoint Δ −0.8)
- Hub tail: confirmed (408/2,643 tracks in ≥10 neighbor lists)
- Linear probe: 51.5% (Δ −11.1 vs kNN — kNN stays production)

---



## 10. Authoritative external sources


| Source                  | Scope                                          | Role                                                                      |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| **Beatport**            | DJ/electronic sales (36 genres + subgenres)    | Primary anchor for electronic labels (W3, 0.60)                          |
| **Discogs**             | All physical releases (15 genres → 400 styles) | Offline SQLite cache, curated styles (W9, 0.55)                          |
| **Bandcamp**            | Artist-entered tags + JSON-LD                  | High-signal artist tags (W2b, 0.50)                                      |
| **MusicBrainz**         | Community folksonomy tags                      | Recording-level + artist fallback (W5, 0.40)                             |
| **Last.fm**             | Folksonomy tags with counts                    | Track-level tags, count ≥ 25 gate (W8, 0.30)                            |
| **SoundCloud**          | Free-text genre field + hashtags               | Artist-gated vote (W2, 0.35)                                            |
| **Every Noise at Once** | ~6,291 micro-genres (frozen Feb 2024)          | Lookup for niche scene names; not maintained                              |


**The Discogs-400 head** (2 MB TF graph, 1 ms/track on cached embeddings):
predicts all 400 Discogs styles from the existing effnet 1280-d embeddings.
Measured: 46.1% top-1, ~69% top-3, ~77% top-5 family agreement. kNN
beats it conclusively (McNemar p=2×10⁻³⁰), but Jaccard 0.49 overlap makes
them complementary — the head provides ranked secondary genres for free.

---



## 11. Source trust ranking (measured)

Audio-consistency = LOO family agreement, duration-guarded, 95% CIs.


| Rank | Source                      | Consistency                           | Role                                            |
| ---- | --------------------------- | ------------------------------------- | ----------------------------------------------- |
| 1    | **Embedding kNN consensus** | the reference, not a claim            | Tie-breaker + inference + dispute flagging      |
| 2    | **Rekordbox mirror**        | 58.4% CI [56.4, 60.2]                 | Bulk coverage; primary display                  |
| 3    | **Ingest pool tags**        | 53.1% CI [48.6, 58.0]                 | Richer specificity for display                  |
| 4    | **MusicBrainz**             | not measurable (gap-filler)           | Artist-tag harvest                              |
| 5    | **Beatport store**          | not measurable (fires when SC misses) | Curated taxonomy votes                          |
| 5b   | **Bandcamp tags**           | not measurable (fires 3rd)            | Artist-entered, junk rare                       |
| 6    | **SoundCloud free-text**    | lowest by construction                | Feeds alias table only                          |
| 7    | **YouTube category/regex**  | worst (category ≠ genre)              | Bootstraps the row; everything else upgrades it |
| —    | **File TCON tags**          | OUTPUT-ONLY                           | Round-trip pollution measured; never upstream   |


---



## 12. Live state (measured 2026-09-30)


| Metric                   | Value                                             |
| ------------------------ | ------------------------------------------------- |
| Downloaded tracks        | 4,566                                             |
| Has primary genre        | 4,487 (98.3%)                                     |
| Has secondary genre      | 2,744 (60.1%)                                     |
| Has genre vote breakdown | 4,360 (95.5%)                                     |
| Has energy               | 4,468 (97.9%)                                     |
| Distinct display labels  | 73                                                |
| Disputed flags           | ~92                                               |
| Family coverage          | ~93% (63 unmapped labels / 265 rows)              |
| RB genre coverage        | 3,799/3,799 (100%) — synced via `rb-comment-sync` |


**Genre distribution (top 15, archive.db downloaded):**


| Genre             | Count |
| ----------------- | ----- |
| House             | 831   |
| EDM               | 812   |
| Techno            | 580   |
| Hip-Hop           | 418   |
| Tech House        | 372   |
| Pop               | 265   |
| Progressive House | 163   |
| Deep House        | 147   |
| Rock              | 94    |
| Trance            | 84    |
| Afro House        | 82    |
| R&B               | 79    |
| Electronic        | 77    |
| Dance             | 73    |
| Bass House        | 49    |


---



## 13. Invariants


| #   | Rule                                                                     | Enforcement                                                                 |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | Numeric SC genre IDs and `Music` placeholder are never propagated        | `applyScGenre` junk gate, enrich weak-genre filter, ingest real-genre check |
| 2   | Tag write FIRST, DB row only on success                                  | W2/W3/W5                                                                    |
| 3   | File TCON is output-only (never upstream)                                | All readers (R1–R3)                                                         |
| 4   | Inference fills EMPTY columns only; never clobbers source labels         | `updateGenre` COALESCE                                                      |
| 5   | AI genre fallback is opt-in, OFF by default                              | W4 `aiAllowed`                                                              |
| 6   | Umbrella labels abstain from scoring but display normally                | `scoringFamily`                                                             |
| 7   | Disputed labels are flagged, never rewritten; excluded from seeding only | H2 + `genreSeeds`                                                           |
| 8   | Refold proposes nothing rather than inventing a junk label               | H1 guards                                                                   |
| 9   | Every hygiene pass is idempotent and dry by default                      | H1/H2                                                                       |
| 10  | The eval gate judges the CURRENT policy readout, exit 1 below target     | V2                                                                          |
| 11  | BPM never enters the comment (own RB column)                             | booth-text                                                                  |


---



## 14. Module map


| Concern                                                   | File                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Vote weights + election + serialize                       | `src/fulltags/genre/genre-vote.ts`                         |
| Refold engine (canonicalize + arbitrate)                  | `src/fulltags/genre/genre-refold.ts`                       |
| Genre vocabulary (families, umbrella, junk, canon, guess) | `src/fulltags/genre/genre-vocab.ts`                        |
| Dispute classifier                                        | `src/fulltags/genre/genre-flag.ts`                         |
| Dispute review (collect + agree/keep)                     | `src/fulltags/genre/genre-disputes.ts`                     |
| Explainability (`genre-why`)                              | `src/fulltags/genre/genre-why.ts`                          |
| Eval harness + LOO + diagnostics                          | `src/core/similar.ts`                                      |
| Tier-0 diagnostics engine                                 | `src/fulltags/genre/genre-diagnostics.ts`                  |
| CLI wiring (`--eval/--refold/--flag/…`)                   | `src/fulltags/genre/genre-run.ts`                              |
| Fetch ladder + election write                             | `src/fulltags/fetch/fetch-pipeline.ts` + `fetch-stages.ts` |
| Imprint prior rung (W7)                                   | `src/fulltags/sources/imprint-prior.ts`                    |
| SoundCloud search (W2)                                    | `src/fulltags/sources/art-sources.ts`                      |
| Beatport lookup (W3)                                      | `src/fulltags/sources/beatport.ts`                         |
| Bandcamp arm (W2b)                                        | `src/fulltags/sources/bandcamp.ts`                         |
| MusicBrainz harvest (W5, recording-level)                 | `src/fulltags/sources/mb-lookup.ts`                        |
| Last.fm folksonomy (W8)                                   | `src/fulltags/sources/lastfm.ts`                           |
| Discogs vote (W9, offline SQLite)                         | `src/fulltags/sources/discogs-vote.ts`                     |
| Discogs CC0 dump ingester                                 | `src/fulltags/sources/discogs-ingest.ts`                   |
| AI classifier (W4)                                        | `src/fulltags/analysis/ai.ts`                              |
| Remix routing (artist-level sources → remixer)            | `src/fulltags/identity/remix-route.ts`                     |
| Evidence bridge (votes → `genre_evidence` for D-S)        | `src/fulltags/evidence/vote-evidence-bridge.ts`            |
| Dawid-Skene estimator (flag-gated)                        | `src/fulltags/genre/estimator.ts`                          |
| SC tag sanitizer (built, unwired)                         | `src/fulltags/sources/sc-tag-sanitizer.ts`                 |
| Name-matching SSOT (artist gate)                          | `src/fulltags/sources/name-match.ts`                       |
| Ingest file-tag adoption (W6)                             | `src/getdat/commands/ingest.ts`                            |
| YT metadata → tags (W1)                                   | `src/fulltags/write/metadata-build.ts`                     |
| Seeding exclusion + labeled population                    | `src/core/state-tracks.ts`                                 |
| Tag census + three-source compare                         | `src/deck/hygiene/tag-census.ts`                           |
| Run-tab UI (live vote visualization)                      | `src/deck/web/products/fulltags/GenreRunTab.tsx`           |
| Rung display defs (census-pinned)                         | `src/deck/shared/genre-vote-rungs.ts`                      |


---



## 15. Pipeline flow (condensed)

```
download (megadj sync)
  └→ [W1] YT category/regex → tracks.genre (null if unknown)

fetch (megadj fetch)
  └→ [W2] SC search → artist gate → vote (remix: routes to remixer)
  └→ [W3] Beatport → artist gate → vote
  └→ [W2b] Bandcamp → artist gate → vote genre/year/label/art
  └→ [W9] Discogs → offline SQLite lookup → NFC-casefolded vote
  └→ [W5] MusicBrainz → recording-level tags → artist fallback vote
  └→ [W8] Last.fm → track.getTopTags → count ≥ 25 → vote
  └→ [W7] Imprint prior → weak family vote
  └→ [W4] AI classifier → vote (opt-in, off by default)
  └→ evidence bridge: votes → genre_evidence rows (for D-S estimator)
  └→ stageGenreElection: highest weight wins → tag FIRST, then DB

ingest (megadj ingest)
  └→ [W6] File TCON → real-genre check → adopts if genuine

mood (megadj mood)
  └→ ONNX mood heads + effnet 1280-d embedding

hygiene (idempotent, dry-first)
  └→ [H1] genre --refold  — label canonicalization
  └→ [H2] genre --flag    — dispute metadata

inference (megadj genre, no --eval)
  └→ [I1] kNN k=5, gate ≥0.6 → fills EMPTY columns only

verification
  └→ genre --eval: LOO harness, ship gate ≥65%

surfaces
  └→ CLI genre-why / MCP archive_genre_why / HTTP /api/archive/genre-why
  └→ CrateDeck Genre Why tab (weight bars + drift callout)
```

---



## 16. v3 forward pointers

The current system (v2 + Oct 1 genre-source expansion) is documented above.
The Oct 1 session shipped several v3 building blocks into the v2 pipeline:

**Shipped (Oct 1):**

- ✅ **Discogs CC0 dump** as W9 vote rung (offline SQLite cache)
- ✅ **Last.fm folksonomy** as W8 vote rung (tag count ≥ 25 gate)
- ✅ **MusicBrainz recording-level** deepening (was artist-only)
- ✅ **Remix routing** — artist-level sources query the remixer
- ✅ **Evidence bridge** — votes → `genre_evidence` table per fetch run
- ✅ **Dawid–Skene estimator** — built, flag-gated (`MEGADJ_GENRE_ESTIMATOR=1`)
- ✅ **SC tag sanitizer** — built (unwired; needs per-track metadata fetch)

**Remaining v3 work:**

- **Dawid–Skene live switchover** — estimator built, needs pilot cohort
  comparison before replacing the fixed W-table
- **Independent answer keys** (verified-store silver, agent silver,
  ear-check binary disputes) replacing self-referential LOO
- **SC per-track tags** — sanitizer built, needs `--print-json` fetch arm
- **1001Tracklists co-play graph** — genuinely new signal for MegaSet transitions
- **Rekordbox play history mining** — `djmdHistory` transitions as evidence

See [v3 landscape](fulltags-v3-landscape-and-redesign-2026-09-28.md) §4
and [v3 build plan](fulltags-v3-rebench-and-build-plan-2026-09-29.md)
WS4–WS5.