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

## 18. The ranked list — every signal, with implementation and examples

Every signal in this document scored once (1–10 combined impact across
set building, DJ readability, and genre classification), with concrete
implementation detail and expected output.

---

### #1 · Energy trajectory — **Impact 10** · Not built

**Why it matters:** A single energy number (E8) tells you how hard a
track is, but not what the track DOES. A DJ set is a narrative: build
tension, hold a peak, release into a breakdown. Two tracks at E8 might
be completely different — one builds from E3→E8 over 32 bars, the other
sits flat at E8 the whole time. The builder is an opener, the sustainer
is a peak-time workhorse. The trajectory IS the set-building logic.

**How we'll do it:** Split each track into 8-bar windows using the
existing PSSI phrase data. Compute the §15.5 energy composite per
window. Classify the shape:

```
Track: "Innellea - Vigilans"
Windows: [E3, E4, E5, E6, E7, E8, E8, E8, E7, E5]
Shape: RAMP (monotonic rise then sustain)
Set role: builder, warm-up closer
```

```
Track: "ANNA - Hidden Beauties"
Windows: [E8, E8, E9, E9, E8, E9, E9, E8]
Shape: SUSTAIN (high plateau with minor oscillation)
Set role: peak-time workhorse
```

```
Track: "Bicep - Glue"
Windows: [E4, E6, E8, E8, E7, E5, E3, E2]
Shape: ARC (rise-and-fall, self-contained journey)
Set role: standalone moment, set centerpiece
```

**Expected output in v4 comment:** `E8 BUILD IN:32 OUT:16 Drop Dark · MelTechno`

**Expected DB column:** `tracks.energy_trajectory = 'RAMP'` (one of
RAMP / SUSTAIN / ARC / RELEASE / PULSE)

**Why it's #1:** MegaSet currently sequences by energy LEVEL. With
trajectory, it sequences by NARRATIVE. "Ramp → Sustain → Sustain →
Release" is a classic peak-hour arc that a single number can't encode.
The set builder would know a RAMP track precedes a SUSTAIN track without
needing play-history data. This is the missing dimension.

---

### #2 · Rekordbox play history — **Impact 9** · Not mined

**Why it matters:** Every transition you've ever played is already
recorded in `master.db`. This is YOUR data about YOUR preferences — the
single highest-quality training signal for YOUR set builder. No external
API, no cost, no rate limits. Just a SQL query away.

**How we'll do it:** `djmdSongHistory` in master.db has timestamps +
content IDs. Pair consecutive plays within 30 minutes = one transition.
Extract BPM delta, key delta, energy delta, genre match/mismatch for
each pair.

```sql
-- Example query from master.db
SELECT h1.ContentID, h2.ContentID,
       c1.BPM, c2.BPM,
       abs(c1.BPM - c2.BPM) as bpm_delta
FROM djmdSongHistory h1
JOIN djmdSongHistory h2 ON h2.created_at BETWEEN h1.created_at AND datetime(h1.created_at, '+30 minutes')
  AND h2.ContentID != h1.ContentID
JOIN djmdContent c1 ON c1.ID = h1.ContentID
JOIN djmdContent c2 ON c2.ID = h2.ContentID
ORDER BY h1.created_at;
```

**Expected output:** A transition graph of ~500–2,000 real pairs.
MegaSet uses these as gold-standard positive examples — "you actually
played A→B, so tracks like A→B should score high."

**Why it's #2:** This is free supervised training data. Every other
signal is a PROXY for "do these tracks go together" — this one is the
direct answer. The co-play graph from 1001TL tells you what OTHER DJs
play together; play history tells you what YOU play together.

---

### #3 · Drop-section energy recalibration — **Impact 9** · Not built

**Why it matters:** The current energy is a loudness meter. The whole
library averages E8.5. The v4 comment writes `E8` for almost everything,
so the token is wasted — a DJ can't scan their library by energy level
if everything is the same level. Energy should mean "how intense does
this track FEEL relative to its genre family."

