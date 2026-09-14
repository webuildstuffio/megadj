# MegaSet — Architecture

v2 · 2026-09-14 · **Architecture** → [PRD](01-prd.md) · [Analysis](03-competitive-analysis.md) · [Benchmarks](04-sequencing-benchmarks.md)

v2 rewrite: adds the **complete variable inventory** (§2) — every variable we
compute or could compute, split into **set variables** (the request + engine
knobs) and **song variables** (per-track data), each with type, default,
status (v0 uses / planned / rejected) and the exact order things are applied
(§3). Benchmark evidence for the choices lives in [04](04-sequencing-benchmarks.md).

## 1. The shape

```
                     ledgers (FullTags owns)
   archive.db ── beats · mood · cues · embeddings · track_keys
   rekordbox mirror (master.db read-only seam) ── BPM×100 · KeyName
        │
        ▼
   setCandidates() ── pool census w/ honest counters (cratedeck/src/archive_similar.ts)
        │
        ▼
   buildSet() ── pure engine, zero I/O (cratedeck/src/setbuild.ts)
        │          score = 0.45·tempo + 0.3·key + 0.25·energy-fit
        │          hard gates: ±6% tempo, Camelot clash, opener neighborhood
        ▼
   SetBuildPayload ── steps[] · excluded[] · pool/freshness counters
        │
        ├─▶ CLI        megadj setbuild (src/fulltags/setbuild.ts)
        ├─▶ HTTP       GET /api/archive/setbuild · ?format=m3u8 (archive_routes.ts)
        ├─▶ MCP        archive_set_build (cratedeck/src/archive_tools.ts)
        ├─▶ Web        FullTags ⌗ Similar panel (SimilarTab.tsx)
        └─▶ rb-playlist  megadj rb-playlist (src/rekordbox/rb-playlist.ts)
                         dry-run first · --apply --yes · rekordbox-quit gate
                         · dated backup · whole-table verify · delayed re-read
```

## 2. The variables — everything considered, what we use, and defaults

Two frames, per the product's actual division of labor: **set variables**
are chosen per request (by the human, the agent, or the preset registry);
**song variables** are measured once by FullTags and read-only for the
engine. If a variable isn't in these tables, the engine doesn't see it.

### 2a. Set variables (request + engine knobs)

