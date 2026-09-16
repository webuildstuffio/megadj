# MegaSet — Competitive Analysis

**Status:** 📚 REFERENCE — 30-comparator analysis and measured v1 roadmap.

v1 · 2026-09-14 · **Analysis** → [PRD](01-prd.md) · [Audit & plan](08-audit-and-plan.md)

> Glossary: [10-findings §5](10-findings.md#5-glossary--every-acronym-and-term-used-across-the-doc-set).

Thirty comparators in three classes: **10 open-source** projects
(feature-adjacent, small), **10 commercial** products (the market MegaSet
would compete in), and **10 dream/concept ideas** (research, papers, and
community concepts that show where the category is going). Status and
pricing verified 2026-09-14. Sequencing-algorithm claims (greedy vs exact
vs repair) are measured in [04-sequencing-benchmarks (archived)](../archive/set-04-sequencing-benchmarks-2026-09-14.md).

**Why compare at all?** Each comparator pins one design decision: OSS
projects prove an algorithm is buildable at toy scale; commercial products
show what the market pays for (and what it still gets wrong); dream ideas
mark the category's direction. MegaSet's edge is deliberately **not** any
single feature — it's the integration: measured local analysis, an agent
surface, deterministic proposals, and a safety-gated write path, in one
local-first pipeline nobody else combines (Part 4's matrix is the evidence).

---

## Part 1 — Open-source comparators (deep dive in the [audit](08-audit-and-plan.md) §2)

Summarized here for the matrix; full per-project analysis lives in the audit.

| #   | Project                                                               | What it proves                                                              |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | [djkr8](https://github.com/schoi80/djkr8)                             | CP-SAT global sequencing, energy-flow constraints, reads RB via pyrekordbox |
| 2   | [harmonic-flow (HarmonySet)](https://github.com/roneni/harmonic-flow) | Held-Karp exact DP ≤20 + 2-opt, quality score 0–100                         |
| 3   | [spotify-mixmaster](https://github.com/gnujoow/spotify-mixmaster)     | beam search, YAML energy curves, landmark seeds, N-candidates               |
| 4   | [mcp-dj](https://github.com/darav-t/mcp-dj)                           | MCP-native explainable sets, 5 arc profiles, NL front end                   |
| 5   | [digcrate](https://github.com/fungiblemoose/digcrate)                 | local analysis + LLM planning split, bridge-track gap filling               |
| 6   | [open-crate](https://github.com/raullee/open-crate)                   | swappable SetGenerator strategy, lock-and-regenerate UX                     |
| 7   | [pulsegrid](https://github.com/ysy-ym/pulsegrid)                      | per-pair cue→cue handoff planning, transition audit                         |
| 8   | [cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio)    | 11 guarded transition recipes, fail-closed gating, evidence logs            |
| 9   | [auto-dj-ai](https://github.com/caffettino87/auto-dj-ai)              | LUFS normalization, anti-vocal-clash scoring, octave BPM                    |
| 10  | [Mixxx AutoDJ](https://github.com/mixxxdj/mixxx)                      | the playlist-consumer contract: intro/outro fade semantics                  |

---

## Part 2 — Commercial products

### 2.1 [DJ.Studio](https://dj.studio) — the direct commercial twin · ALIVE

Timeline-based set-building studio (the modern MixMeister). **Harmonize**
engine orders a playlist by key+energy using Camelot-wheel rules, scores
"millions of combinations", respects locked tracks when re-running, suggests
**bridge tracks** from your library to fill awkward harmonic gaps, lets you
pin opener/closer and tune a BPM↔key weighting slider, then exports
cue-marked playlists to rekordbox/Serato/Traktor/Engine DJ or renders the
mix. Integrates Mixed In Key (imports MIK cue points + energy levels).
Pricing: subscription or perpetual licence (frequent promos; ~€33/mo headline
sub). **Parity check:** Harmonize ≈ our engine + B5 lookahead + bridge-track
gap-fill (digcrate's lesson) + timeline editing; they have nothing we lack on
analysis depth (no embeddings, no phrase data), but their _editing surface_
(timeline, audition each transition) is far ahead of our table UI.

### 2.2 [Mixed In Key](https://mixedinkey.com) — analysis standard · ALIVE

The harmonic-mixing incumbent (v10+). World-reference key detection, Camelot
notation (we adopted their wheel), per-track **energy level 1–10** plus
within-track energy segments, cue-point suggestions. Not a planner: it
analyzes and tags; ordering happens elsewhere. ~$58 perpetual (loyalty
discounts) or the Suite. **Parity check:** our TKEY + mood ledger covers
key/energy analysis locally; MIK's energy is 1–10 _ordinal human-ish_ vs our
continuous arousal — their segment-level energy map is what our cues ledger
could derive. No write-off story, no MCP.

### 2.3 [Djoid](https://www.djoid.io) — AI set planning SaaS · ALIVE

Curation-first planner: **Chapter Builder** segments a set into 3–20-track
"energy blocks" (hypnotic/trippy/emotional/euphoric), visual track-relationship
mapping, AI genre-distribution analysis, export chapters as ready-to-play
crates to rekordbox/Serato. €99/year, 1 device. **Parity check:** chapter
blocking = our arc segments with vocabulary DJs actually use; a strong Phase-C
UX model (block-level building before track-level filling). Subscription-only,
closed, cloud AI — our local+deterministic stance is the counter-position.

### 2.4 [SetFlow](https://www.setflow.app) — micro-SaaS set generator · ALIVE

Web app: point it at Rekordbox XML/Traktor NML/Serato folder, pick one of 5
energy archetypes (journey/peak/warm-up/chill/cool-down), get a "fully mixed
set in under 3 seconds" — every transition graded key/BPM/energy, ±3% tempo
tolerance, anchor-track pinning, minute-planned sets, exports to
Rekordbox/M3U8/PDF/TribeXR, plus Smart Crates Pro and a gig calendar.
£0 trial / £2.99 / £4.99 per month, Weekend Pass £2.99 one-time. Reported
~$399 MRR (Mar 2026) — proof the category is real but small. **Parity
check:** nearly feature-identical to our v0+plan (archetypes ≈ presets,
anchors ≈ landmarks, graded transitions ≈ explain payload); they charge and
people pay. Their 3-second claim fits our 6 ms engine + pool load.

### 2.5 [Lexicon](https://lexicon.dj) — library management layer · ALIVE

DJ library manager across rekordbox/Serato/Traktor/VirtualDJ/Engine DJ/djay:
conversion (now free), tag cleanup, fingerprint dedupe, auto cue points,
smartlist designer that converts rules across apps (with a per-app
compatibility indicator). Essential/Ultimate tiers + lifetime options.
**Parity check:** not a planner, but its smartlist rule-conversion matrix is
the honest map of _what each platform can even express_ — our rb-playlist
gates encode the rekordbox column. Their genre-cleanup tools mirror our 440-genre fragmentation problem.

### 2.6 [rekordbox](https://rekordbox.com) (Pioneer DJ) — the platform gravity · ALIVE

The collection SSOT and every set's final home. MegaSet-adjacent helpers:
**Related Tracks / Track Suggestion** panels (same key/BPM/era/mood relative
to the loaded track), My Tags, playlist export mechanics, and the CDJ reality
that a playlist is just an ordered list — no arc, no transitions. **Parity
check:** we deliberately live _on top of_ rekordbox (mirror → propose →
rb-playlist write-off) rather than competing with it; rekordbox itself never
orders a set.

### 2.7 [Serato DJ Pro](https://serato.com) + Smart Crates · ALIVE

Rule-based auto-populating crates ("genre contains house AND bpm 120–128 AND
key 9A") — filtering, not ordering. Serato's own stack has no arc engine.
**Parity check:** our pool filters are the same shape; their Smart Crate UX
(saved named rules that live-update) is worth borrowing for pool presets.

### 2.8 [VirtualDJ](https://virtualdj.com) — LiveFeedback + GeniusDJ · ALIVE

In-the-moment suggestions: **LiveFeedback** recommends what other DJs most
often played after the current track (crowd-sourced co-occurrence, needs
internet, up to 50 results); GeniusDJ layer adds similar-track suggestions
and automix. **Parity check:** co-occurrence is a data source we don't have
(and ethically won't scrape), but the UX — recommendation _while_ something
plays — previews what a MegaSet "live mode" would feel like. Notably,
VirtualDJ never plans the whole set either.

### 2.9 [Engine DJ](https://enginedj.com) (Denon/InMusic) — Smartlists on hardware · ALIVE

OS layer for standalone players: **Smartlists** (rule-based lists synced to
hardware), waveform/beatgrid analysis. No ordering intelligence. **Parity
check:** the hardware-consumption end of the market; our M3U8 consumer
contract (Phase D) is what would make a MegaSet export playable on Denon
gear, not just CDJs.

### 2.10 [MixMeister](https://www.mixmeister.com) — the ancestor · END-OF-LIFE

Released ~2000; pioneered non-linear timeline mix creation (arrange tracks on
a timeline, automate volume/EQ/filter transitions, render the mix) — the
product DJ.Studio openly calls its inspiration. Analysed tempo/key but **no
arrangement suggestions**. Sold historically at $200–230 (Studio); got a
2023 64-bit reprieve but is officially end-of-life with no feature updates.
**Parity check:** the cautionary tale — timeline editing without smart
ordering aged out. MegaSet's bet is the reverse: ordering intelligence first,
editing delegated to rekordbox itself.

---

## Part 3 — Dream ideas, research & concepts

These aren't products you can buy; they're the ideas the category keeps
re-inventing. Each mapped to what MegaSet would steal.

### 3.1 The "opening trifecta" heuristic

Community folklore (r/DJs, DJ Techtools threads): a set opener should be
(same genre as the room expects) + (mid energy, not the lowest) + (strong
recognizability hook). No software models it. **Steal:** extend the opener
guard beyond tempo-neighborhood with a `familiarity` prior once play-history
exists (the §M64 dream) — for now, an explicit `--opener` remains the DJ's
override.

### 3.2 Energy as a _curve over time_, not a per-track scalar

Research-grade mixing papers (e.g. auto-mixing literature from
ISMIR/MIREX workflows) model set energy as a continuous target function and
solve for the sequence minimizing curve distance — vs our discrete
slot-envelope sampling. **Steal:** Phase B's valence axis plus Phase D's
phrase data make a true continuous arc tractable; keep the envelope sampling
but at bar resolution inside the handoff layer.

### 3.3 Vocal-occupancy planning

auto-dj-ai's Demucs trick generalized: plan transitions so two vocals never
overlap by scoring the _next_ track's intro against the _current_ track's
remaining vocal density. **Steal:** Phase D mixIn/mixOut windows should
carry a vocal-risk flag before we'd ever automate a handoff; scoring stays
propose-only.

### 3.4 Loudness-matched journeys

Club reality: a set perceived as "one journey" is largely a loudness-stable
set (±3 LU across transitions). No planner scores LUFS continuity.
**Steal:** the Phase-B `megadj loudness` pass earns its keep here — a
soft penalty on >6 LU steps, and the payload flags tracks that will sound
like a volume jump.

### 3.5 Crowd-response feedback loops

The hit-predictor dream (§M64) inverted: instead of predicting hits, learn
each _room's_ response — which proposed transitions actually got played
through, which got skipped at the booth. Requires play-history data we
deliberately don't collect yet. **Steal:** keep rb-playlist's dated
proposals; they're the future training labels if the user ever opts in.
_(Private telemetry stays off — but the [co-occurrence lane](../archive/set-04-sequencing-benchmarks-2026-09-14.md#part-5--co-occurrence-from-public-tracklists-the-light-data-design)
gets the same signal from public editorial tracklists instead: no
surveillance, and useful from ~10k matched rows.)_

### 3.6 The "set grammar" idea

cuefield's 11 recipes hint at it: transitions have _types_ (long blend,
cut on the 4th, double-drop, breakdown mix), and a good set has a _grammar_
of when each type is legal. PulseGrid parameterizes the handoff; cuefield
gates it. **Steal:** Phase D's mixOut/mixIn should be typed, not just
positioned — `#EXTREM` comment carries the recipe name so the export is
readable by a human at the booth.

### 3.7 Zero-click set drafts from calendar context

Djoid's implicit promise and every "AI DJ" pitch deck: "it's Friday 22:00,
warmup slot at a house room — here's your 60 minutes." All context, no
prompt. **Steal:** trivially reachable through our MCP surface — an agent
with calendar + venue notes composes the `megaset` call. No product code
needed; document the pattern in the skill.

### 3.8 Cross-DJ federation

Multi-DJ lineups: each DJ's crate is private, but the _handoff_ between
sets (last 2 tracks of DJ A, first 2 of DJ B) could be negotiated
harmonically without exposing libraries. Nothing real exists; Lexicon's
conversion matrix shows why (no shared schema trust). **Steal:** out of
scope for a single-DJ tool, but the M3U8 consumer contract keeps the door
open — a handoff file is just a set with two landmarks.

### 3.9 Generative transition audio

The studio dream: synthesize a real 32-bar transition (FX, fills, EQ
automation rendered to audio) between two tracks, producing a continuous
master. MixMeister automated _parameters_; this generates _sound_. Stem
separation makes it plausible (djay Pro's NeuralMix is adjacent in live
form). **Steal:** firmly out of scope (propose-only + hardware-gated), but
Phase D's typed windows are exactly the specification such a renderer would
consume.

### 3.10 The library that plays back

The terminal idea behind CrateDeck + MegaSet combined: the archive
constantly re-verifies itself (bitrot checks), re-analyzes new files, keeps
every set proposal's labels fresh, and answers "what would I play tonight?"
in one query. No product ships the whole loop; everyone owns a fragment
(Lexicon: tags, SetFlow: order, MIK: analysis, rekordbox: playback).
**Steal:** this is literally the megadj architecture — the analysis exists
(FullTags), the verification exists (CrateDeck), MegaSet is the last
proposal layer. The differentiator is integration, which none of the 30
comparators have.

---

## Part 4 — Re-ranked feature matrix

Combining all 30. Columns grouped; ✅ full · 🔶 partial/flagged · ❌ absent.
MegaSet column shows **v0 shipped → v1 plan**.

| Capability                    | **MegaSet**                | OSS best                   | Commercial best                 | Dream          |
| ----------------------------- | -------------------------- | -------------------------- | ------------------------------- | -------------- |
| Own local audio analysis      | ✅ effnet+ffprobe          | digcrate, auto-dj-ai       | Mixed In Key (ref)              | —              |
| Key/Camelot scoring           | ✅                         | djkr8 (3 levels)           | DJ.Studio Harmonize             | —              |
| Energy arc presets            | ✅ 3                       | mcp-dj (5)                 | SetFlow (5), Djoid chapters     | 3.2 continuous |
| Valence/mood 2nd axis         | ❌→✅ B4                   | —                          | —                               | 3.2            |
| Half/double-time BPM          | ❌→✅ B8                   | djkr8, auto-dj-ai          | SetFlow (±3%)                   | —              |
| Tempo-drift budget            | ❌→✅ B2                   | —                          | DJ.Studio (BPM slider)          | —              |
| Arc monotonicity control      | ❌→✅ B3                   | djkr8 constraint           | Djoid chapters                  | 3.2            |
| Diversity (artist/genre)      | ❌→✅ B6                   | mixmaster buckets          | Lexicon (tags only)             | —              |
| LUFS continuity               | ❌→🔶 opt (B11p)           | auto-dj-ai                 | —                               | 3.4            |
| Vocal-clash awareness         | ❌→🔶 Phase D              | auto-dj-ai                 | —                               | 3.3            |
| Lookahead/repair              | ❌→✅ 2-opt                | HarmonySet, mixmaster beam | DJ.Studio ("millions scored")   | —              |
| Landmark/anchor tracks        | opener only →✅            | mixmaster                  | SetFlow pins, DJ.Studio locks   | —              |
| N-candidates compare          | ❌→✅                      | mixmaster                  | —                               | —              |
| Quality score 0–100           | ❌→✅                      | HarmonySet                 | SetFlow grading                 | —              |
| Lock-and-regenerate UX        | ❌→✅ Phase C              | open-crate                 | DJ.Studio locks                 | —              |
| Bridge-track gap fill         | ❌→🔶                      | digcrate                   | DJ.Studio ✅                    | —              |
| Phrase/cue-aware handoffs     | ❌→✅ **Phase D bet**      | pulsegrid, cuefield        | —                               | 3.6 grammar    |
| Explainable transitions       | 🔶 counters →✅            | cuefield, mcp-dj           | SetFlow grades                  | —              |
| Offline / drive-asleep pool   | ❌→✅ B1                   | —                          | —                               | —              |
| Deterministic reproducibility | ✅                         | mixmaster seed             | —                               | —              |
| Write-off to rekordbox        | ✅ gated rb-playlist       | djkr8 XML                  | DJ.Studio (cue-marked), SetFlow | —              |
| M3U8 executable contract      | 🔶 list →✅ windows        | Mixxx semantics            | SetFlow (PDF too)               | 3.6            |
| MCP / agent surface           | ✅                         | mcp-dj                     | ❌ (all closed SaaS)            | 3.7            |
| Timeline transition editing   | ❌ (by design)             | —                          | DJ.Studio ✅✅, MixMeister †    | 3.9            |
| Crowdsourced co-occurrence    | ❌ (won't)                 | —                          | VirtualDJ LiveFeedback          | 3.5            |
| Multi-platform library sync   | ❌ (single SSOT by design) | —                          | Lexicon ✅                      | 3.8            |
| Local-first / privacy         | ✅✅                       | all OSS                    | ❌ except Lexicon/MIK           | —              |

† end-of-life Sep 2023 64-bit reprieve, no further features.

**Read of the matrix:** MegaSet v0 already matches or beats every OSS
comparator on analysis depth, determinism, and write-off gating, and is the
only planner with an agent surface. The commercial set (DJ.Studio, SetFlow,
Djoid) leads on _editing UX_ and _packaging_, not intelligence — and every
one of them is closed and subscription-priced. The open lane: **phrase-aware
handoffs (Phase D) + agent surface + local-first**, which no competitor
combines.

---

## Part 5 — Prioritized roadmap (re-ranked across all 30)

Ranked by (trust unblocked) × (differentiation) ÷ (effort), given everything
observed above. The audit's phase letters are kept where they still apply;
the re-rank moves items across phases.

| #   | Item                                                       | Why now (evidence from the 30)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase            | Size |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---- |
| 1   | **B1 offline mirror pool**                                 | Only differentiator-class fix that unblocks every proposal; all 30 comparators assume online libraries; ours must survive a sleeping NAS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A                | S    |
| 2   | **B2+B3 tempo anchor + arc monotonicity**                  | SetFlow/DJ.Studio/Djoid all sell "energy curve" as the #1 feature; ours can drift 100→188 — table stakes for credibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A                | M    |
| 3   | **Quality score + N-candidates** (C15+C14)                 | SetFlow's "graded set" and HarmonySet's 0–100 are the two most-copied UX hooks; cheap after the engine is pure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | C→**B'**         | M    |
| 4   | **Phase D handoff layer** (16–18)                          | The one lane nobody commercial has (matrix row "Phrase/cue-aware handoffs": only pulsegrid/cuefield, both OSS toys); our 3,605-track cues ledger is unique ammunition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **D'** (the bet) | L    |
| 5   | **2-opt lookahead** (C12)                                  | HarmonySet proved it cheap; DJ.Studio markets "millions of combinations" — we should at least never strand a chain. **Benchmark verdict (04):** +0.0% on big pools — repositioned as free polish; the real small-pool fix is **beam search when pool < ~250** (59% score loss measured there)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | C                | S    |
| 6   | **Valence axis + half/double-time** (B4+B8)                | djkr8/auto-dj-ai treat 2× as table stakes; valence is free data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | B                | M    |
| 7   | **Landmarks + lock-and-regenerate** (C13 + open-crate UX)  | DJ.Studio's locked-tracks re-run is the most-praised workflow feature in reviews; `--track` + `--lock` is the CLI shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | C                | M    |
| 8   | **Diversity guard** (B6)                                   | Requires the genre-refold pass anyway ([genre audit](../fulltags/genre-audit.md): 88% case-duplicate rows, 440→~120 via aliases; embeddings agree with families (39%) not labels (7%) — family-level scoring only); mixmaster's buckets are the floor, not the ceiling. **Prerequisite shipped Sep 15: the refold landed (61.7% → 69.2% gated LOO, census idempotent) — B6 is unblocked**                                                                                                                                                                                                                                                                                                                                                                                                                                                        | B                | S    |
| 9   | **Pool presets à la Smart Crates** (Serato/Lexicon lesson) | Named saved filters ("warmup pool 120–128 + family house") that live-update — cheap, big daily-driver win                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **new**          | M    |
| 10  | **LUFS pass + continuity penalty** (B11p + 3.4)            | Only auto-dj-ai has it; opt-in analysis pass like genre, default off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | B                | M    |
| 11  | **Embedding similarity prior** (B10p)                      | Unique data among all 30; keep the weight small and flag-gated until it proves out in A/B proposals. **Tower verdict measured (Sep 14 v2, n=180, 0 fails): effnet wins both genre agreement (0.444) and retrieval coherence (0.362) — the v1 musicnn lead was a harness artifact; prior stays effnet-only** (fusion sweep settled: best ensemble +1.1 pt — not adopted, see [06](../fulltags/embedding-models.md)). Extended by the [co-occurrence lane](../archive/set-04-sequencing-benchmarks-2026-09-14.md#part-5--co-occurrence-from-public-tracklists-the-light-data-design) — public tracklists (1001TL 260k+, MixesDB API) as a second, independent scene-affinity signal; useful from ~10k matched rows, pair-level steering deliberately never built. **Sep 15: hub tail confirmed; whitened+CSLS retrieval space shipped flag-gated** | B                | S    |
| 12  | **Bridge-track gap fill** (digcrate/DJ.Studio)             | High delight when it lands ("suggest me the glue"); needs B6 families first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | later            | M    |
| 13  | **`pool_hint` + `excluded_groups`** (B12+B13)              | Honesty polish; rides along with #1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A                | S    |
| 14  | **M3U8 executable windows** (18)                           | Completes the consumer contract; pair with #4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | D                | S    |

- 04-sequencing-benchmarks: full engine walkthrough (graph, greedy,
  exact/repair families), E1–E8 measurements (greedy 56% off optimum in
  sparse pools; 2-opt +0.0% at scale — beam-B8 <250-pool rule added to
  the roadmap; exact DP OOMs n=30 while greedy covers n=20k in 157 ms),
  and the co-occurrence lane: public tracklists as light data
  (~150 B/row), useful from ~10k matched rows, pair-steering never.
- embedding-models v2 (now [docs/fulltags/embedding-models.md](../fulltags/embedding-models.md)):
  the tower question is measured — effnet wins
  genre agreement AND retrieval coherence at n=180 with 0 fails; the v1
  musicnn lead was a broken-harness artifact. B10p stays effnet-only;
  fusion sweep settled in 06: best +1.1 pt at 2-3x cost — fusion stays parked.
- 02-architecture v2: complete variable inventory — 20 set variables
  (request + engine knobs, each with type/default/status; weights and
  gates stay constants per E6, beam default per E7) and 24 song
  variables (used / planned / rejected, with the exact neutral defaults
  for missing data), plus the single stated application order.

**Deliberately not planned:** timeline transition editing (DJ.Studio's moat,
huge surface, delegated to rekordbox by design); crowdsourced co-occurrence
(VirtualDJ's data moat, ethically off); solver engines (djkr8's lane, n too
small to matter); cloud anything (position, not omission).

Sequencing note: 1–3 land before the next real gig cycle; 4 is the
graduation project that makes MegaSet categorically different from SetFlow
et al.; everything else is compound interest.