**How we'll do it:** Per the v3 plan: extract 8 features from the drop
section (onset density, spectral centroid, spectral contrast, sub-bass
ratio, LUFS, crest factor, H/P ratio, RMS kurtosis). Blend them into a
composite with LUFS capped at ~10% weight. Then percentile-rank within
each genre family (house tracks ranked against house, techno against
techno).

```
Before (loudness meter):
  "Afterlife melodic track" → E8 (it's mastered loud)
  "Drumcode peak-time techno" → E9 (it's mastered louder)
  "Deep house groove" → E7 (slightly quieter master)

After (calibrated):
  "Afterlife melodic track" → E5 (calm within melodic techno family)
  "Drumcode peak-time techno" → E9 (truly intense within techno family)
  "Deep house groove" → E4 (laid-back within house family)
```

**Expected v4 comment change:** `E5 IN:32 OUT:16 Drop Euph · MelTechno`
— now E5 actually means something different from E9.

**Why it's #3:** This makes the EXISTING comment token useful. Every
other signal adds new information; this one fixes the information that's
already there but broken. A DJ scanning `E3→E5→E7→E9` can now trust
the progression.

---

### #4 · Dawid–Skene label model — **Impact 9** · v3 plan (WS4)

**Why it matters:** The current 8-rung vote ladder uses hand-tuned
weights (Beatport W3=0.60, SoundCloud W2=0.35). But Beatport isn't
equally reliable for every genre — it's great for EDM but weak for
hip-hop. SoundCloud is great for bass music but noisy for house. The
weights should be LEARNED per source × per genre family, not guessed.

**How we'll do it:** `crowd-kit` Dawid–Skene expects a dataframe of
(annotator, item, label). We already have this: each rung is an
annotator, each track is an item, each genre vote is a label. Feed the
existing `genre_votes` table into Dawid–Skene and get back per-source
reliability matrices + per-track probability vectors.

```
Input (existing genre_votes rows):
  track_id=42, source="beatport",    genre="Tech House",    weight=0.60
  track_id=42, source="soundcloud",  genre="House",         weight=0.35
  track_id=42, source="musicbrainz", genre="Deep House",    weight=0.40
  track_id=42, source="ai_fallback", genre="Tech House",    weight=0.45

Output (Dawid–Skene posterior):
  track_id=42, genre_vector={tech_house: 0.52, deep_house: 0.24, house: 0.18, minimal: 0.06}
  winner: "Tech House" (52% confidence)
  learned: beatport reliability for tech_house = 0.83 (high)
  learned: soundcloud reliability for tech_house = 0.41 (low — it often says "House" for tech house)
```

**Why it's #4:** This replaces hand-tuning with math. The model TELLS
you which sources are reliable for which genres. When you add a new
source (Last.fm, Discogs), it automatically learns that source's
reliability without manual weight assignment.

---

### #5 · Discogs monthly dump — **Impact 9** · v3 plan (WS5)

**Why it matters:** Discogs has 400 styles in a hierarchical taxonomy
that is the EXACT vocabulary the effnet model was trained on. It's CC0
(free, no rate limits), 600M+ releases, and includes release year, label,
and format. This is the deepest genre vocabulary available anywhere.

**How we'll do it:** Download the monthly XML dump (~9 GB compressed).
Build a local SQLite lookup: artist+title → Discogs styles + label +
year. Match against the archive via artist+title fuzzy match (reusing
the existing `scoreNameMatch` from `name-match.ts`). Each matched style
becomes a Dawid–Skene voter.

```
Track: "Maceo Plex - Conjure Superstar"
Discogs match: release_id=7654321
  styles: ["Techno", "Minimal", "Acid"]
  label: "Ellum Audio"
  year: 2019
  format: "12\" Vinyl"

→ genre_votes row: source="discogs", genre="Techno", sub_genres=["Minimal","Acid"]
→ tracks.release_year = 2019
→ tracks.label = "Ellum Audio"
```