| #   | Variable                 | Type                                 | Default                                 | Range / values                | Status                                  | Notes                                                                                                             |
| --- | ------------------------ | ------------------------------------ | --------------------------------------- | ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| S1  | `preset`                 | `"warmup" \| "peak" \| "afterhours"` | `peak`                                  | registry `SET_PRESET_DEFS`    | ✅ v0                                   | unknown id = error, never fallback                                                                                |
| S2  | `minutes`                | `int`                                | `60`                                    | 10–240 (`SET_MINUTES_*`)      | ✅ v0                                   | clamped; non-numeric → error (B7 fix)                                                                             |
| S3  | `opener`                 | `videoId`                            | absent → engine picks                   | any pool id                   | ✅ v0                                   | requested-but-unusable = excluded loudly                                                                          |
| S4  | `limit`                  | `int`                                | absent = whole census                   | 1–1000 explicit               | ✅ v0                                   | absent ≠ 0; cap bounds TKEY reads                                                                                 |
| S5  | `format`                 | `"json" \| "m3u8"`                   | `json`                                  | 2 values                      | ✅ v0                                   | HTTP export; M3U8 = list only (B10 open)                                                                          |
| S6  | tempo gate window        | `pct`                                | ±6% (1.0 within ±2%)                    | engine const                  | ✅ v0                                   | hard gate, not tunable per request                                                                                |
| S7  | track length floor/cap   | `min`                                | 1 / 15 (`SET_TRACK_MINUTES_*`)          | engine const                  | ✅ v0                                   | one-shots & continuous mixes excluded                                                                             |
| S8  | opener neighborhood      | `count`                              | ≥15 within ±6% (`OPENER_MIN_NEIGHBORS`) | engine const                  | ✅ v0                                   | prevents dead-end anchors                                                                                         |
| S9  | excluded preview cap     | `count`                              | 40 (`SET_EXCLUDED_PREVIEW_MAX`)         | engine const                  | ✅ v0                                   | full count always reported                                                                                        |
| S10 | tie-break                | —                                    | `(score, videoId)` lexicographic        | engine const                  | ✅ v0                                   | determinism guarantee                                                                                             |
| S11 | score weights            | `tempo/key/fit`                      | `0.45 / 0.30 / 0.25`                    | engine consts                 | ✅ v0, **deliberately not a param**     | E6: 5 variants moved meanTr 0.989↔0.9945 at archive scale — user-facing weights would be a knob that does nothing |
| S12 | search strategy          | `"greedy" \| "beam"`                 | greedy; **beam-B8 when pool < ~250**    | benchmark-derived             | 🔨 planned                              | E7: beam +59% chain length in sparse pools, 0 ms cost there                                                       |
| S13 | `--track <id>` landmarks | `videoId[]`                          | none                                    | repeatable                    | 🔨 planned (C13)                        | must-plays sequenced at arc-right positions                                                                       |
| S14 | `candidates N`           | `int`                                | 1                                       | 2–5 sensible                  | 🔨 planned (C14)                        | N alternatives + quality score to compare                                                                         |
| S15 | lock/keep tracks         | `videoId[]`                          | none                                    | —                             | 🔨 planned (open-crate UX)              | regenerate around frozen picks                                                                                    |
| S16 | beam width `B`           | `int`                                | 8 when active                           | 4–16                          | 🔨 planned (with S12)                   | cost ≈ B× greedy                                                                                                  |
| S17 | diversity knobs          | thresholds                           | artist-adjacent = 0, family-run ≤3      | —                             | 🔨 planned (B6)                         | soft penalties, counters exposed                                                                                  |
| S18 | `seed`                   | `int`                                | 0 (deterministic)                       | any                           | 🔮 later                                | only meaningful with S14 N-candidates                                                                             |
| S19 | pool filter preset       | named rule                           | none                                    | e.g. "126–128 + family house" | 🔮 later                                | Smart-Crate-style saved pools                                                                                     |
| S20 | `valence` envelope       | `[start,end] 0–1`                    | absent (arousal+dance only)             | per preset                    | 🔶 planned, **demoted** (Part 4 triage) | mood-stdev is 0.12 — valence reorders by noise; its budget goes to `aggressive`/`happy` (T17)                     |

**Defaults from measurement** (benchmarks doc Parts 2–4): S11 weights are
constants because E6 showed five blend variants move meanTr by <0.006; S12's
~250 threshold is E7's beam crossover; S20 is demoted by the Part 4 triage.

### 2b. Song variables (per track, measured by FullTags)

Legend: **✅ used in v0** · **🔶 measured, scoring planned** · **🔮 measurable, not stored** · **❌ rejected**.

