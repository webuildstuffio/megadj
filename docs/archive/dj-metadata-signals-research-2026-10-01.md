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

| # | Original claim | Verdict against shipped system |
|---|---|---|
| 1 | "Mine rekordbox playlists, history, cues first" | **Partly done.** Cues are ledgered (22 avg/track), energy uses analysis data, play history is in master.db but NOT YET mined as a signal for MegaSet transitions or genre evidence. Playlist-name-as-voter is not wired. |
| 2 | "DJ co-play graph from 1001Tracklists is highest-value external signal" | **Genuinely new.** Not in the codebase, not in any issue. The social-embedding idea (node2vec over co-play edges) is architecturally sound and would give MegaSet a transition signal that audio embeddings fundamentally cannot provide. Worth a GitHub issue. |
| 3 | "Discogs + Beatport best labelers, Last.fm + MB as supporting" | **Mostly shipped.** Beatport (W3, weight 0.60), Bandcamp (W2b, 0.50), MusicBrainz (W5, 0.40), SoundCloud (W2, 0.35) are all live rungs. Discogs is NOT a current rung — the Discogs monthly dump is proposed in v3 (§4 of the landscape doc). Last.fm is not wired at all — genuinely new. |
| 4 | "Use Dawid–Skene instead of hand-labeled gold" | **Already the v3 plan of record.** The v3 landscape doc (Sep 28) proposes exactly this: `crowd-kit` Dawid–Skene over family-level evidence, replacing the fixed W-table. See `fulltags-v3-landscape-and-redesign-2026-09-28.md` §4. |
| 5 | "SoundCloud/Bandcamp/LLM are second-wave" | **Outdated.** SoundCloud is a first-class download AND genre source (shipped Sep 19, W2 rung). Bandcamp is live as W2b (shipped Sep 15). LLM genre (W4 AI rung) is opt-in, off by default. These are not second-wave — they are production. |
| 6 | "Spotify is out" | **Correct and irrelevant.** Audio features API removed Nov 2024. megadj has never used Spotify. |

---

## 2. What DJs actually do — reference taxonomy

This section has genuine reference value for booth comment design and the
Set builder's UX language. Cross-referenced with megadj's v4 comment format:

| DJ axis | v4 comment coverage | Status |
|---|---|---|
| Genre / sub-genre | `· MelTechno+DeepHouse` (after `·`) | ✅ Shipped — 64.4% have subgenre |
| BPM | Omitted from comment (own RB column) | ✅ Correct by design (invariant #11) |
| Key | Omitted from comment (own RB column) | ✅ Correct by design |
| Energy / set role | `E1–E9` percentile-ranked | ✅ Shipped — 100% coverage |
| Vibe / crowd feel | `Hard/Soft` + `Dark/Euph` | ✅ Shipped — mood-derived, ~40% coverage |
| Vocal status | `VOX/HOOK` | ❌ **Last remaining v4 token** — needs Demucs pipeline |
| Function (tool/filler) | Not represented | ❌ Not planned — structural detection needed |
| Era | Not in comment; release year in archive.db | Partial — 60–85% year coverage |
| Gig context | Not in comment | N/A — personal, not computable |
| Track colour | Energy band → ColorID | ✅ Shipped — 100% coverage |
| Mix notes (intro/outro bars) | `IN:32 OUT:16` | ✅ Shipped — 74.7% coverage from PSSI |
| Drop/Roll | `Drop` or `Roll` | ✅ Shipped — 97.5%/2.5% of IN/OUT tracks |

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

| # | Signal | Original | Reality (Oct 1 2026) |
|---|---|---|---|
| 1 | Energy | "Yes, after calibration" | ✅ SHIPPED but known-broken: loudness meter, not perceptual energy. v3 §5 proposes pairwise calibration on drop sections. |
| 2 | Key / Camelot | "Already solved" | ✅ SHIPPED: OpenKeyScan 80.7% exact, TKEY written, RB gauntlet pending next drive mount. |
| 3 | Vocal status | "Yes, Demucs" | ❌ NOT SHIPPED: last v4 token. v4-remaining-plan proposes Demucs htdemucs_ft batch (~3h GPU). |
| 4 | Mix notes | "Yes, phrase+grid+vocal" | ✅ SHIPPED: `IN:32 OUT:16` from PSSI decode. 74.7% coverage. |
| 5 | Sub-genre | "Partly, audio+Discogs+BP" | ✅ SHIPPED: 8-rung vote ladder, 73 distinct labels, 98.3% primary coverage, LOO 66.6% gated. |
| 6 | Vibe / mood | "Partly" | ✅ SHIPPED: ONNX mood heads (happy/sad/aggressive/relaxed/party), within-family percentile → `Hard/Soft`, `Dark/Euph`. |
| 7 | Function (tool/filler) | "Partly" | ❌ NOT BUILT: structure detection (no drop, percussive, long loops) needs dedicated classifier. Low priority — §6 below. |
| 8 | Crowd status | "Partly, 1001TL + chart" | ❌ NOT BUILT: no external popularity signal wired. 1001TL co-play is the interesting part — §6.3 below. |
| 9 | Era | "Yes, release year" | ✅ PARTIALLY: year from SC/BP/BC/file tags. Discogs dump (v3 proposal) would improve coverage. |
| 10 | Tempo issues | "Yes, grid changes" | ✅ SHIPPED: `VAR` token in v4 comment (3.6% of tracks, `bpm_residual_std > 15.0`). |
| 11 | Pairings | "Yes, history + 1001TL" | ❌ NOT BUILT for history-derived. MegaSet uses embedding similarity (cosine + tempo/key gates), not play-history evidence. The co-play graph is §6.3. |
| 12 | Played at | "Yes, RB history" | ❌ NOT MINED: rekordbox history tables exist in master.db but are not read by any megadj command. |
| 13 | Source / version | "Partly" | ✅ PARTLY: title parsing (`splitArtistFromTitle`), Beatport mix name/remixer credit (TXXX:BP-FIELDS), `[archive]`/`[BACKUP]` artifact filtering. |
| 14 | Instrumentation | "Partly" | ❌ SKIPPED: correctly assessed as "often redundant with sub-genre." No plan to build. |
| 15 | Gig suitability | "Partly" | ❌ NOT BUILT: Whisper lyrics → explicit flag is plausible but unplanned. |
| 16 | Personal taste | "No" | Correct — only you. |

**Honest summary:** 8 of 16 signals are shipped, 2 are partially shipped,
6 are unbuilt. Of the unbuilt, only 3 are worth pursuing (vocal detection,
co-play graph, play history mining).

---

## 4. Signal inventory — what's new vs. what's already here

### 4.1 Signals already shipped (the report treats these as proposals)

| Signal | Report says | Real status | Module |
|---|---|---|---|
| Playlist/folder names as voter | "Do first" | NOT wired as a vote rung — but the v3 Dawid–Skene estimator would naturally consume them | — |
| Hot/memory cues | "High value" | Ledgered, consumed by PSSI → IN/OUT/Drop | `src/fulltags/booth/comment-v4.ts` |
| Rating, colour, play count | "High" | Color is written BY megadj (energy→ColorID); rating/play count not consumed | `src/fulltags/booth/track-color.ts` |
| ID3 tags | "Medium-high" | W6 file TCON rung (weight 0.55) | `src/getdat/commands/ingest.ts` |
| rekordbox analysis | "High" | PSSI phrase decode → IN/OUT/Drop/Roll | `src/fulltags/booth/phrase-data.ts` |
| Essentia effnet embeddings | "Already in use" | Correct — 1280-d, ledgered in archive.db | `src/fulltags/analysis/models.ts` |
| Discogs-400 style predictions | "MAEST" | effnet-trained head runs on cached embeddings: 46.1% top-1, ~77% top-5 | `src/core/similar.ts` |
| Demucs stems | "For vocal position" | **NOT shipped.** Planned for VOX/HOOK (v4 remaining). | — |
| CLAP | "Discovery queries" | ❌ Measured worst for kNN, rejected. Text-probe not built. | — |

### 4.2 External sources — what's new

| Source | Report says | Real status | Gap |
|---|---|---|---|
| **Discogs API** | "Do — 60/min, medium-high coverage" | **NOT wired as a vote rung.** The Discogs monthly dump (CC0, offline) is proposed in v3 landscape §2.6 as a new evidence arm. The dump is better than per-track API queries — same data, no rate limits, exact vocabulary match with effnet's training taxonomy. | **v3 WS5** — worth tracking |
| **Beatport** | "Do — high coverage" | ✅ **SHIPPED** as W3 rung (weight 0.60, highest). v4 catalog API via client-credentials. Also fills label/mix name/remixer/ISRC. | None |
| **Last.fm** | "Do (weak voter)" | ❌ **NOT INTEGRATED.** Genuinely new. Free API, `track.getTopTags` returns folksonomy with counts. Useful for hip-hop/pop where SC/BP are weak. The v3 landscape doc mentions it (§2.6) but no code exists. | **New issue candidate** |
| **MusicBrainz** | "Do for entity resolution" | ✅ **SHIPPED** as W5 rung (weight 0.40). Artist folksonomy harvest via `mb-lookup.ts`. | None |
| **1001Tracklists** | "Do carefully — co-play graph" | ❌ **NOT BUILT.** Genuinely new idea. See §6.3 analysis below. | **New issue candidate** |
| **SoundCloud** | "Phase 2" | ✅ **SHIPPED** — first-class download source AND W2 genre rung (weight 0.35). HLS AAC 256k with Plus auth. | None |
| **Bandcamp** | "Phase 2" | ✅ **SHIPPED** as W2b rung (weight 0.50). Autocomplete search + page parse for genre/year/label/art. | None |

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

| Report concept | v3 plan reference |
|---|---|
| Dawid–Skene over noisy voters | v3 landscape §4: `crowd-kit` Dawid–Skene, GLAD, MACE |
| Per-source reliability | v3 landscape §4: learned per-source × per-family reliability |
| "Leave one source out" validation | v3 landscape §4.5: independent answer keys replace self-referential LOO |
| Bootstrap 95% CIs + McNemar | Already shipped in `genre --eval --diagnostics` |
| Version stability | Not currently tested — worth adding to the eval harness |

The report's specific contribution beyond v3: **the version stability test**
(extended mix and radio edit must get the same genre). This is a good
invariant that's not in any current test.

---

## 8. Entity resolution — what's shipped vs. proposed

The report's entity resolution scheme:

| Step | Report | Shipped? |
|---|---|---|
| ISRC first → MB → Discogs/BP | Use ISRC from ID3 | ✅ ISRC read from ID3 (TSRC) + Beatport (TXXX:BP-FIELDS). MB fingerprint → MBID. Discogs lookup NOT wired. |
| Artist+title normalization | Strip qualifiers, keep remixer | ✅ `splitArtistFromTitle`, `parseFilename`, `nameTokens`/`artistGate` in `name-match.ts` (SSOT). |
| Version-aware matching | Extended/radio share genre; remix may not | ⚠️ PARTLY: title parsing handles remix credit, but genre routing does NOT query the remixer's artist tags — this is the "remix routing" gap called out in v3 §4. |
| Confidence per match | Below threshold → no data | ✅ Hard artist gate (`scoreBpHit`, `scoreScHits`, `scoreBcHits`) enforces match quality. |

**The real gap:** remix routing. Artist-level sources (MB folksonomy, SC
uploader tags) query the ORIGINAL artist for remixes, but the remixer's
style is what matters. The v3 plan (§4) proposes routing artist-level
sources by remixer — this is the single highest-value entity resolution
fix remaining.

---

## 9. LLMs — honest assessment

The report's LLM assessment is sound and matches the shipped system:

| Use | Report | System |
|---|---|---|
| Normalize free text → vocabulary | "Yes" | ✅ `canonGenre` does this mechanically; AI rung (W4) is the LLM fallback, opt-in and off by default. |
| Name unknown clusters | "Yes" | Not built — the #62 cluster-proposed-labels issue is the closest. |
| Resolve entity matches | "Yes, with confidence" | Not built — entity resolution is deterministic (name-match gates). |
| Audio description | "Low priority" | Correct — no audio-language model in the pipeline. |
| Be the genre labeler | "No" | ✅ Correct — AI rung (W4) is the LOWEST catalog rung at 0.45, opt-in. |

---

## 10. Coverage and accuracy — measured vs. estimated

The report gives "planning estimates." Here are the MEASURED numbers
(Oct 1 2026, from `genre-system.md` §12 + v4 comment stats):

| Output | Report estimate | Measured | Source |
|---|---|---|---|
| Family genre | ~85–95% | 93% family coverage (63 unmapped/265 rows) | `genre-system.md` §12 |
| Style (sub-genre) | 60–75% | 64.4% (subgenre in v4 comment) | `v4-remaining-plan` |
| Primary genre | — | 98.3% (4,487/4,566) | `genre-system.md` §12 |
| Secondary genre | — | 60.1% (2,744/4,566) | `genre-system.md` §12 |
| LOO agreement | — | 66.6% gated (≥65% PASS) | `genre-system.md` §9 |
| Vocal position | ~100% | ❌ 0% (not shipped) | `v4-remaining-plan` |
| Intro/outro bars | ~100% | 74.7% (2,731/3,658) | `v4-remaining-plan` |
| Energy band | ~100% | 97.9% (4,468/4,566) | `genre-system.md` §12 |
| Discogs match | 50–75% | NOT MEASURED (Discogs not wired) | — |
| Beatport genre | 60–85% | NOT SEPARATELY MEASURED (part of W3) | — |
| Last.fm tags | 20–50% | 0% (not wired) | — |
| 1001TL appearances | 30–60% | 0% (not built) | — |
| Release year | 60–85% | NOT SEPARATELY MEASURED | — |

**Report's coverage estimates are in the right ballpark** for what's
shipped. The 98.3% primary genre coverage exceeds the report's family
estimate because the 8-rung vote ladder (especially the 0.60-weight
Beatport rung and the 0.55-weight file TCON rung) provides broader
coverage than the report anticipated.

---

## 11. Effort estimates — reality check

The report's effort estimates for external lookups assume a fresh build.
Several are already done:

| Step | Report estimate | Reality |
|---|---|---|
| Discogs search + release | ~2h | NOT STARTED — the v3 plan proposes the CC0 monthly dump instead (offline, no rate limits, ~15 min ingest on M1). The dump is strictly better than 7,600 API calls. |
| MusicBrainz lookup | ~1h | ✅ DONE — `mb-lookup.ts` already harvests for every `megadj enrich` run. |
| Last.fm track + artist tags | < 1h | NOT STARTED — genuine S-effort task. |
| Beatport lookups | 1–3h | ✅ DONE — W3 rung fires on every `megadj fetch`. |
| 1001TL appearances | 1–2 overnight | NOT STARTED — effort estimate is reasonable for a bounded crawl. |
| MAEST over library | Hours | 🧪 5-model section embedding bench was JUST committed (latest commit). Full library run not done. |
| Demucs stems | Overnight | NOT STARTED — v4-remaining-plan estimates ~3h GPU / 2min×3600=120h CPU. |
| Whisper lyrics | Hours | NOT STARTED — low priority. |

---

## 12. The report's "recommended plan" vs. reality

| Phase | Report | Status | Next action |
|---|---|---|---|
| 1. Own data | Mine playlists, history, cues, ratings, colours | Cues ✅, energy ✅, colours ✅. **History NOT mined, playlists NOT mined.** | File issue: mine RB play history for MegaSet transitions |
| 2. Official APIs | Discogs, MB, Last.fm with entity resolution | MB ✅. **Discogs NOT wired. Last.fm NOT wired.** | v3 WS5 (Discogs dump). New issue for Last.fm. |
| 3. Label model | Dawid–Skene over all voters | **v3 plan of record.** Not started. | v3 WS4 |
| 4. Co-play | 1001TL crawl | **Not started.** | New issue for exploration |
| 5. Fusion | Audio + social embeddings + label posteriors | Theoretical — depends on phases 3+4 | — |
| 6. Second wave | SC/BC tags, LLM naming | SC ✅, BC ✅. LLM naming not built. | #62 cluster-proposed labels |

---

## 13. Open questions — answered

| Question | Answer |
|---|---|
| "Do your rekordbox playlist names carry genre or role meaning?" | **Audit needed.** Run `SELECT Name, COUNT(*) FROM djmdPlaylist GROUP BY Name` on master.db. If ≥ 10 playlists have genre-meaningful names, wire as a voter. |
| "How many tracks have ISRC in ID3 tags?" | **Measurable.** `SELECT COUNT(*) FROM tracks WHERE isrc IS NOT NULL` on archive.db. Beatport fills ISRC via TXXX:BP-FIELDS for matched tracks. |
| "Comfortable with personal-use 1001TL crawl?" | **Owner decision.** The ISMIR team got data via direct contact — worth asking before crawling. |
| "Should MegaSet learn from your transitions or public ones?" | **Both, per MegaSet v2 architecture invariant #1:** your history as a hard prior, public co-play as a soft (capped ≤ 0.1) signal. |

---

## 14. Roadmap-actionable items (new work only)

Extracted from this analysis. Items that are already in the v3 plan or
existing issues are cross-referenced, not duplicated.

### New issue candidates

| # | Item | Effort | Value | Cross-ref |
|---|---|---|---|---|
| A | **Mine rekordbox play history** — extract real transitions from `djmdHistory`/`djmdSongHistory`, store in archive.db, use as MegaSet transition evidence | S | Very high | MegaSet v2 §4a |
| B | **Last.fm vote rung (W8)** — `track.getTopTags` + `artist.getTopTags`, map through `canonGenre`, weight ≤ 0.30 | S | Medium | v3 landscape §2.6 (mentioned, not tracked) |
| C | **1001Tracklists co-play exploration** — personal-use bounded crawl for library tracks, co-play edge table, social embedding (node2vec) | L | High for MegaSet | Novel |
| D | **Playlist-name audit** — are your rekordbox playlist names usable as genre voters? One-time audit. | XS | Gate for item E | — |
| E | **Playlist-name vote rung** (if D passes) — inject playlist membership as evidence into the vote ladder or v3 estimator | S | Medium | — |
| F | **Version stability test** — add to genre eval: extended mix and radio edit of the same song must get the same genre | XS | Low but correct | — |

### Already tracked (do not duplicate)

| Item | Where tracked |
|---|---|
| Discogs monthly dump as evidence arm | v3 WS5 |
| Dawid–Skene label model | v3 WS4, epic #346 |
| Independent answer keys | v3 WS4 §4.5 |
| Remix routing for artist-level sources | v3 §4 |
| VOX/HOOK vocal detection | v4-remaining-plan §1 |
| Energy recalibration | v3 landscape §5 |
| Cluster-proposed labels | #62 |

---

## 15. Sources (original, preserved)

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