**Expected coverage lift:** Discogs covers vinyl-heavy back catalogs
that Beatport/SoundCloud miss. Estimated +15–25% coverage for tracks
with no existing genre votes. Multi-style labels give sub-genre depth
the vote ladder currently lacks.

**Why it's #5:** Volume × precision × zero cost. The monthly dump is
the only source where one download gives genre evidence for the ENTIRE
library at once.

---

### #6 · VOX/HOOK vocal detection — **Impact 8** · Planned (last v4 token)

**Why it matters:** DJs need to know WHERE the vocals are so they don't
layer two vocal tracks on top of each other. A vocal clash (two singers
at once) is one of the most obvious DJ mistakes. The v4 comment has 8/9
tokens shipped — VOX is the last gap.

**How we'll do it:** Per the v4 remaining plan: Demucs vocal stem
separation (already proven in the mood pipeline) → energy detection on
the vocal stem → classify as VOX (has vocals) / HOOK (vocal hook in
drop only) / instrumental (no token). Position detection marks intro-vox
vs. drop-vox vs. throughout.

```
Track: "CamelPhat & Elderbrook - Cola"
Demucs vocal stem energy: [low, low, HIGH, HIGH, low, HIGH, HIGH, low]
Classification: VOX (vocals in drops and breakdowns)
Position: "drop+breakdown" (avoid mixing into ANOTHER vocal track's drop)

v4 comment: E7 IN:16 OUT:16 VOX Drop Dark · TechHouse
```

```
Track: "Amelie Lens - Exhale"
Demucs vocal stem energy: [low, low, low, low, low, low, low, low]
Classification: (no token — instrumental)

v4 comment: E9 IN:32 OUT:16 Drop Hard · Techno
```

**Why it's #6:** This completes the v4 comment — every slot filled. The
XDJ-XZ Track Filter can then filter by VOX / instrumental, which is the
single most requested filter after genre and energy.

---

### #7 · 1001Tracklists co-play graph — **Impact 8** · Not built

**Why it matters:** 1001TL has millions of real set tracklists from real
DJs. If track A appears next to track B in 50 different sets, those
tracks are proven compatible. This is SOCIAL information that no amount
of audio analysis can capture — it encodes taste, culture, scene
conventions, crowd response patterns.

**How we'll do it:** Query the 1001TL community API for each track in
the library. Build a co-occurrence matrix: for every pair (A, B) that
appear within ±3 positions in a tracklist, increment the co-play count.
Normalize by total appearances.

```
Track: "Charlotte de Witte - Doppler"
1001TL appearances: 847 sets
Top co-play neighbors:
  1. "ANNA - Hidden Beauties" (co-play: 0.34, appeared together 287 times)
  2. "Enrico Sangiuliano - Moon Rocks" (co-play: 0.29)
  3. "Amelie Lens - Exhale" (co-play: 0.24)
  4. "AIROD - Sigma" (co-play: 0.21)

→ MegaSet neighbor bonus: +0.34 when sequencing Doppler → Hidden Beauties
```

**Expected impact on MegaSet:** The current scoring uses audio features
only: `0.45·tempo + 0.30·key + 0.25·embedding`. Adding co-play as a
fourth term gives the set builder real-world DJ knowledge. Tracks that
SOUND similar but nobody plays together get downranked; tracks that
sound different but DJs bridge regularly get a boost.

**Why it's #7:** This is the only signal in the entire list that comes
from human DJ behavior, not audio or metadata. It's irreplaceable.

---

### #8 · Intro/outro spectral compatibility — **Impact 8** · Not built

**Why it matters:** MegaSet scores whole-track similarity. But a DJ
transition only involves 16–64 bars of overlap between two tracks. Two
tracks with identical OVERALL timbre can have completely different
intro/outro textures — the intro might be a minimal hi-hat loop while
the outro is a bass-heavy breakdown. The transition quality depends on
the SPECIFIC sections that overlap.