| #   | Variable                                         | Source (ledger)                              | Type                   | Default when missing | Status                     | Scoring role / notes                                                                                                                                                            |
| --- | ------------------------------------------------ | -------------------------------------------- | ---------------------- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | `videoId`                                        | `tracks`                                     | `string` PK            | —                    | ✅                         | identity + deterministic tie-break                                                                                                                                              |
| T2  | `title` / `artist`                               | `tracks`                                     | `string \| null`       | null                 | ✅                         | display; artist = diversity guard (B6)                                                                                                                                          |
| T3  | `durationS`                                      | `tracks`                                     | `number \| null`       | **300 s** assumption | ✅                         | budget fill                                                                                                                                                                     |
| T4  | `bpm` (folded)                                   | `beats.bpm_folded`                           | `number \| null`       | null → **excluded**  | ✅                         | tempo gate + 0.45 weight; must be finite > 0                                                                                                                                    |
| T5  | `key` (Camelot)                                  | `track_keys` → file TKEY; RB mirror fallback | `string \| null`       | null → neutral 0.5   | ✅                         | hard gate (clash = 0), 0.3 weight                                                                                                                                               |
| T6  | `arousal`                                        | `mood`                                       | `number \| null` (1–9) | **5** neutral        | ✅                         | arc fit (0.25 weight, shared with T7)                                                                                                                                           |
| T7  | `dance`                                          | `mood`                                       | `number \| null` (0–1) | **0.6** neutral      | ✅                         | arc fit                                                                                                                                                                         |
| T8  | `valence`                                        | `mood`                                       | `number \| null` (1–9) | unused               | 🔶 B4 **demoted**          | stdev 0.12 in our library — reorders by noise (benchmarks Part 4.1); only as a z-scored 3rd axis                                                                                |
| T9  | `genre` (+`genreFamily()`)                       | `tracks.genre`                               | `string \| null`       | null → no family     | 🔶 B6                      | diversity guard; 440 raw genres need refold first                                                                                                                               |
| T10 | embedding (1280-d)                               | `embeddings`                                 | `vec_json`             | absent → no prior    | 🔶 B10p                    | cosine kNN soft bonus ≤0.1                                                                                                                                                      |
| T11 | phrase cues (8-bar)                              | `cues`                                       | `cues_json`            | absent → no handoff  | ✅ **data ready**          | measured: avg 22.5 cues/track, 3,496 ≥8 cues, mixout p50 = 14.5 s (Part 4.2) — Phase D needs zero new analysis                                                                  |
| T12 | downbeats                                        | `beats.downbeats_json`                       | `number[]`             | absent               | 🔶 Phase D                 | cue placement math                                                                                                                                                              |
| T13 | `bpm_fitted` + residual                          | `beats`                                      | `number \| null`       | unused               | 🔶 later                   | residual = grid quality; low-residual tracks are safer beat-mixes                                                                                                               |
| T14 | LUFS                                             | **not stored**                               | `number`               | —                    | 🔮 B11p, **cost measured** | ffmpeg ebur128 = 348× realtime ≈ 50 min one-time for 3,600 tracks; also store LRA                                                                                               |
| T15 | scene affinity                                   | **not stored** (co-occur lane)               | `number`               | —                    | 🔮 planned                 | low-rank projection of tracklist co-occurrence; soft ≤0.05                                                                                                                      |
| T16 | rotation/position stats                          | **not stored**                               | `number`               | —                    | 🔮 planned                 | opener/weapon priors from tracklists                                                                                                                                            |
| T17 | mood heads (`aggressive/happy/electronic/party`) | `mood`                                       | `number`               | unused               | 🔶 **promoted**            | the only axes with real spread (aggr stdev 0.23, happy 0.24 vs valence 0.12) — aggressive = hard-edge guard, happy = euphoric-vs-dark separator; normalize to percentiles first |
| T18 | `year`                                           | `tracks`                                     | `string`               | unused               | 🔶 later                   | era consistency (rekordbox Related-Tracks uses it)                                                                                                                              |
| T19 | `bitrate_kbps`, `codec`                          | `tracks`                                     | `int/str`              | unused               | ❌                         | quality gate is GetDat's job, not the sequencer's                                                                                                                               |
| T20 | RB `Energy` column                               | master.db                                    | —                      | —                    | ❌                         | engine-computed by RB, unwritable (house rule)                                                                                                                                  |
| T21 | vocal presence                                   | **not stored**                               | `number`               | —                    | ❌ for now                 | Demucs = minutes/track; intro-RMS shape (~1,292 frames/30 s via astats) covers most of the need at ~0 cost (Part 4.4)                                                           |
| T22 | crowd/play history                               | **not stored**                               | —                      | —                    | ❌                         | opt-in-only, deferred to §M64; co-occurrence lane (T15/16) is the substitute                                                                                                    |
| T23 | streaming popularity                             | —                                            | —                      | —                    | ❌                         | cloud data; position, not omission                                                                                                                                              |
| T24 | `liked_position`                                 | `tracks`                                     | `int`                  | unused               | ❌                         | SoundCloud ordering is curatorial noise, not mixability                                                                                                                         |

