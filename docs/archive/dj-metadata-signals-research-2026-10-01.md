# DJ Metadata Signals — Research Report (Analyzed)

**Status:** 📚 ARCHIVED — research snapshot with inline analysis against the
real megadj system (Oct 1 2026). Roadmap-actionable items extracted to §14.

**Origin:** external research report on DJ metadata signals, how DJs organize
music, and which external sources can feed the FullTags / MegaSet pipeline.
Written Oct 1 2026 against a ~3,800 track house/techno/EDM library on
rekordbox + XDJ-XZ.

**Analysis verdict:** ~60% of what this report proposes is already shipped
in megadj (the vote ladder, most external sources, entity resolution, audio
models). The remaining 40% contains 3–4 genuinely high-value ideas worth
tracking: the 1001Tracklists co-play graph, Last.fm as a new vote rung,
the Discogs monthly dump (already proposed in v3), and the Dawid–Skene
label model (already the v3 plan of record). The "what DJs do" taxonomy
is useful reference material for booth/comment/set design.

---



## 1. TL;DR (original claims → system-grounded verdicts)


| #   | Original claim                                                          | Verdict against shipped system                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "Mine rekordbox playlists, history, cues first"                         | **Partly done.** Cues are ledgered (22 avg/track), energy uses analysis data, play history is in master.db but NOT YET mined as a signal for MegaSet transitions or genre evidence. Playlist-name-as-voter is not wired.                                                                   |
| 2   | "DJ co-play graph from 1001Tracklists is highest-value external signal" | **Genuinely new.** Not in the codebase, not in any issue. The social-embedding idea (node2vec over co-play edges) is architecturally sound and would give MegaSet a transition signal that audio embeddings fundamentally cannot provide. Worth a GitHub issue.                            |
| 3   | "Discogs + Beatport best labelers, Last.fm + MB as supporting"          | **Mostly shipped.** Beatport (W3, weight 0.60), Bandcamp (W2b, 0.50), MusicBrainz (W5, 0.40), SoundCloud (W2, 0.35) are all live rungs. Discogs is NOT a current rung — the Discogs monthly dump is proposed in v3 (§4 of the landscape doc). Last.fm is not wired at all — genuinely new. |
| 4   | "Use Dawid–Skene instead of hand-labeled gold"                          | **Already the v3 plan of record.** The v3 landscape doc (Sep 28) proposes exactly this: `crowd-kit` Dawid–Skene over family-level evidence, replacing the fixed W-table. See `fulltags-v3-landscape-and-redesign-2026-09-28.md` §4.                                                        |
| 5   | "SoundCloud/Bandcamp/LLM are second-wave"                               | **Outdated.** SoundCloud is a first-class download AND genre source (shipped Sep 19, W2 rung). Bandcamp is live as W2b (shipped Sep 15). LLM genre (W4 AI rung) is opt-in, off by default. These are not second-wave — they are production.                                                |
| 6   | "Spotify is out"                                                        | **Correct and irrelevant.** Audio features API removed Nov 2024. megadj has never used Spotify.                                                                                                                                                                                            |


---



## 2. What DJs actually do — reference taxonomy

This section has genuine reference value for booth comment design and the
Set builder's UX language. Cross-referenced with megadj's v4 comment format:


| DJ axis                      | v4 comment coverage                        | Status                                                |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Genre / sub-genre            | `· MelTechno+DeepHouse` (after `·`)        | ✅ Shipped — 64.4% have subgenre                       |
| BPM                          | Omitted from comment (own RB column)       | ✅ Correct by design (invariant #11)                   |
| Key                          | Omitted from comment (own RB column)       | ✅ Correct by design                                   |
| Energy / set role            | `E1–E9` percentile-ranked                  | ✅ Shipped — 100% coverage                             |
| Vibe / crowd feel            | `Hard/Soft` + `Dark/Euph`                  | ✅ Shipped — mood-derived, ~40% coverage               |
| Vocal status                 | `VOX/HOOK`                                 | ❌ **Last remaining v4 token** — needs Demucs pipeline |
| Function (tool/filler)       | Not represented                            | ❌ Not planned — structural detection needed           |
| Era                          | Not in comment; release year in archive.db | Partial — 60–85% year coverage                        |
| Gig context                  | Not in comment                             | N/A — personal, not computable                        |
| Track colour                 | Energy band → ColorID                      | ✅ Shipped — 100% coverage                             |
| Mix notes (intro/outro bars) | `IN:32 OUT:16`                             | ✅ Shipped — 74.7% coverage from PSSI                  |
| Drop/Roll                    | `Drop` or `Roll`                           | ✅ Shipped — 97.5%/2.5% of IN/OUT tracks               |


**Key insight from the DJ practice survey:** energy is the most common
custom axis across DJ education sources. The v4 comment's E1–E9 is the
right design choice. However, the v3 landscape doc (Sep 28) correctly
identifies that energy is currently a loudness meter (library average 8.5
on 1–10, average arousal 4.92) — the recalibration proposed there is more
important than adding new signals.

### Cue points as structured data

The report correctly notes that cue points are information-dense personal
annotations encoding *where* things happen. megadj already leverages this:

- **PSSI phrase analysis** provides intro/buildup/drop/breakdown/outro
structure → drives `IN:32 OUT:16` and `Drop/Roll` in v4 comments
- **Hot/memory cues** are in master.db (3,650 tracks × ~22 cues avg)
- **EDM-98 dataset** (cited in the v3 landscape doc §2.4) provides gold
labels built FROM rekordbox cue points — the right bootstrap for
structure detection

What's NOT yet mined: using cue COLOR and NAMING conventions as evidence.
The DJ practice sources describe systems like green=first kick, red=build,
yellow=drop. If your own cue naming is consistent, it's free training data
for structure classification. Worth auditing.

---



## 3. Computability assessment — grounded against shipped pipeline

The original report's "computable?" column re-evaluated against what's
actually running:


| #   | Signal                 | Original                   | Reality (Oct 1 2026)                                                                                                                                 |
| --- | ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Energy                 | "Yes, after calibration"   | ✅ SHIPPED but known-broken: loudness meter, not perceptual energy. v3 §5 proposes pairwise calibration on drop sections.                             |
| 2   | Key / Camelot          | "Already solved"           | ✅ SHIPPED: OpenKeyScan 80.7% exact, TKEY written, RB gauntlet pending next drive mount.                                                              |
| 3   | Vocal status           | "Yes, Demucs"              | ❌ NOT SHIPPED: last v4 token. v4-remaining-plan proposes Demucs htdemucs_ft batch (~3h GPU).                                                         |
| 4   | Mix notes              | "Yes, phrase+grid+vocal"   | ✅ SHIPPED: `IN:32 OUT:16` from PSSI decode. 74.7% coverage.                                                                                          |
| 5   | Sub-genre              | "Partly, audio+Discogs+BP" | ✅ SHIPPED: 8-rung vote ladder, 73 distinct labels, 98.3% primary coverage, LOO 66.6% gated.                                                          |
| 6   | Vibe / mood            | "Partly"                   | ✅ SHIPPED: ONNX mood heads (happy/sad/aggressive/relaxed/party), within-family percentile → `Hard/Soft`, `Dark/Euph`.                                |
| 7   | Function (tool/filler) | "Partly"                   | ❌ NOT BUILT: structure detection (no drop, percussive, long loops) needs dedicated classifier. Low priority — §6 below.                              |
| 8   | Crowd status           | "Partly, 1001TL + chart"   | ❌ NOT BUILT: no external popularity signal wired. 1001TL co-play is the interesting part — §6.3 below.                                               |
| 9   | Era                    | "Yes, release year"        | ✅ PARTIALLY: year from SC/BP/BC/file tags. Discogs dump (v3 proposal) would improve coverage.                                                        |
| 10  | Tempo issues           | "Yes, grid changes"        | ✅ SHIPPED: `VAR` token in v4 comment (3.6% of tracks, `bpm_residual_std > 15.0`).                                                                    |
| 11  | Pairings               | "Yes, history + 1001TL"    | ❌ NOT BUILT for history-derived. MegaSet uses embedding similarity (cosine + tempo/key gates), not play-history evidence. The co-play graph is §6.3. |
| 12  | Played at              | "Yes, RB history"          | ❌ NOT MINED: rekordbox history tables exist in master.db but are not read by any megadj command.                                                     |
| 13  | Source / version       | "Partly"                   | ✅ PARTLY: title parsing (`splitArtistFromTitle`), Beatport mix name/remixer credit (TXXX:BP-FIELDS), `[archive]`/`[BACKUP]` artifact filtering.      |
| 14  | Instrumentation        | "Partly"                   | ❌ SKIPPED: correctly assessed as "often redundant with sub-genre." No plan to build.                                                                 |
| 15  | Gig suitability        | "Partly"                   | ❌ NOT BUILT: Whisper lyrics → explicit flag is plausible but unplanned.                                                                              |
| 16  | Personal taste         | "No"                       | Correct — only you.                                                                                                                                  |


**Honest summary:** 8 of 16 signals are shipped, 2 are partially shipped,
6 are unbuilt. Of the unbuilt, only 3 are worth pursuing (vocal detection,
co-play graph, play history mining).

---



## 4. Signal inventory — what's new vs. what's already here



### 4.1 Signals already shipped (the report treats these as proposals)


| Signal                         | Report says          | Real status                                                                              | Module                              |
| ------------------------------ | -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| Playlist/folder names as voter | "Do first"           | NOT wired as a vote rung — but the v3 Dawid–Skene estimator would naturally consume them | —                                   |
| Hot/memory cues                | "High value"         | Ledgered, consumed by PSSI → IN/OUT/Drop                                                 | `src/fulltags/booth/comment-v4.ts`  |
| Rating, colour, play count     | "High"               | Color is written BY megadj (energy→ColorID); rating/play count not consumed              | `src/fulltags/booth/track-color.ts` |
| ID3 tags                       | "Medium-high"        | W6 file TCON rung (weight 0.55)                                                          | `src/getdat/commands/ingest.ts`     |
| rekordbox analysis             | "High"               | PSSI phrase decode → IN/OUT/Drop/Roll                                                    | `src/fulltags/booth/phrase-data.ts` |
| Essentia effnet embeddings     | "Already in use"     | Correct — 1280-d, ledgered in archive.db                                                 | `src/fulltags/analysis/models.ts`   |
| Discogs-400 style predictions  | "MAEST"              | effnet-trained head runs on cached embeddings: 46.1% top-1, ~77% top-5                   | `src/core/similar.ts`               |
| Demucs stems                   | "For vocal position" | **NOT shipped.** Planned for VOX/HOOK (v4 remaining).                                    | —                                   |
| CLAP                           | "Discovery queries"  | ❌ Measured worst for kNN, rejected. Text-probe not built.                                | —                                   |




### 4.2 External sources — what's new


| Source             | Report says                         | Real status                                                                                                                                                                                                                                                      | Gap                         |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Discogs API**    | "Do — 60/min, medium-high coverage" | **NOT wired as a vote rung.** The Discogs monthly dump (CC0, offline) is proposed in v3 landscape §2.6 as a new evidence arm. The dump is better than per-track API queries — same data, no rate limits, exact vocabulary match with effnet's training taxonomy. | **v3 WS5** — worth tracking |
| **Beatport**       | "Do — high coverage"                | ✅ **SHIPPED** as W3 rung (weight 0.60, highest). v4 catalog API via client-credentials. Also fills label/mix name/remixer/ISRC.                                                                                                                                  | None                        |
| **Last.fm**        | "Do (weak voter)"                   | ❌ **NOT INTEGRATED.** Genuinely new. Free API, `track.getTopTags` returns folksonomy with counts. Useful for hip-hop/pop where SC/BP are weak. The v3 landscape doc mentions it (§2.6) but no code exists.                                                       | **New issue candidate**     |
| **MusicBrainz**    | "Do for entity resolution"          | ✅ **SHIPPED** as W5 rung (weight 0.40). Artist folksonomy harvest via `mb-lookup.ts`.                                                                                                                                                                            | None                        |
| **1001Tracklists** | "Do carefully — co-play graph"      | ❌ **NOT BUILT.** Genuinely new idea. See §6.3 analysis below.                                                                                                                                                                                                    | **New issue candidate**     |
| **SoundCloud**     | "Phase 2"                           | ✅ **SHIPPED** — first-class download source AND W2 genre rung (weight 0.35). HLS AAC 256k with Plus auth.                                                                                                                                                        | None                        |
| **Bandcamp**       | "Phase 2"                           | ✅ **SHIPPED** as W2b rung (weight 0.50). Autocomplete search + page parse for genre/year/label/art.                                                                                                                                                              | None                        |


---



## 5. Why external labels disagree — cross-source mapping

This section's core insight is correct and already implemented:

> "Map every source into your taxonomy with a per-source mapping table."

The genre system does exactly this:

- `genre-vocab.ts` owns the canonical vocabulary (73 labels → 9 families)
- `genre-refold.ts` canonicalizes every label (casing, escape repair,
multi-label split, umbrella abstention)
- `scoringFamily()` maps display labels to the 9 math-consumable families

The report's proposal to "validate mappings with audio" is also live:
`genre --flag` flags labels that contradict a UNANIMOUS kNN consensus
(92 disputed of ~3,192 assessed, 2.9%).

**What the report adds that's worth noting:** the explicit call-out that
"Discogs annotates releases, not tracks" is a real gap. A compilation or
mixed EP inherits one style list for every track. The v3 Dawid–Skene
estimator should learn this as a per-source reliability signal (Discogs
reliability drops on compilations/VA releases). The current system has
no compilation-awareness.

---



## 6. What's genuinely new and worth pursuing



### 6.1 The co-play graph (1001Tracklists)

**This is the report's strongest original contribution.** The idea:

For every pair of tracks, how often real DJs played them back to back.
This encodes scene membership, crowd compatibility, and taste — signals
audio embeddings fundamentally cannot capture. Two tracks with similar
audio can belong to different scenes; two tracks with different audio
can be classic pairings.

**Why it matters for MegaSet:**

- MegaSet v1's transition scoring is `0.45·tempo + 0.30·key + 0.25·embedding`.
The embedding term captures audio similarity but not social compatibility.
- A co-play edge weight would be a fourth scoring term that captures
"real DJs actually mix these together."
- The ISMIR 2020 study (Kim et al.) obtained 1,557 mixes, 13,728 tracks,
20,765 transitions from 1001Tracklists — proving the data exists at scale.

**Architecture proposal:**

1. Mine your own rekordbox play history first (exact, free, zero API risk).
2. For each library track, search 1001TL, fetch the tracklists it appears
  in, keep the neighbors. Bounds the crawl to ~3,800 searches.
3. Graph embeddings (node2vec or LINE) give each track a social embedding
  to fuse with audio embedding as a MegaSet scoring term.

**Risks the report correctly identifies:**

- No public API, community scrapers only
- Terms of service exposure
- Must be personal, low-rate (1 page / 3–5s), cached forever, never redistributed

**Recommendation:** File a GitHub issue for exploration. Phase 1 is the
rekordbox history mining (zero risk, immediate value). Phase 2 is the
1001TL crawl (risk-managed, overnight batch).

**Cross-reference:** MegaSet v2 architecture (11-master-architecture-v2.md)
§4a already has a slot for "similarity prior" — the co-play signal would
be a second prior alongside embedding cosine, scored under the same cap
(≤ 0.1 weight per invariant #1: soft signals last and small).

### 6.2 Last.fm as a new vote rung

Last.fm `track.getTopTags` returns folksonomy tags with normalized counts
(0–100 relative to the top tag). The API is free with a key, fast, and
has good coverage for popular tracks.

**Why it's worth adding:**

- The current vote ladder is weakest on hip-hop/pop (SC/BP are
electronic-focused). Last.fm has strong hip-hop/pop coverage.
- Folksonomy tags include era words ("90s", "oldschool") and scene words
("acid", "industrial") that none of the current sources carry.
- It's a natural fit for the v3 Dawid–Skene estimator — one more noisy
voter whose reliability the model can learn.

**Why it's weak:**

- Underground coverage is sparse
- Tags are folksonomy (noisy, biased toward English-speaking listeners)
- Not track-level granular (artist-level tags dominate)

**Architecture:** weight ≤ 0.30 (below MB's 0.40, reflecting lower
reliability). Map through `canonGenre` like MB does. Gate on count ≥ 25
(exclude barely-used tags).

**Effort:** S (< 1 day). Free API key, existing `canonGenre` mapping,
existing vote ladder plumbing.

### 6.3 Rekordbox play history as training data

The report correctly identifies play history as "very high value" but
doesn't detail what's available:

**rekordbox master.db tables of interest:**

- `djmdHistory` — play events with timestamps
- `djmdSongHistory` — per-track history entries
- `djmdSongPlaylist` — playlist membership

**What you can extract:**

- Real transitions (track A → track B in the same session)
- Temporal patterns (which tracks you reach for in peak hours)
- Frequency (play count is a quality signal, but already in master.db)

**Value for MegaSet:** real transitions from your own sets are the
highest-quality training data for the set builder. The co-play graph from
1001TL gives you OTHER DJs' transitions; your own history gives you YOURS.

**Effort:** S (read from master.db via pyrekordbox, store in archive.db).
No external API, no rate limits, no terms-of-service risk.

### 6.4 Playlist names as a vote source

Your rekordbox playlist names (if they carry genre or role meaning)
are free silver labels. A playlist named "Tech House" containing 50
tracks is 50 vote inputs with high confidence.

**Caveat:** this only works if your playlist names are genre-meaningful.
The report's "open question" about this is the right gate — audit
first before wiring.

---



## 7. Dawid–Skene label model — v3 context

The report proposes exactly what the v3 plan already specifies. For
completeness, the mapping:


| Report concept                    | v3 plan reference                                                       |
| --------------------------------- | ----------------------------------------------------------------------- |
| Dawid–Skene over noisy voters     | v3 landscape §4: `crowd-kit` Dawid–Skene, GLAD, MACE                    |
| Per-source reliability            | v3 landscape §4: learned per-source × per-family reliability            |
| "Leave one source out" validation | v3 landscape §4.5: independent answer keys replace self-referential LOO |
| Bootstrap 95% CIs + McNemar       | Already shipped in `genre --eval --diagnostics`                         |
| Version stability                 | Not currently tested — worth adding to the eval harness                 |


The report's specific contribution beyond v3: **the version stability test**
(extended mix and radio edit must get the same genre). This is a good
invariant that's not in any current test.

---



## 8. Entity resolution — what's shipped vs. proposed

The report's entity resolution scheme:


| Step                         | Report                                    | Shipped?                                                                                                                                                         |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISRC first → MB → Discogs/BP | Use ISRC from ID3                         | ✅ ISRC read from ID3 (TSRC) + Beatport (TXXX:BP-FIELDS). MB fingerprint → MBID. Discogs lookup NOT wired.                                                        |
| Artist+title normalization   | Strip qualifiers, keep remixer            | ✅ `splitArtistFromTitle`, `parseFilename`, `nameTokens`/`artistGate` in `name-match.ts` (SSOT).                                                                  |
| Version-aware matching       | Extended/radio share genre; remix may not | ⚠️ PARTLY: title parsing handles remix credit, but genre routing does NOT query the remixer's artist tags — this is the "remix routing" gap called out in v3 §4. |
| Confidence per match         | Below threshold → no data                 | ✅ Hard artist gate (`scoreBpHit`, `scoreScHits`, `scoreBcHits`) enforces match quality.                                                                          |


**The real gap:** remix routing. Artist-level sources (MB folksonomy, SC
uploader tags) query the ORIGINAL artist for remixes, but the remixer's
style is what matters. The v3 plan (§4) proposes routing artist-level
sources by remixer — this is the single highest-value entity resolution
fix remaining.

---



## 9. LLMs — honest assessment

The report's LLM assessment is sound and matches the shipped system:


| Use                              | Report                 | System                                                                                              |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Normalize free text → vocabulary | "Yes"                  | ✅ `canonGenre` does this mechanically; AI rung (W4) is the LLM fallback, opt-in and off by default. |
| Name unknown clusters            | "Yes"                  | Not built — the #62 cluster-proposed-labels issue is the closest.                                   |
| Resolve entity matches           | "Yes, with confidence" | Not built — entity resolution is deterministic (name-match gates).                                  |
| Audio description                | "Low priority"         | Correct — no audio-language model in the pipeline.                                                  |
| Be the genre labeler             | "No"                   | ✅ Correct — AI rung (W4) is the LOWEST catalog rung at 0.45, opt-in.                                |


---



## 10. Coverage and accuracy — measured vs. estimated

The report gives "planning estimates." Here are the MEASURED numbers
(Oct 1 2026, from `genre-system.md` §12 + v4 comment stats):


| Output             | Report estimate | Measured                                   | Source                |
| ------------------ | --------------- | ------------------------------------------ | --------------------- |
| Family genre       | ~85–95%         | 93% family coverage (63 unmapped/265 rows) | `genre-system.md` §12 |
| Style (sub-genre)  | 60–75%          | 64.4% (subgenre in v4 comment)             | `v4-remaining-plan`   |
| Primary genre      | —               | 98.3% (4,487/4,566)                        | `genre-system.md` §12 |
| Secondary genre    | —               | 60.1% (2,744/4,566)                        | `genre-system.md` §12 |
| LOO agreement      | —               | 66.6% gated (≥65% PASS)                    | `genre-system.md` §9  |
| Vocal position     | ~100%           | ❌ 0% (not shipped)                         | `v4-remaining-plan`   |
| Intro/outro bars   | ~100%           | 74.7% (2,731/3,658)                        | `v4-remaining-plan`   |
| Energy band        | ~100%           | 97.9% (4,468/4,566)                        | `genre-system.md` §12 |
| Discogs match      | 50–75%          | NOT MEASURED (Discogs not wired)           | —                     |
| Beatport genre     | 60–85%          | NOT SEPARATELY MEASURED (part of W3)       | —                     |
| Last.fm tags       | 20–50%          | 0% (not wired)                             | —                     |
| 1001TL appearances | 30–60%          | 0% (not built)                             | —                     |
| Release year       | 60–85%          | NOT SEPARATELY MEASURED                    | —                     |


**Report's coverage estimates are in the right ballpark** for what's
shipped. The 98.3% primary genre coverage exceeds the report's family
estimate because the 8-rung vote ladder (especially the 0.60-weight
Beatport rung and the 0.55-weight file TCON rung) provides broader
coverage than the report anticipated.

---



## 11. Effort estimates — reality check

The report's effort estimates for external lookups assume a fresh build.
Several are already done:


| Step                        | Report estimate | Reality                                                                                                                                                            |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discogs search + release    | ~2h             | NOT STARTED — the v3 plan proposes the CC0 monthly dump instead (offline, no rate limits, ~15 min ingest on M1). The dump is strictly better than 7,600 API calls. |
| MusicBrainz lookup          | ~1h             | ✅ DONE — `mb-lookup.ts` already harvests for every `megadj enrich` run.                                                                                            |
| Last.fm track + artist tags | < 1h            | NOT STARTED — genuine S-effort task.                                                                                                                               |
| Beatport lookups            | 1–3h            | ✅ DONE — W3 rung fires on every `megadj fetch`.                                                                                                                    |
| 1001TL appearances          | 1–2 overnight   | NOT STARTED — effort estimate is reasonable for a bounded crawl.                                                                                                   |
| MAEST over library          | Hours           | 🧪 5-model section embedding bench was JUST committed (latest commit). Full library run not done.                                                                  |
| Demucs stems                | Overnight       | NOT STARTED — v4-remaining-plan estimates ~3h GPU / 2min×3600=120h CPU.                                                                                            |
| Whisper lyrics              | Hours           | NOT STARTED — low priority.                                                                                                                                        |


---



## 12. The report's "recommended plan" vs. reality


| Phase            | Report                                          | Status                                                                   | Next action                                              |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1. Own data      | Mine playlists, history, cues, ratings, colours | Cues ✅, energy ✅, colours ✅. **History NOT mined, playlists NOT mined.** | File issue: mine RB play history for MegaSet transitions |
| 2. Official APIs | Discogs, MB, Last.fm with entity resolution     | MB ✅. **Discogs NOT wired. Last.fm NOT wired.**                          | v3 WS5 (Discogs dump). New issue for Last.fm.            |
| 3. Label model   | Dawid–Skene over all voters                     | **v3 plan of record.** Not started.                                      | v3 WS4                                                   |
| 4. Co-play       | 1001TL crawl                                    | **Not started.**                                                         | New issue for exploration                                |
| 5. Fusion        | Audio + social embeddings + label posteriors    | Theoretical — depends on phases 3+4                                      | —                                                        |
| 6. Second wave   | SC/BC tags, LLM naming                          | SC ✅, BC ✅. LLM naming not built.                                        | #62 cluster-proposed labels                              |


---



## 13. Open questions — answered


| Question                                                        | Answer                                                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Do your rekordbox playlist names carry genre or role meaning?" | **Audit needed.** Run `SELECT Name, COUNT(*) FROM djmdPlaylist GROUP BY Name` on master.db. If ≥ 10 playlists have genre-meaningful names, wire as a voter. |
| "How many tracks have ISRC in ID3 tags?"                        | **Measurable.** `SELECT COUNT(*) FROM tracks WHERE isrc IS NOT NULL` on archive.db. Beatport fills ISRC via TXXX:BP-FIELDS for matched tracks.              |
| "Comfortable with personal-use 1001TL crawl?"                   | **Owner decision.** The ISMIR team got data via direct contact — worth asking before crawling.                                                              |
| "Should MegaSet learn from your transitions or public ones?"    | **Both, per MegaSet v2 architecture invariant #1:** your history as a hard prior, public co-play as a soft (capped ≤ 0.1) signal.                           |


---



## 14. Roadmap-actionable items (new work only)

Extracted from this analysis. Items that are already in the v3 plan or
existing issues are cross-referenced, not duplicated.

### New issue candidates


| #   | Item                                                                                                                                                     | Effort | Value            | Cross-ref                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------- | ------------------------------------------ |
| A   | **Mine rekordbox play history** — extract real transitions from `djmdHistory`/`djmdSongHistory`, store in archive.db, use as MegaSet transition evidence | S      | Very high        | MegaSet v2 §4a                             |
| B   | **Last.fm vote rung (W8)** — `track.getTopTags` + `artist.getTopTags`, map through `canonGenre`, weight ≤ 0.30                                           | S      | Medium           | v3 landscape §2.6 (mentioned, not tracked) |
| C   | **1001Tracklists co-play exploration** — personal-use bounded crawl for library tracks, co-play edge table, social embedding (node2vec)                  | L      | High for MegaSet | Novel                                      |
| D   | **Playlist-name audit** — are your rekordbox playlist names usable as genre voters? One-time audit.                                                      | XS     | Gate for item E  | —                                          |
| E   | **Playlist-name vote rung** (if D passes) — inject playlist membership as evidence into the vote ladder or v3 estimator                                  | S      | Medium           | —                                          |
| F   | **Version stability test** — add to genre eval: extended mix and radio edit of the same song must get the same genre                                     | XS     | Low but correct  | —                                          |




### Already tracked (do not duplicate)


| Item                                   | Where tracked        |
| -------------------------------------- | -------------------- |
| Discogs monthly dump as evidence arm   | v3 WS5               |
| Dawid–Skene label model                | v3 WS4, epic #346    |
| Independent answer keys                | v3 WS4 §4.5          |
| Remix routing for artist-level sources | v3 §4                |
| VOX/HOOK vocal detection               | v4-remaining-plan §1 |
| Energy recalibration                   | v3 landscape §5      |
| Cluster-proposed labels                | #62                  |


---



## 15. The mathematics of music — what makes a genre a genre

This section fills the original report's biggest gap: it never asked *what
music actually is* at the signal level, or how the subjective ("dark,"
"groovy," "banger") becomes computable. Everything below is grounded in
published MIR research with citations.

### 15.1 The 194-dimensional acoustic fingerprint of EDM

The most rigorous attempt to define what acoustically separates EDM
genres is [Xu et al. 2026, "Acoustic Overspecification in EDM"](https://arxiv.org/html/2509.11474v2)
— 194 continuous features across 3,500 Beatport tracks, validated against
MERT and CLAP embeddings. Their feature space has three tiers:

**Tier 1 — Conventional MIR (92 dimensions):**

| Feature class | Dims | What it measures |
|---|---|---|
| Spectral shape | 10 | Centroid (brightness), spread, entropy, flux (change rate), rolloff |
| MFCCs | 26 | 13 cepstral coefficients × (mean + std) — timbral texture |
| Chroma | 24 | 12 pitch class profile × (mean + std) — harmonic content |
| Rhythmic | 32 | Beat histogram periodicity, danceability, beat emphasis per 6 octave bands |

**Tier 2 — EDM production features (38 dimensions):**

| Feature | Formula/proxy | What it captures | Genre signal |
|---|---|---|---|
| **H/P ratio** | `energy(harmonic) / energy(percussive)` via median-filter separation | Drum prominence vs. melodic content | Techno: low. Progressive House: high. |
| **Crest factor** | `peak / RMS` | Dynamic range compression | Bigroom: near 1.0 (brickwalled). Deep House: higher. |
| **RMS kurtosis** | 4th moment of RMS envelope | Energy shape — spiky vs. flat | Sidechain-pumped genres: negative kurtosis. |
| **Spectral contrast** | 7-band peak-to-valley in STFT | Synth sharpness vs. noise | Hard Techno: high. Ambient: low. |
| **Sub-bass ratio** | `power(< 60 Hz) / total` | Sub vs. mid bass design | Dubstep/DnB: very high. Trance: low. |
| **Sidechain proxy** | `−corr(kick_env, HF_synth_env)` | Pumping compression effect | Progressive House: strongly negative. Techno: near zero. |

**Tier 3 — Tempogram features (64 dimensions):**

Three complementary tempo representations (Fourier, autocorrelation,
cyclic tempograms) capture layered rhythmic structure that a single BPM
number cannot.

**Key finding:** unsupervised clustering collapses 35 Beatport genres to
**17–20 acoustically distinct families**. "Tech House vs. Minimal" and
"Progressive House vs. Melodic House & Techno" are acoustically
indistinguishable. This directly validates megadj's 9-family scoring
model — 9 is closer to acoustic truth than 35.

### 15.2 The acoustic DNA of each genre family

| Family | BPM | Kick pattern | Key spectral features | Production signature |
|---|---|---|---|---|
| **House** | 118–130 | Four-on-the-floor | Mid-high centroid, moderate sub-bass | Sidechain pumping, groove-oriented |
| **Techno** | 125–145 | Four-on-the-floor | Low H/P (percussion dominates), high spectral contrast | Minimal harmonic content, industrial textures |
| **Trance** | 128–150 | Four-on-the-floor | High H/P (pads/leads dominate), low sub-bass | Euphoric builds, layered pads |
| **Bass** (DnB/Dub) | 140–180 / 70 half | Breakbeats / half-time | Very high sub-bass, high spectral flux | Chopped breaks, sub emphasis, distortion |
| **Trap** | 60–85 half | Half-time kick+snare, rapid hi-hat rolls (1/32) | High sub-bass, high rhythmic fragmentation | 808 sub-bass, triplet hi-hats, sparse arrangement |
| **Hardstyle/EDM** | 145–160 | Four-on-the-floor, distorted kick | Near-unity crest (brickwalled), high distortion | Kick IS the bass, extreme compression |
| **Hip-Hop** | 70–100 | Boom-bap or trap | Mid-range spectral energy, high vocal presence | Sample-based, deliberate micro-timing |
| **Ambient/Mood** | 60–120 | None or minimal | Low spectral flux, high chroma consistency | Sustained textures, low onset density |

**Critical insight:** genre identity in EDM is NOT primarily timbral.
Tempo/tempogram features rank HIGHEST for discrimination, followed by
energy/spectral modulation and production aesthetics. This explains why
the vote ladder outperforms pure audio kNN — embeddings capture timbre
well but rhythm and production aesthetics less so.

### 15.3 Drum pattern identification — computable rhythm

**State of the art (2025):**

- **N2N (Noise-to-Notes)** — diffusion-based ADT, 7 drum components
  with onset + velocity, MERT features for cross-domain robustness.
  New SOTA across benchmarks.
  ([arXiv:2509.21739](https://arxiv.org/pdf/2509.21739))
- **STAR Drums** — 48kHz FLAC dataset, 18-class annotations,
  CNN+GRU at 100 Hz frame rate.
  ([TISMIR 2024](https://transactions.ismir.net/articles/10.5334/tismir.244))
- **DOSE** — neural codec LM extracting kick/snare/hi-hat one-shots
  from full mixes, separate transformers per drum type.
  ([arXiv:2504.18157](https://arxiv.org/pdf/2504.18157))
- **Drumsep** — Demucs variant, 6 stems: kick/snare/tom/hihats/ride/crash.

**What drum transcription gives FullTags:**

| Signal | Method | Value |
|---|---|---|
| **4-on-floor vs. breakbeat** | Kick onset regularity (autocorrelation) | Genre family gate |
| **Hi-hat density** | Onsets per beat, subdivision depth | Trap (1/32) vs. house (1/16) vs. techno |
| **Drop/Roll accuracy** | Kick+snare density change across sections | Improves v4 comment |
| **Swing amount** | Alternating inter-onset interval ratio | House (swing) vs. techno (grid) |
| **Percussion dominance** | H/P ratio from stems | v4 `Hard/Soft` improvement |

### 15.4 Groove and micro-timing — computing "feel"

What makes house "groovy" vs. techno "driving" is micro-timing at
the millisecond level. Per
[Danielsen et al. 2023](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/BBC410F9849DB982AEBFACEA14D38F32/S0261143023000041a.pdf/shaping_rhythm_timing_and_sound_in_five_groovebased_genres.pdf):

**The swing ratio:**

```
sr = duration(downbeat → offbeat) / duration(offbeat → next_downbeat)
```

- `sr = 1.0` → perfectly straight (quantized techno grid)
- `sr ≈ 1.3` → light swing (classic house feel)
- `sr = 2.0` → triplet shuffle

EDM producers use a **22–40% swing pocket** (0% = straight, 100% = triplet).
But in techno, groove comes not from timing displacement but from
**sound design**: adjusting attack/release envelopes, sidechain compression
shapes, and transient layering changes perceived timing while every event
sits on the grid.

**Computing swing from audio:** the **Log-Lag Autocorrelation Function
(LLACF)** ([Bader & Müller, ISMIR 2015](https://ismir2015.uma.es/articles/143_Paper.pdf))
provides tempo-normalized representations capturing swing without onset
detection. It operates on spectral flux and reveals subdivision patterns
as shape signatures. More reliable than explicit onset-based measurement.

### 15.5 Making mood deterministic

The **Russell circumplex** maps emotion onto two continuous axes:

- **Valence** (unpleasant → pleasant): mode, consonance, pitch height
- **Arousal** (calm → excited): tempo, RMS, onset density, spectral flux

**Which features predict what:**

| Feature | Predicts | Direction |
|---|---|---|
| Tempo | Arousal | + (faster = more aroused) |
| RMS energy | Arousal | + (louder = more aroused) |
| Spectral centroid | Arousal | + (brighter = more aroused) |
| Spectral flux | Arousal | + (more change = more aroused) |
| Mode (major/minor) | Valence | Major = positive |
| Chroma consonance | Valence | + (consonant = pleasant) |
| MFCCs 1–4 | Both | Timbral brightness/warmth |

**SOTA:** HuBERT transformer reaches 95% on 5-class mood (aggressive/
happy/dramatic/sad/romantic). Key advantage: self-attention captures
temporal trajectories (calm→aggressive build) that frame-level features
miss.

**Fixing megadj's energy meter (v3 §5):**

Energy computed as library-wide loudness percentile gives E8.5 average
because mastered EDM is ALL loud. Fix: compute from the **drop section**,
composite of:

```
energy_drop = 0.4 × RMS_drop_pct + 0.3 × onset_density
            + 0.2 × spectral_flux   + 0.1 × sub_bass_ratio
```

Then percentile within **genre family** (not library-wide) — a "peak"
ambient track is calmer than a "warm-up" hardstyle track.

### 15.6 Mix compatibility — the math of blendability

Four independent metrics, each computable:

**1. Harmonic — Tonal Interval Vectors (TIV):**
Better than Camelot matching. TIV captures actual pitch-class overlap
and dissonance via 6 complex coefficients per beat. Small-scale
compatibility = perceptual relatedness + dissonance. Large-scale = key
association.
([Bernardes et al. 2018](https://cdv.dei.uc.pt/wp-content/uploads/publications-cdv/macas2019a.pdf),
[Bibbó Frau 2021](https://exa.ai/library/publication/6jkltnwjmxl))

**2. Rhythmic — onset density matching:**
`onset_density = count(spectral_flux_peaks) / duration`
Similar density = smoother blend.

**3. Spectral — Bark centroid distance:**
24 perceptually-weighted frequency bands. Close centroids = same
frequency space = blend. Far apart = holes.

**4. Timbral — MFCC cosine similarity:**
38-component MFCC vectors. High cosine = similar character.

**[Mosaikbox (ISMIR 2024)](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf)
extends this** with stem-aware compatibility (separate per-stem, remove
incompatible layers) — significantly outperforms baselines in listening
tests.

**MegaSet value:** current scoring is `0.45·tempo + 0.30·key + 0.25·embedding`.
Research says key term should be TIV-based, add onset density and spectral
centroid as terms. Embedding cosine partially captures timbral compatibility
but misses harmonic detail.

### 15.7 LLMs and music — the real state of play

**What actually works now:**

- **Audio → structured metadata → LLM → caption** (two-stage) beats
  end-to-end captioners. Trains faster, caption style changeable
  post-hoc. ([arXiv:2602.03023](https://arxiv.org/pdf/2602.03023))
- **Metadata imputation** — feed audio + partial metadata, model fills
  gaps. 21% improvement from partial context, up to 33% per field.
  Directly useful for archive.db gap-filling.
- **Audio-language models (Qwen-Audio, Gemini, Kimi-Audio) are NOT
  competitive for EDM subgenre** — specialized CNNs on mel-spectrograms
  significantly outperform them.
  ([arXiv:2409.06690](https://arxiv.org/html/2409.06690v3))
- **Soft labeling beats hard labeling** — models trained on probability
  distributions outperform 0/1 labels. Further evidence for Dawid–Skene.

### 15.8 Genre boundaries are partly cultural, not acoustic

**Beatport 35 → 17–20 acoustic clusters.** Many distinctions are
marketing, not sound:

- Tech House ≈ Minimal ≈ Deep Tech (acoustically interchangeable)
- Progressive House ≈ Melodic House & Techno (collapse)
- Trap clusters with half-time Dubstep
- Hard Techno clusters with Hardcore/DnB (tempo + spectral intensity
  dominate at extremes, override kick pattern)
- Nu Disco + Funky House → Commercial (vocal hooks + major key outweigh
  groove)

megadj's 9 families are structurally right. The 73 display labels should
stay fine-grained for cultural utility.

---

## 16. Roadmap implications of the deep research

| # | Item | What it gives | Effort | Cross-ref |
|---|---|---|---|---|
| G | **EDM production features** — H/P ratio, crest factor, sub-bass ratio, sidechain proxy per track | Genre-diagnostic features embeddings miss; improves house↔techno boundary | M | Novel |
| H | **Drum pattern transcription** — onset detection, kick pattern + hi-hat density classification | Automated function tags, improved Drop/Roll, genre-family gate | L | Extends v4 |
| I | **TIV harmonic compatibility** — replace Camelot-distance in MegaSet with TIV-beatwise | Better transitions | M | MegaSet v2 |
| J | **Drop-section energy recalibration** — composite from drop, percentile within family | Fixes E8.5 average | S | v3 §5 |
| K | **Swing/groove estimation** — LLACF per track | Blendability signal, potential v4 token | M | Novel |

---

## 17. Creative frontier — signals the doc still misses

Ideas not found in any section above, not in the v3 plan, not in any
megadj issue. Each is grounded in what the §15 research makes computable.

### 17.1 Energy trajectory, not energy level

The v4 comment writes `E8` — a single number. But a DJ doesn't just
need "how hard is this track" — they need "what does this track DO over
time." A track that builds E3→E8 over 32 bars is a ramp. A track that
opens at E8 and holds is a sustain. A track that peaks E9 then drops
to E2 is a release. The trajectory is what makes a track an opener,
a peak-time sustain, or a cooldown.

**How to compute it:** split the track into 8-bar windows, compute the
§15.5 energy composite per window, then classify the trajectory shape:

| Shape | Pattern | Set role |
|---|---|---|
| **Ramp** | E3→E8 monotonic rise | Builder, warm-up closer |
| **Sustain** | E7–E9 flat | Peak-time workhorse |
| **Arc** | E4→E8→E4 rise-and-fall | Self-contained journey |
| **Release** | E8→E3 drop | Cooldown, breakdown filler |
| **Pulse** | E6↔E8 oscillating | Drop-breakdown-drop cycle |

**Value for MegaSet:** the set builder currently chains by energy LEVEL
(the preset energy arc). With trajectory shapes, it can sequence for
narrative: ramp→sustain→sustain→release is a classic peak-hour arc that
a single E number can't encode. MegaSet would know a "Ramp" track
naturally precedes a "Sustain" track without needing play-history data.

### 17.2 The label-as-curator signal

Record labels in EDM are de facto genre curators. A Drumcode release is
techno. An Anjunadeep release is melodic/progressive. A Defected release
is house. The label is a stronger genre signal than any folksonomy tag.

megadj already stores label via Beatport (TPUB) and the imprint prior
rung (W7, weight 0.15). But the imprint prior maps labels to families
via a hand-curated table. What's missing:

- **Label network graph:** labels that share artists form clusters.
  If Artist X releases on both Drumcode and MORD, those labels are
  "techno neighbors." The graph structure IS a genre taxonomy learned
  from release data, not hand-curated.
- **Label→sub-genre precision:** "Drumcode" isn't just "techno" — it's
  specifically peak-time, driving techno. "Afterlife" is melodic techno.
  The label carries sub-genre resolution the family-level imprint
  prior currently throws away.

**Source:** the Discogs monthly dump (v3 WS5) contains the full
label→release→artist graph. Building the label network is a natural
extension of that ingest work.

### 17.3 Drop spectral signature as genre fingerprint

The §15.1 research says genre is best determined from the **drop**
section — the most representative segment of style. The spectral shape
AT the drop is diagnostic:

| Genre | Drop spectral shape |
|---|---|
| Dubstep | Sub-bass wall (< 100 Hz dominates), mid-range gap |
| Bigroom | Full-spectrum slam, near-flat from 60 Hz to 8 kHz |
| Tech House | Mid-range groove (200 Hz – 2 kHz), sparse highs |
| Melodic Techno | High pad energy (2–8 kHz), moderate sub, no slam |
| Trap | 808 sub peak + hi-hat sparkle (8–16 kHz), hollow mid |

**How to compute:** segment the track using PSSI phrase data (already
decoded), extract the drop section, compute the 7-band spectral contrast
from §15.1. Store as a compact 7-number vector per track. Use as an
additional genre-evidence dimension alongside the effnet embedding.

### 17.4 Genre as probability vector, not label

Every track should carry not just "Tech House" but
`{tech_house: 0.42, deep_house: 0.28, minimal: 0.18, progressive: 0.12}`.
This IS the Dawid–Skene posterior output from v3. But the display
implications are underexplored:

- **v4 comment:** already shows `· TechHouse+DeepHouse` — the
  probability vector decides which two to show and in what order
- **CrateDeck UI:** genre chips could show confidence (opacity or size)
- **MegaSet:** transition scoring could use Jensen-Shannon divergence
  between genre probability vectors — tracks with similar distributions
  blend culturally, even if their display labels differ
- **ID3 tag:** TCON gets the winner. But TXXX:GENRE_VECTOR could store
  the full distribution for round-tripping through tools

### 17.5 Intro/outro spectral compatibility score

MegaSet currently scores whole-track similarity. But what matters for a
transition is specifically how the **outro of track A** sounds against
the **intro of track B**. Two tracks with identical overall timbres but
different intro/outro textures will have a jarring transition.

**How to compute:** using the PSSI-decoded intro/outro sections (already
available for 74.7% of tracks), compute TIV + onset density + spectral
centroid on those specific sections. Store intro/outro compatibility
profiles per track. MegaSet then scores intro↔outro directly.

This is the per-section version of §15.6's blendability math — applied
to the exact sections that overlap in a real DJ transition.

### 17.6 Silence/space density as a production aesthetic signal

How much "air" is in a track — the ratio of low-energy frames to total
frames. Minimal techno has high space density (sparse, breathing).
Bigroom has near-zero (wall of sound). This is trivially computable:

```
space_density = count(RMS_frames < threshold) / total_frames
```

**Genre signal:** high space → minimal/deep/ambient. Low space →
bigroom/hardstyle/trance. **Mood signal:** high space → contemplative,
introspective. Low space → intense, overwhelming. **Mix signal:** high
space density means more room for the incoming track's elements during
a transition — a high-space outro blends with anything.

---

## 18. The ranked list — every signal scored for three purposes

Every signal in this document, rated 1–10 for three distinct consumers:

**🎛 SET** = value for MegaSet AI set building (transition quality,
sequencing logic, energy arcs)

**👁 BOOTH** = value as a human-readable annotation for DJs (v4 comment,
CrateDeck UI, My Tags, track color)

**🏷 GENRE** = value for multi-level genre classification (family,
display label, sub-genre, probability vector)

### Tier 1 — Highest impact (score ≥ 8 in at least one axis)

| # | Signal | 🎛 SET | 👁 BOOTH | 🏷 GENRE | Status | Why it ranks |
|---|---|---|---|---|---|---|
| 1 | **Energy trajectory** (§17.1) | **10** | **9** | 3 | Not built | THE missing MegaSet signal — encodes what a track DOES, not what it IS. "Ramp into Sustain into Release" is the entire logic of a DJ set. Comment token: `BUILD`/`HOLD`/`COOL`. |
| 2 | **Rekordbox play history** (§6.3) | **10** | 4 | 2 | Not mined | YOUR real transitions are the highest-quality training data for YOUR set builder. Free, zero-risk, already in master.db. |
| 3 | **Drop-section energy recalibration** (§15.5) | 7 | **10** | 2 | Not built (S effort) | Fixes the "everything is E8" loudness meter. Comment E1–E9 becomes musically meaningful. Per-family percentile. |
| 4 | **Dawid–Skene label model** (§7, v3 WS4) | 3 | 4 | **10** | v3 plan | Replaces hand-set vote weights with learned per-source × per-family reliability. The honest answer to "what genre is this?" |
| 5 | **Discogs monthly dump** (§4.2, v3 WS5) | 2 | 3 | **10** | v3 plan | CC0, offline, exact effnet training vocabulary. 400 styles → multi-level genre depth. Release year. Label. |
| 6 | **VOX/HOOK vocal detection** (§3.3) | 6 | **10** | 2 | Planned, last v4 token | Last gap in the v4 comment. DJs need to know vocal position for clean mix zones. |
| 7 | **1001TL co-play graph** (§6.1) | **10** | 2 | 5 | Not built | The only signal that encodes "real DJs mix these together" — social information audio cannot capture. |
| 8 | **Intro/outro spectral compatibility** (§17.5) | **9** | 3 | 1 | Not built | Scores the ACTUAL transition sections, not whole-track similarity. The difference between a smooth and jarring mix. |
| 9 | **Genre probability vector** (§17.4) | 7 | 7 | **9** | Dawid–Skene output | `{tech_house: 0.42, deep_house: 0.28, ...}` is more honest and useful than a single label. Jensen-Shannon for set diversity. |
| 10 | **EDM production features** (§15.1, §16 G) | 4 | 3 | **9** | Not built | H/P ratio, crest factor, sub-bass ratio, sidechain proxy — genre-diagnostic features effnet embeddings miss. Breaks house↔techno. |

### Tier 2 — High impact (score 6–8 in at least one axis)

| # | Signal | 🎛 SET | 👁 BOOTH | 🏷 GENRE | Status | Why |
|---|---|---|---|---|---|---|
| 11 | **TIV harmonic compatibility** (§15.6) | **8** | 2 | 1 | Not built | Better than Camelot for transition quality — captures pitch-class overlap and dissonance, not just key distance. |
| 12 | **Drum pattern transcription** (§15.3) | 5 | **7** | **8** | Not built | 4-on-floor vs. breakbeat is a genre family gate. Hi-hat density separates trap/house/techno. Drop/Roll accuracy improvement. |
| 13 | **Swing/groove estimation** (§15.4) | **7** | **7** | 5 | Not built | Blendability signal (similar groove = smoother mix). Potential comment token: `SWING`/`GRID`. Genre-confirmatory. |
| 14 | **Last.fm vote rung** (§6.2) | 2 | 2 | **7** | Not built (S effort) | Fills the hip-hop/pop coverage gap. Era and scene words. Natural Dawid–Skene voter. Cheapest new evidence source. |
| 15 | **Drop spectral signature** (§17.3) | 4 | 4 | **8** | Not built | 7-number spectral contrast vector at the drop. Genre-fingerprint that complements the whole-track embedding. |
| 16 | **Remix routing** (v3 §4) | 2 | 2 | **8** | v3 plan | Artist-level sources query remixer, not original artist. Single highest-value entity resolution fix for genre accuracy. |
| 17 | **Label network graph** (§17.2) | 3 | 4 | **7** | Not built | Labels are curators. Drumcode = peak techno, not "techno." The graph gives sub-genre precision the imprint prior lacks. |
| 18 | **Space/silence density** (§17.6) | **6** | **6** | 4 | Not built | Minimal techno vs. bigroom wall-of-sound. Mix headroom signal. Trivially computable (`count(RMS < thresh) / total`). |
| 19 | **LLM metadata imputation** (§15.7) | 2 | 5 | **7** | Not built | Audio + partial metadata → fill gaps. 21% improvement from partial context. Natural upgrade for the AI rung (W4). |
| 20 | **Playlist-name voter** (§6.4) | 2 | 2 | **6** | Needs audit | Free silver labels if naming is consistent. Natural Dawid–Skene input. |

### Tier 3 — Moderate impact (score 4–6)

| # | Signal | 🎛 SET | 👁 BOOTH | 🏷 GENRE | Status | Why |
|---|---|---|---|---|---|---|
| 21 | **Cue color/naming audit** (§2) | 3 | **5** | 3 | Not done | Free structure training data if naming is consistent. |
| 22 | **Version stability test** (§7) | 2 | 2 | **5** | Not built | Extended/radio edit must match genre. Correctness invariant. |
| 23 | **Whisper lyrics → explicit flag** (§3.15) | 2 | **5** | 1 | Not built | Gig suitability ("wedding safe"). Niche value. |
| 24 | **Function tags (tool/filler)** (§3.7) | **5** | **5** | 2 | Not built | Structural detection: no drop = tool, long loops = filler. Low priority but useful for set pacing. |
| 25 | **Era/release year** (§3.9) | 3 | **5** | 4 | Partial | Discogs dump completes coverage. Display value ("90s classic"). |
| 26 | **Crowd status / popularity** (§3.8) | **5** | **4** | 2 | Not built | 1001TL support counts + Last.fm listener counts. "Anthem" vs. "deep cut." |

### Tier 4 — Low priority or already solved

| # | Signal | 🎛 SET | 👁 BOOTH | 🏷 GENRE | Status | Why |
|---|---|---|---|---|---|---|
| 27 | BPM / tempo | 8 | 8 | 3 | ✅ Shipped | Already the top MegaSet scoring term (0.45 weight). |
| 28 | Key / Camelot | 7 | 8 | 1 | ✅ Shipped | OpenKeyScan 80.7%, TKEY written. |
| 29 | Primary genre | 3 | 6 | 8 | ✅ Shipped | 98.3% coverage, 8-rung vote ladder. |
| 30 | Energy level | 5 | 8 | 1 | ✅ Shipped (broken) | Works but is a loudness meter. #3 above fixes it. |
| 31 | Mood (Dark/Euph/Hard/Soft) | 4 | 7 | 4 | ✅ Shipped | ONNX mood heads, within-family percentile. |
| 32 | IN/OUT bars | 6 | 8 | 1 | ✅ Shipped | PSSI decode, 74.7% coverage. |
| 33 | Drop/Roll | 3 | 7 | 2 | ✅ Shipped | 97.5%/2.5% from PSSI. |
| 34 | VAR (tempo instability) | 3 | 5 | 2 | ✅ Shipped | 3.6% of tracks. |
| 35 | Track color | 2 | 7 | 1 | ✅ Shipped | Energy→ColorID, 100%. |
| 36 | Sub-genre display | 3 | 7 | 6 | ✅ Shipped | 64.4% coverage, `· TechHouse+DeepHouse`. |
| 37 | Effnet embeddings | 8 | 1 | 6 | ✅ Shipped | 1280-d, MegaSet scoring (0.25 weight), kNN. |
| 38 | Instrumentation detection | 2 | 3 | 3 | ❌ Skip | Redundant with sub-genre. |
| 39 | Personal taste | 1 | 2 | 1 | N/A | Only you know. |

### Summary: top priorities by axis

**🎛 For MegaSet set building (top 5):**
1. Energy trajectory (BUILD/HOLD/COOL) — §17.1
2. Rekordbox play history as transition training data — §6.3
3. 1001TL co-play graph as social embedding — §6.1
4. Intro/outro spectral compatibility — §17.5
5. TIV harmonic compatibility replacing Camelot — §15.6

**👁 For booth / human-readable DJ annotations (top 5):**
1. Drop-section energy recalibration (fix E8.5 → meaningful E1–E9) — §15.5
2. VOX/HOOK vocal detection — v4 remaining plan
3. Energy trajectory token (BUILD/HOLD/COOL) — §17.1
4. Swing/groove estimation (SWING/GRID token) — §15.4
5. Drum pattern density (hi-hat, kick) — §15.3

**🏷 For multi-level genre classification (top 5):**
1. Dawid–Skene label model (probability vectors) — v3 WS4
2. Discogs monthly dump (400 Discogs styles in effnet vocabulary) — v3 WS5
3. Genre probability vector as the display format — §17.4
4. EDM production features (H/P ratio, sub-bass, sidechain) — §15.1
5. Remix routing for artist-level sources — v3 §4

---

## 19. Sources (original, preserved + new research)

- [DJ Will Gill — How to organize DJ music](https://djwillgill.com/how-to-organize-dj-music/)
- [DJ Will Gill — Organize curated songs for faster mixing](https://djwillgill.com/how-to-organize-your-curated-songs-for-faster-mixing/)
- [Digital DJ Tips — Beyond genre: 5 tagging tricks](https://www.digitaldjtips.com/beyond-genre-5-tagging-tricks-better-dj-sets/)
- [Mixed In Key — Organize by key, BPM and energy](https://mixedinkey.com/workflows/organize-dj-library-by-key-bpm-energy/)
- [Violet Recording — Organize your music library for DJing](https://violetrecording.com/how-to-organize-your-music-library-for-djing/)
- [Digital DJ Pool — Hot cues: where to set them](https://digitaldjpool.com/blog/hot-cues-for-djs/)
- [We Are Crossfader — Hot cues complete guide](https://wearecrossfader.co.uk/blog/hot-cues-complete-guide/)
- [zZounds — Setting hot cue points](https://blog.zzounds.com/2019/01/10/setting-hot-cue-points/)
- [Kim et al., ISMIR 2020 — Computational analysis of real-world DJ mixes](https://arxiv.org/abs/2008.10267)
- [1001tracklist-api (community)](https://github.com/yss14/1001tracklist-api)
- [Last.fm API — track.getTopTags](https://www.last.fm/api/show/track.getTopTags)
- [Discogs API rate limits (via Apify actor docs)](https://apify.com/crawlerbros/discogs-scraper)
- [Beatport API access (API Evangelist)](https://providers.apievangelist.com/providers/beatport/)
- [SoundCloud track fields (Apify scraper docs)](https://apify.com/xtracto/soundcloud-scraper)
- [Digital Music News — Spotify API changes](https://www.digitalmusicnews.com/?p=308667)
- [mcp-spotify — summary of removed endpoints](https://pypi.org/project/mcp-spotify/)
- [MAEST paper (ISMIR 2023)](https://arxiv.org/pdf/2309.16418)
- [MAEST model card](https://huggingface.co/mtg-upf/discogs-maest-10s-dw-75e)
- [Audio-based disambiguation of music genre tags](https://arxiv.org/pdf/1809.07256)
- [AcousticBrainz Genre Dataset (ISMIR 2019)](https://repository.tudelft.nl/file/File_2b63101e-638b-4eed-86da-5256fb7809a6)
- [MediaEval AcousticBrainz Genre task](https://zenodo.org/records/2553414)

**New research (§15–§16):**

- [Xu et al. — Acoustic Overspecification in EDM (SMC 2026)](https://arxiv.org/html/2509.11474v2) — 194-feature space, 17–20 acoustic families vs. 35 commercial
- [Xu et al. — edm-overspec (code + features)](https://github.com/alunxu/edm-overspec)
- [Benchmarking Sub-Genre Classification for Mainstage Dance Music (2024)](https://arxiv.org/html/2409.06690v3) — 1000+ track soft-label dataset, 8 house sub-genres
- [Caparrini et al. — Deep Learning EDM Subgenre Classification (2021)](https://ar5iv.labs.arxiv.org/html/2110.08862) — 75K songs, 30 genres, tempogram late fusion +5–10%
- [Raveform — Metrical and Functional Structure in EDM (TISMIR 2026)](https://transactions.ismir.net/articles/10.5334/tismir.288)
- [MixMash — Harmonic, Rhythmic, Spectral and Timbral Similarity (2019)](https://cdv.dei.uc.pt/wp-content/uploads/publications-cdv/macas2019a.pdf)
- [Bibbó Frau — TIV Harmonic Compatibility for EDM Mixing (2021)](https://exa.ai/library/publication/6jkltnwjmxl)
- [Mosaikbox — Rule-based Automatic DJ Mixing (ISMIR 2024)](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf)
- [Zehren — Cue Point Detection and Drum Transcription (2024)](https://exa.ai/library/publication/9tyn0n53n7f)
- [STAR Drums dataset (TISMIR 2024)](https://transactions.ismir.net/articles/10.5334/tismir.244) — 18-class drum annotations
- [N2N: Noise-to-Notes Diffusion ADT (2025)](https://arxiv.org/pdf/2509.21739)
- [DOSE: Drum One-Shot Extractor (2025)](https://arxiv.org/pdf/2504.18157)
- [Drum Machine of Tao — Reverse-engineering drum loops (NIME 2025)](https://nime.org/proceedings/2025/nime2025_79.pdf)
- [Danielsen et al. — Shaping Rhythm: Timing and Sound in Groove-Based Genres (2023)](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/BBC410F9849DB982AEBFACEA14D38F32/S0261143023000041a.pdf/shaping_rhythm_timing_and_sound_in_five_groovebased_genres.pdf)
- [Bader & Müller — LLACF Swing Ratio Estimation (ISMIR 2015)](https://ismir2015.uma.es/articles/143_Paper.pdf)
- [Music Metadata LLMs (arXiv:2602.03023)](https://arxiv.org/pdf/2602.03023) — audio→metadata→caption two-stage pipeline
- [MetaScore — Tag- and Text-Based Symbolic Music Generation (ISMIR 2024)](https://arxiv.org/html/2410.02084v3)
- [HuBERT Music Mood Classification — 95% on 5-class (2025)](https://www.nature.com/articles/s41598-025-29200-1)
- [Emotify+ Dataset — Multidimensional Music Emotion (2025)](https://link.springer.com/article/10.1186/s13636-025-00419-0)
- [Convolutional Autoencoders for Valence-Arousal (2024)](https://link.springer.com/article/10.1007/s11042-024-20275-y)
- [Unified Multitask MER with MERT (arXiv:2502.03979)](https://arxiv.org/pdf/2502.03979)