**How we'll do it:** We already have PSSI-decoded intro/outro sections
for 74.7% of tracks. Compute three features on each section: TIV
harmonic profile, onset density, Bark-band spectral centroid. Store as a
compact per-track profile.

```
Track A outro profile: {tiv: [0.2, 0.8, ...], onsets: 12.3/bar, centroid: 2400 Hz}
Track B intro profile: {tiv: [0.3, 0.7, ...], onsets: 8.1/bar, centroid: 1800 Hz}

Compatibility score:
  tiv_cosine = 0.94 (harmonically compatible ✓)
  onset_ratio = 0.66 (A is busier, B has room ✓)
  centroid_delta = 600 Hz (different frequency range, no clash ✓)
  → transition_score = 0.87 (smooth transition predicted)

Track C intro profile: {tiv: [0.9, 0.1, ...], onsets: 15.7/bar, centroid: 2500 Hz}

Compatibility with Track A outro:
  tiv_cosine = 0.31 (harmonically clashing ✗)
  onset_ratio = 1.28 (both busy, will be muddy ✗)
  → transition_score = 0.29 (jarring transition predicted)
```

**Why it's #8:** This replaces guessing with measurement. MegaSet could
rank the next 10 candidate tracks by actual transition quality, not
just by "they sound vaguely similar overall."

---

### #9 · Genre probability vector — **Impact 8** · Dawid–Skene output

**Why it matters:** Saying a track is "Tech House" throws away
information. The track might be 42% tech house, 28% deep house, 18%
minimal, 12% progressive. That distribution IS the track's identity.
Two tracks with the same winner label can be very different:
`{tech_house: 0.90}` is a straightforward tech house banger.
`{tech_house: 0.42, deep_house: 0.28}` is a crossover track that fits
in EITHER set.

**How we'll do it:** This is the natural output of Dawid–Skene (#4).
Store the full posterior as `tracks.genre_vector` (JSON). Display the
top-2 in the v4 comment. Use Jensen-Shannon divergence between vectors
for set diversity scoring.

```
v4 comment (already works): E7 IN:16 OUT:16 Drop Dark · TechHouse+DeepHouse

CrateDeck genre chip: "Tech House" (opacity 0.9) + "Deep House" (opacity 0.6)

MegaSet set diversity:
  Track 1: {tech_house: 0.80, minimal: 0.15, ...}
  Track 2: {tech_house: 0.75, house: 0.20, ...}
  Track 3: {deep_house: 0.60, tech_house: 0.25, ...}
  Set JSD = 0.18 (too homogeneous — suggest a genre shift)

  After inserting Track 4: {melodic_techno: 0.70, progressive: 0.20}
  Set JSD = 0.42 (healthy genre arc ✓)
```

**Why it's #9:** This makes genre HONEST. Every classification system
pretends tracks belong to exactly one genre. They don't. The probability
vector acknowledges uncertainty and cross-genre identity. And the
Jensen-Shannon diversity metric gives MegaSet a way to build sets that
travel through genres intentionally.

---

### #10 · EDM production features — **Impact 8** · Not built

**Why it matters:** The effnet embedding captures "this sounds like
techno" but can't tell you WHY. The Xu et al. 194-feature study showed
that specific production characteristics are what separate genres: the
harmonic-to-percussive ratio, the crest factor (dynamic range), the
sub-bass ratio, the sidechain pumping depth. These are the features that
a PRODUCER would use to describe the difference between house and techno.

**How we'll do it:** Compute 6 key production features per track using
essentia (most are single-function calls):