### 2c. Application order (the pipeline, stated once)

**Pool construction** (`setCandidates`, in order): census by status →
file existence w/ shelf rebase → NFC/casefold duplicate collapse →
duration floor/cap (S7) → per-rejection counters. **Opener**: requested
`opener` (S3) if playable → else arc-start arousal among candidates with
≥15 tempo-neighbors (S8) → else best-effort, honestly flagged. **Chain**:
hard gates first (tempo S6, then key — cheap negative checks first), then
the weighted blend (0.45·tempo + 0.3·key + 0.25·fit over arousal+dance),
tie-break (S10). **Termination**: budget fill → leftovers excluded with
reasons; nothing silently dropped. Every counter (pool, missing,
duplicate, relocated, excluded_total) rides the payload.

## 3. The invariants

1. **The engine is pure.** `buildSet()` takes candidates in, returns a chain
   out — no file I/O, no clock, no randomness. Determinism (same inputs →
   byte-identical chain) is pinned by tests; tie-breaks are (score, videoId).
2. **One wire SSOT.** `cratedeck/shared/setbuild.ts` owns presets, pool
   clamps, and the excluded-preview cap; `shared/camelot.ts` owns the wheel.
   CLI, HTTP, MCP, and web all derive — no hand-copied twins. The tables in
   §2 are _documentation of_ that SSOT, not a second copy: when a default
   changes, the code changes and this doc follows.
3. **Propose-only.** Nothing in the engine or any surface writes a playlist.
   The only writer is `rb-playlist`, behind the full master-DB gate stack
   (rekordbox closed, dated backup, verify, delayed re-read).
4. **Honest payloads.** Every rejection is counted and classified;
   pool size and ledger freshness travel with every response.
5. **Missing data is neutral, never fatal and never invented.** No BPM →
   excluded (can't tempo-gate a guess); no key → 0.5; no mood → neutral
   5/0.6; no duration → 300 s. Each default is chosen to _weaken_ that
   track's claim, not fake one.
6. **Knobs must earn existence.** A parameter ships only when a benchmark
   shows it changes outcomes (E6 is why weights are constants; E7 is why
   beam is not). Defaults come from measurement, marked with their
   experiment.

## 4. Data ownership

| Data                              | Owner                                         | MegaSet role                              |
| --------------------------------- | --------------------------------------------- | ----------------------------------------- |
| BPM, energy/arousal/dance/valence | FullTags beats + mood ledgers                 | scoring inputs                            |
| Musical key                       | `track_keys` cache → TKEY; RB mirror fallback | hard gate                                 |
| Genre (normalized, family-mapped) | `tracks.genre` + `genreFamily()` SSOT         | diversity guard (B6)                      |
| 8-bar phrase cues + downbeats     | FullTags cues ledger                          | handoff layer (Phase D)                   |
| Embeddings (effnet 1280-d)        | embeddings ledger                             | similarity prior (B10p)                   |
| LUFS                              | not yet stored                                | `megadj loudness` pass (B11p, optional)   |
| Co-occurrence / rotation stats    | `setlist_edges` (planned, co-occur lane)      | sceneAffinity + rotationWeight soft terms |
| Collection rows (DjmdContent)     | SHELF1 master.db via Python seam              | mirror fallback + rb-playlist write-off   |

MegaSet adds exactly one store of its own: nothing. All persistence stays in
ledgers owned by their existing products (the co-occurrence ledger, when it
lands, belongs to the GetDat family).