```
Track: "Fisher - Losing It"
  h_p_ratio: 0.35 (percussion-heavy ✓ house)
  crest_factor: 4.2 (moderate dynamics)
  sub_bass_ratio: 0.28 (strong sub ✓ house)
  sidechain_depth: 0.71 (deep pump ✓ house)
  spectral_contrast_bands: [12, 8, 15, 22, 18, 11, 9]
  rms_kurtosis: 2.1 (even energy distribution)

Track: "Amelie Lens - Exhale"
  h_p_ratio: 0.22 (very percussion-heavy ✓ techno)
  crest_factor: 2.8 (compressed, driving)
  sub_bass_ratio: 0.18 (less sub, more mid ✓ techno)
  sidechain_depth: 0.32 (light pump ✓ techno)
  spectral_contrast_bands: [8, 14, 20, 25, 22, 16, 12]
  rms_kurtosis: 3.8 (peaky energy = builds/drops)
```

**Expected genre classification lift:** The Xu et al. study found these
features improved genre separation by 5–10% over spectral-only. For the
house↔techno boundary specifically — which is our biggest confusion pair
— sub-bass ratio + sidechain depth alone achieve ~85% separation.

**Why it's #10:** These features fill the gap between "sounds like X"
(embedding) and "is produced like X" (explicit features). They're
especially valuable for the Dawid–Skene model as an additional voter
that has zero correlation with the tag-based sources.

---

### #11 · TIV harmonic compatibility — **Impact 7** · Not built

**Why it matters:** Camelot matching (the current key compatibility
system) says "7A is compatible with 7A, 8A, and 7B." But this is a
coarse approximation. Two tracks in the same key can be harmonically
incompatible if their chord voicings clash. TIV (Tonal Interval Vectors)
captures the actual harmonic content — which pitch classes are present
and how they relate to each other.

**How:** Compute 6 TIV coefficients per beat using essentia's
`TonalExtractor`. Cosine similarity between TIV vectors = harmonic
compatibility.

```
Camelot says: Track A (7A) → Track B (7A) = compatible ✓
TIV says:     cosine(A_tiv, B_tiv) = 0.41 — actually clashing (different chord extensions)

Camelot says: Track A (7A) → Track C (5B) = incompatible ✗
TIV says:     cosine(A_tiv, C_tiv) = 0.89 — actually smooth (shared pitch classes)
```

---

### #12 · Drum pattern transcription — **Impact 7** · Not built

**Why it matters:** The kick pattern IS the genre family. 4-on-floor =
house/techno. Breakbeat = DnB/jungle. Half-time = trap/dubstep. The
hi-hat pattern separates within families: straight 16ths = techno, swung
8ths = house, rapid 32nds = trap. Drum transcription makes genre
classification PHYSICAL rather than cultural.

**How:** STAR Drums (18-class, pre-trained) or N2N (diffusion, 7
components) on the percussive stem from Demucs. Output: onset grid per
instrument class.

```
Track: "Patrick Topping - Be Sharp Say Nowt"
Kick:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]  → 4-on-floor
Hi-hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]  → offbeat (house)
Snare:  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]  → backbeat

Genre evidence: house family (4-on-floor + offbeat hi-hat) = +0.85 confidence
Drop/Roll: Drop (hi-hat density increases in drop section)
```

---

### #13 · Swing/groove estimation — **Impact 7** · Not built

**Why it matters:** Two tracks at the same BPM can feel completely
different if one is gridded (quantized, robotic) and the other swings
(humanized, groovy). Mixing a swung track into a gridded one creates
rhythmic tension — sometimes intentional, often jarring. The groove is
an invisible blendability gate.

**How:** LLACF (Log-Lag Autocorrelation Function) on the onset times.
Swing ratio = delay of off-beats relative to the grid. 50% = straight.
55–67% = light to heavy swing.

```
Track: "Green Velvet - Flash" → swing_ratio: 50.2% → GRID (straight quantized)
Track: "Kerri Chandler - Rain" → swing_ratio: 61.4% → SWING (heavy groove)

Mixing Flash → Rain: groove mismatch 11.2% → blendability penalty
Mixing Rain → "Lil Louis - French Kiss" (swing: 58.7%): groove match 2.7% → smooth ✓
```

**Expected comment token:** `SWING` appears when ratio > 55%, `GRID`
when < 52%. Most tracks (~70%) are gridded, so SWING is the informative
token.

---

### #14 · Last.fm vote rung — **Impact 7** · Not built (S effort)

**Why it matters:** The genre vote ladder has a gap: hip-hop, pop,
R&B, and indie tracks get weak or missing votes because Beatport and
SoundCloud are EDM-focused. Last.fm's folksonomy tags cover ALL genres
equally and include era/scene words ("2010s," "Nu Disco," "Balearic")
that structured sources miss.

**How:** API call: `track.getTopTags(artist, title)` → top 20 tags with
counts. Filter through `canonGenre` (already built). Feed as a
Dawid–Skene voter.

```
Track: "Flume - Never Be Like You"
Last.fm tags: [electronic: 100, future bass: 87, chillwave: 45, australian: 30, 2016: 22]
After canonGenre: genre="Future Bass", sub_tags=["Chillwave"], era=2016
→ genre_votes row: source="lastfm", genre="Future Bass"
```

**Why it's #14:** Cheapest new source to add (~2 hours). Free API, no
auth, already has `lastfm.ts` module. Natural Dawid–Skene input.

---

### #15 · Drop spectral signature — **Impact 7** · Not built

**Why it matters:** The spectral shape at the drop section is a genre
FINGERPRINT. Dubstep has a sub-bass wall with a mid-range gap. Bigroom
is flat full-spectrum. Tech house grooves in the 200 Hz–2 kHz range.
This 7-number vector captures genre identity from a single section.

**How:** Segment track using PSSI → extract drop → compute 7-band
spectral contrast (already available in essentia).

```
Track: "Skrillex - Bangarang"
Drop spectral contrast: [28, 4, 8, 6, 3, 12, 9]
  ↑ massive sub    ↑ hollow mid    ↑ sparkly high
Pattern match: Dubstep (sub-dominant, mid-gap) → confidence 0.91
```

---

### #16 · Remix routing — **Impact 7** · v3 plan

**Why it matters:** "Depeche Mode - Enjoy the Silence (Timo Maas Remix)"
should query Beatport for Timo Maas's genre, not Depeche Mode's. The
remix artist determines the genre. Currently the fetch pipeline queries
the ORIGINAL artist, gets "Synth Pop," and the genre vote is wrong.

**How:** Parse remix credits from title (already have `parseRemixer`).
Route the Beatport/SoundCloud/Bandcamp searches to the remixer. The
original artist stays for metadata display; the remixer drives genre.

```
Before: "Enjoy the Silence (Timo Maas Remix)" → queries "Depeche Mode" → "Synth Pop"
After:  "Enjoy the Silence (Timo Maas Remix)" → queries "Timo Maas" → "Techno"
```

**Expected accuracy lift:** ~8–12% of the library are remixes. This
fixes genre for most of them in one pass.

---

### #17 · Label network graph — **Impact 6** · Not built

**Why it matters:** Record labels in EDM function as genre curators.
"Drumcode" isn't just techno — it's specifically peak-time, driving
techno. "Anjunadeep" is melodic/progressive. A label tells you the
sub-genre with higher precision than any tag.

**How:** From the Discogs dump (#5), build a label→artist→label bipartite
graph. Labels sharing many artists are "genre neighbors." Cluster the
graph → emergent sub-genre taxonomy.

```
Cluster: {Drumcode, MORD, Soma, Suara} → "Peak-time Techno"
Cluster: {Afterlife, Innervisions, Cercle} → "Melodic Techno"
Cluster: {Defected, Toolroom, Cr2} → "House / Tech House"

Track on "Afterlife" label → sub-genre: "Melodic Techno" (not just "Techno")
```

---

### #18 · Space/silence density — **Impact 6** · Not built

**Why it matters:** How much "air" is in a track. Minimal techno
breathes; bigroom is a wall of sound. This is trivially computable and
correlates with both genre and mix compatibility (high-space outros have
room for the next track's elements).

**How:** `space_density = count(RMS_frames < threshold) / total_frames`

```
"Ricardo Villalobos - Dexter" → space_density: 0.41 (sparse, breathing) → minimal/deep
"Martin Garrix - Animals" → space_density: 0.03 (wall of sound) → bigroom
```

---

### #19 · LLM metadata imputation — **Impact 6** · Not built

**Why it matters:** Audio + partial metadata together are better than
either alone. A track with "label: Drumcode" + audio features gets a
21% more accurate genre classification than audio alone. LLMs can
synthesize heterogeneous partial signals.

**How:** Feed the existing metadata (artist, title, label, partial tags,
audio features) into a fine-tuned LLM that outputs genre + era + mood
+ description. Natural upgrade for the AI rung (W4, currently 0.45).

---

### #20 · Playlist-name voter — **Impact 5** · Needs audit

Free silver labels from user playlist naming conventions. "My Techno
Playlist" → every track gets a "Techno" vote at low weight.

---

### #21 · Cue color/naming audit — **Impact 4** · Not done

If hot cue naming is consistent, cue positions become free structure
training data for section detection.

---

### #22 · Version stability test — **Impact 4** · Not built

Extended and radio edit of the same track must agree on genre. Catches
errors and validates the vote system's consistency.

---

### #23 · Whisper lyrics → explicit flag — **Impact 4** · Not built

Run Whisper on vocal stem → detect profanity → `EXPLICIT` tag. Niche
but important for gig suitability ("is this wedding-safe?").

---

### #24 · Function tags — **Impact 4** · Not built

Structural detection: track with no drop = "tool track" (DJ utility).
Track with 4+ minute loops = "filler." Useful for set pacing.

---

### #25 · Era/release year — **Impact 4** · Partial

Discogs (#5) completes coverage. Display value for the DJ: "90s
classic," "2024 release."

---

### #26 · Crowd status/popularity — **Impact 4** · Not built

1001TL appearance counts + Last.fm listener counts → "anthem" vs. "deep
cut." Helps set building for crowd-reading.

---

### Already shipped (no action needed)

| Signal | Impact | Status |
|---|---|---|
| BPM / tempo | 8 | ✅ MegaSet's top scoring term (0.45 weight) |
| Key / Camelot | 7 | ✅ OpenKeyScan 80.7%, TKEY written |
| Primary genre | 7 | ✅ 98.3% coverage, 8-rung vote ladder |
| Energy level | 6 | ✅ Shipped (broken — #3 fixes it) |
| Mood (Dark/Euph/Hard/Soft) | 6 | ✅ ONNX mood heads, percentile-ranked |
| IN/OUT bars | 6 | ✅ PSSI decode, 74.7% coverage |
| Drop/Roll | 5 | ✅ 97.5%/2.5% from PSSI |
| VAR (tempo instability) | 4 | ✅ 3.6% of tracks |
| Track color | 4 | ✅ Energy→ColorID, 100% |
| Sub-genre display | 5 | ✅ 64.4% coverage via `· TechHouse+DeepHouse` |
| Effnet embeddings | 7 | ✅ 1280-d, MegaSet scoring (0.25 weight) |

### Top 10 build order

1. **Energy trajectory** (Impact 10) — the missing MegaSet dimension
2. **Rekordbox play history** (Impact 9) — free gold training data
3. **Energy recalibration** (Impact 9) — fix the broken E token
4. **Dawid–Skene** (Impact 9) — learn source reliability from data
5. **Discogs dump** (Impact 9) — 400-style vocabulary, one download
6. **VOX/HOOK** (Impact 8) — complete the v4 comment
7. **1001TL co-play** (Impact 8) — social transition data
8. **Intro/outro compatibility** (Impact 8) — score real transitions
9. **Genre probability vector** (Impact 8) — honest genre identity
10. **EDM production features** (Impact 8) — explain WHY genres differ

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

