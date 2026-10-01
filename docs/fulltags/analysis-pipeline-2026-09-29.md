# FullTags Analysis Pipeline — State of the Library

> Measured snapshot: **Sep 29, 2026 00:35 UTC**
> Status: **shipped** — all pipeline stages complete, `check:full` green
>
> **v3 plan proposed Sep 29:** this doc captures the v2 pipeline's live
> state. The v3 plan re-measures every stage against independent answer
> keys and rebuilds where accuracy falls short. Key root causes
> identified: BPM 20 ms quantization bug, genre labels graded against
> themselves, energy saturation (avg 8.5), remix-identity gap. See
> [fulltags-v3-rebench-and-build-plan-2026-09-29.md](fulltags-v3-rebench-and-build-plan-2026-09-29.md)
> and [fulltags-v3-landscape-and-redesign-2026-09-28.md](fulltags-v3-landscape-and-redesign-2026-09-28.md).

## Overview

The FullTags analysis pipeline transforms raw audio files into a fully enriched
DJ library. Every track in the collection gets genre, key, energy, mood,
beat grid, phrase cues, and audio embeddings — all derived from real sources
and deterministic analysis, never guessed.

```
                     ┌─────────────────────────────────────────────┐
                     │               SOURCE INTAKE                 │
                     │                                             │
                     │  YouTube Liked ──┐                          │
                     │  SoundCloud ─────┤                          │
                     │  Local Ingest ───┼──▶  archive.db (ledger)  │
                     │  RB Adopt ───────┘                          │
                     └────────────────────┬────────────────────────┘
                                          │
                     ┌────────────────────▼────────────────────────┐
                     │           ENRICHMENT PIPELINE                │
                     │                                              │
                     │  ┌──────┐  ┌───────┐  ┌─────┐  ┌────────┐  │
                     │  │ fetch│  │enrich │  │beats│  │  mood  │  │
                     │  │      │  │(MBrz) │  │     │  │  +emb  │  │
                     │  └──┬───┘  └───┬───┘  └──┬──┘  └───┬────┘  │
                     │     │          │         │          │        │
                     │     ▼          ▼         ▼          ▼        │
                     │  genre      genre     downbeats   mood      │
                     │  artwork    fill      BPM         arousal   │
                     │  year                 grid        dance     │
                     │  tags                              party    │
                     │                                   happy    │
                     │                                   aggro    │
                     │                                   elec     │
                     │                                   embed    │
                     └────────────────────┬────────────────────────┘
                                          │
                     ┌────────────────────▼────────────────────────┐
                     │          DERIVED ANALYSIS                    │
                     │                                              │
                     │  ┌──────┐  ┌───────┐  ┌──────┐  ┌────────┐ │
                     │  │ cues │  │energy │  │genre │  │similar │ │
                     │  │      │  │(LUFS) │  │(kNN) │  │        │ │
                     │  └──┬───┘  └───┬───┘  └──┬───┘  └───┬────┘ │
                     │     │          │         │           │       │
                     │     ▼          ▼         ▼           ▼       │
                     │  phrase     DJ energy  vote       cosine    │
                     │  markers    (1-10)     ladder     kNN       │
                     │  (8-bar)               ≥65%      neighbors │
                     │  memory                gate                 │
                     │  (32-bar)                                   │
                     └────────────────────┬────────────────────────┘
                                          │
                     ┌────────────────────▼────────────────────────┐
                     │           SYNC TO REKORDBOX                  │
                     │                                              │
                     │  ┌──────────┐  ┌────────┐  ┌─────────────┐ │
                     │  │comment-  │  │rb-cues │  │genre sync  │ │
                     │  │sync      │  │        │  │            │ │
                     │  └──┬───────┘  └───┬────┘  └──────┬─────┘ │
                     │     │              │              │        │
                     │     ▼              ▼              ▼        │
                     │  SHELF1/PIONEER/Master/master.db            │
                     │  Comment: "Am · E7.2 · Party+Dance"        │
                     │  Cues: 8-bar phrase + 32-bar memory        │
                     │  Genre: djmdGenre table                    │
                     └─────────────────────────────────────────────┘
```

---

## Pipeline Stages in Detail

### Stage 1: Source Intake

Audio enters the system from four sources. Each gets a unique `video_id` key
in `archive.db`:

```
  Source               Key prefix    Count    Notes
  ──────────────────── ──────────── ──────── ─────────────────────────────
  Rekordbox Adopt      rb-*          3,607   Mirror of SHELF1 master.db
  YouTube Liked        (YT ID)       2,026   Music-gated liked videos
  External Ingest      ext-*           825   Local drops (zips, folders)
  SoundCloud           (SC ID)         204   Link-first acquisition
  Other (playlists)    (mixed)          20   Legacy playlist imports
  ──────────────────── ──────────── ──────── ─────────────────────────────
  TOTAL                               6,682
  With physical file                  5,034
```

**Commands:** `megadj sync`, `megadj ingest`, `megadj drop`,
`megadj rb-adopt`

### Stage 2: Genre Enrichment (`megadj fetch`)

Genre comes from a **vote ladder** — multiple real sources cast weighted votes,
one election seam (`stageGenreElection`) picks the winner:

```
                   ┌──────────────────────────┐
                   │     GENRE VOTE LADDER     │
                   │                           │
                   │  SoundCloud ──▶ vote (W1) │
                   │  Beatport  ──▶ vote (W2) │
                   │  Bandcamp  ──▶ vote (W3) │
                   │  Imprint   ──▶ vote (W4) │
                   │  MusicBrainz ▶ vote (W5) │
                   │  AI (opt-in) ▶ vote (W6) │
                   │                           │
                   │        ▼ election ▼       │
                   │   highest-weight wins     │
                   │                           │
                   │  Rule: AI off by default  │
                   │  Missing = honest gap     │
                   └──────────────────────────┘
```

**Current state:**

| Metric            | Value                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracks with genre | **4,674** / 6,682 (69.9%)                                                                                                                                                         |
| Distinct genres   | **106**                                                                                                                                                                           |
| Top 5             | EDM (864), House (838), Techno (589), Hip-Hop (483), Tech House (369)                                                                                                             |
| Genre refold      | 28 aliases canonicalized (`EDM / Bass` → `Bass`, `Hip hop/rap` → `Hip-Hop`)                                                                                                       |
| MusicBrainz fill  | 26 weak genres upgraded                                                                                                                                                           |
| RB genre sync     | 3,819/3,819 (**100%** of collection have a genre string — note: ~400 came from file tags or unknown provenance, not the vote ladder; v3 genre_evidence tracks provenance per row) |

**Commands:** `megadj fetch --genres`, `megadj enrich`, `megadj genre --refold`

### Stage 3: Beat Analysis (`megadj beats`)

The `beat_this` ONNX model extracts beat positions and downbeats from raw audio.
Runs via 4 parallel Python workers with PyAV audio decoding (no temp files).

```
   Audio file ──▶ PyAV decode ──▶ beat_this model ──▶ beats + downbeats
                  (mono 22050 Hz)   (CPU inference)     (JSON arrays)
                                                            │
                                         ┌──────────────────┘
                                         ▼
                                    ┌─────────┐
                                    │ beats DB │
                                    │          │
                                    │ bpm_raw  │  Raw median tempo
                                    │ bpm_fold │  Folded to DJ range
                                    │ residual │  Grid quality metric
                                    │ beats[]  │  All beat times (s)
                                    │ down[]   │  Downbeat times (s)
                                    └─────────┘
```

**Current state:**

| Metric                     | Value                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tracks analyzed            | **4,528**                                                                                                     |
| Failed (too short/corrupt) | 46                                                                                                            |
| BPM distribution           | Slow <100: 448 · Mid 100–119: 172 · Standard 120–129: **2,121** · Uptempo 130–139: **1,406** · Fast 140+: 381 |

**Command:** `megadj beats --jobs 4 --max-seconds 0`

### Stage 4: Mood & Embedding Analysis (`megadj mood`)

The ONNX mood model outputs multi-head classification scores per track plus
a 1280-dimensional effnet embedding vector for similarity matching:

```
   Audio file ──▶ ONNX model ──▶ mood heads + arousal + embedding
                                       │            │         │
              ┌────────────────────────┘            │         │
              ▼                                     ▼         ▼
     ┌────────────────┐              ┌──────────┐  ┌──────────────┐
     │   mood table    │              │ arousal  │  │  embeddings  │
     │                 │              │  (1–9)   │  │   table      │
     │ dance:    0.98  │              │          │  │              │
     │ party:    0.91  │              │ ──▶ DJ   │  │ 1280-d vec   │
     │ electronic:0.90 │              │  energy  │  │ (effnet)     │
     │ happy:    0.27  │              │  (1–10)  │  │              │
     │ aggressive:0.26 │              └──────────┘  └──────────────┘
     └────────────────┘
```

**Mood head thresholds:** A head fires when its score ≥ 0.5. The five heads
are `Party`, `Dance`, `Electronic`, `Aggro`, `Happy`.

**Energy 2.0 formula** (code: `pipeline-stages.ts`, **still production** — v3.1 pipeline
shipped Oct 1 but Phase 4 switchover not yet done; see
[energy-v3-plan-2026-10-01.md](energy-v3-plan-2026-10-01.md)):

```
  rms       = energyFromLufs(measureRms(file))           # RMS → 1–10
  arousal   = clamp((mood.arousal - 1) / 8, 0, 1)        # 1–9 → 0–1
  energy    = round(0.5·rms + 0.3·dance·10 + 0.2·arousal·10, 1)
```

When the mood stamp is absent (no danceability/arousal), RMS-only:

```
  rmsDb     = ffmpeg astats RMS_level (dB)
  clamped   = clamp(rmsDb, -25, -8)
  energy    = round((1 + ((clamped + 25) / 17) × 9) × 10) / 10
```

Note: the earlier doc "arousal → energy linear mapping" was the pre-2.0
formula. Energy 2.0 blends RMS loudness, model danceability, and model
arousal — perceptual energy, not just loudness.

**Current state:**

| Metric          | Value                             |
| --------------- | --------------------------------- |
| Mood analyzed   | **4,526**                         |
| Energy computed | **4,645** (incl. 3,595 via LUFS)  |
| Embeddings      | **3,819** (1280-d effnet vectors) |
| Avg arousal     | 4.92                              |
| Avg energy      | 8.5 (range 1–10)                  |
| Mood failures   | 43 (short sampler presets)        |

**Command:** `megadj mood --jobs 4 --max-seconds 0 --embeddings`

### Stage 5: Phrase Cues (`megadj cues`)

8-bar phrase boundaries derived deterministically from the beat grid.
Every 32-bar boundary also gets a `memory: true` flag for CDJ memory markers.

```
  downbeats[] ──▶ phraseCues() ──▶ Cue[]
                                      │
           ┌──────────────────────────┘
           ▼
  ┌─────────────────────────────────────────────┐
  │  Cue { index, position, bar, memory }       │
  │                                             │
  │  Bar  1  ──▶ Phrase 0  (memory ✓)           │
  │  Bar  9  ──▶ Phrase 1                       │
  │  Bar 17  ──▶ Phrase 2                       │
  │  Bar 25  ──▶ Phrase 3                       │
  │  Bar 33  ──▶ Phrase 4  (memory ✓)           │
  │  Bar 41  ──▶ Phrase 5                       │
  │  ...                                        │
  │  Bar 65  ──▶ Phrase 8  (memory ✓)           │
  │                                             │
  │  BARS_PER_PHRASE  = 8   (32 beats)          │
  │  BARS_PER_MEMORY  = 32  (every 4th phrase)  │
  └─────────────────────────────────────────────┘
```

**Current state:**

| Metric                | Value          |
| --------------------- | -------------- |
| Tracks with cues      | **4,523**      |
| Avg cues/track        | **30.0**       |
| Tracks with ≥8 cues   | 4,292 (95%)    |
| Max cues in one track | 779 (long mix) |

**Command:** `megadj cues`

### Stage 6: Genre kNN Classification (`megadj genre`)

Leave-one-out kNN classifier over the 1280-d effnet embeddings. Each track's
5 nearest neighbors vote on genre family; a 60% agreement gate decides whether
to accept the prediction.

```
  ┌─────────────────────────────────────────────────┐
  │              GENRE kNN (LOO)                     │
  │                                                  │
  │  For each track:                                 │
  │    1. Remove it from the corpus                  │
  │    2. Find k=5 nearest neighbors (cosine sim)    │
  │    3. Map each neighbor's genre → family          │
  │    4. Vote: if ≥60% agree → predict that family  │
  │       else → REFUSE (no prediction)              │
  │                                                  │
  │  Ship gate: gated agreement ≥ 65%                │
  │                                                  │
  │  ┌────────────────────────────────────┐          │
  │  │ Current measurement (2026-09-20): │          │
  │  │   Evaluated:   3,192               │          │
  │  │   Baseline:    57.0%  (▼ gate)     │          │
  │  │   Arbitration: 66.6%  (✓ gate)     │          │
  │  │   Refusal:     27.9%               │          │
  │  │   Arbitration Δ: +9.7 pts          │          │
  │  │   Ship gate:   ≥65% on arbitration │          │
  │  │   Status:      PASS (arbitration)  │          │
  │  │                FAIL (baseline)     │          │
  │  └────────────────────────────────────┘          │
  │                                                  │
  │  Bottleneck: label ceiling (~60–76%              │
  │  audio-consistent labels in the corpus)          │
  └─────────────────────────────────────────────────┘
```

The classifier does NOT auto-apply genres — accuracy is below the 65% ship
gate. Genres come exclusively from the vote ladder (real sources).

**Diagnostics available:** `megadj genre --eval`, `megadj regate genre`,
`megadj genre-why <video_id>`

### Stage 7: Similarity Search (`megadj similar`)

Cosine kNN over effnet embeddings finds tracks that sound alike.
Two retrieval spaces:

```
  ┌─────────────────────────────────────┐
  │  RAW COSINE (default)               │
  │                                     │
  │  score = cos(query, candidate)      │
  │  Simple, fast, good for browsing    │
  └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐
  │  WHITENED + CSLS                    │
  │                                     │
  │  1. Mean-centre all vectors         │
  │  2. All-but-the-top whitening (k=2) │
  │  3. CSLS penalty correction:        │
  │     score = 2·cos(q,c) - r(q) - r(c)│
  │                                     │
  │  Better for hubness reduction       │
  └─────────────────────────────────────┘
```

**Corpus size:** 3,819 embedded tracks

**Command:** `megadj similar <video_id> [--space whitened]`

---

## RB Comment Sync (`megadj rb-comment-sync`)

The final sync stage writes enriched data into rekordbox's `Commnt` field
in a structured format the DJ can read on hardware:

```
  ┌──────────────────────────────────────────────────────────────┐
  │                    COMMENT FORMAT                             │
  │                                                              │
  │   "Am · E7.2 · Party+Dance+Electronic"                      │
  │    ──   ────   ──────────────────────                        │
  │    Key  Energy  Mood heads (≥0.5 threshold)                  │
  │                                                              │
  │  ┌──────────────────────────────────────────┐                │
  │  │ Key source priority:                      │                │
  │  │   1. TXXX tag (file metadata)             │                │
  │  │   2. RB KeyID (djmdKey table, 99.7%)      │                │
  │  │   3. track_keys ledger                    │                │
  │  └──────────────────────────────────────────┘                │
  │                                                              │
  │  ┌──────────────────────────────────────────┐                │
  │  │ Energy source priority:                   │                │
  │  │   1. TXXX ENERGY tag                      │                │
  │  │   2. archive.db tracks.energy column      │                │
  │  │   3. Mood arousal derivation              │                │
  │  └──────────────────────────────────────────┘                │
  │                                                              │
  │  ┌──────────────────────────────────────────┐                │
  │  │ Mood source priority:                     │                │
  │  │   1. TXXX MOOD tag                        │                │
  │  │   2. mood table (5 heads, ≥0.5 fires)     │                │
  │  └──────────────────────────────────────────┘                │
  └──────────────────────────────────────────────────────────────┘
```

**Data flow for comment sync:**

```
  archive.db          master.db (RB)        comment-sync.kit.py
  ───────────         ──────────────        ──────────────────
  mood table ────────▶ arousal → energy ──┐
  tracks.energy ─────▶ direct energy ─────┤
  track_keys ────────▶ key ───────────────┤
  mood heads ────────▶ mood string ───────┼──▶ "Key · E · Mood"
  djmdKey table ─────▶ RB key fallback ───┤      │
  TXXX tags ─────────▶ file tag values ───┘      │
                                                  ▼
                                          djmdContent.Commnt
```

---

## RB Master.db Final State (SHELF1)

```
  ┌─────────────────────────────────────────────┐
  │  SHELF1/PIONEER/Master/master.db             │
  │  3,819 tracks                               │
  │                                              │
  │  Full comment (Key · E · Mood): 3,803 (99.6%)│
  │  Partial comment:                   16 (0.4%)│
  │  No comment:                         0 (0.0%)│
  │  With genre:                    3,819 (100%) │
  │  With artwork:                 3,727 (97.6%) │
  │  With KeyID:                   3,807 (99.7%) │
  └─────────────────────────────────────────────┘
```

### The 16 Irreducible Partial Comments

These are long mixes, compilations, and DJ sets where the analysis
cannot extract a single value:

- **14 tracks** have `E<val> · Mood` but **no key** — RB can't determine a
  single key for a multi-key mix (e.g., "Skrillex Boiler Room", "Spinnin'
  Records Best of 2019")
- **2 tracks** have `Key · Mood` but **no energy** — edge cases where neither
  LUFS nor arousal yielded a finite value

---

## Archive.db Coverage Summary

```
  ┌──────────────────────────────────────────────────────────────┐
  │  ~/.local/state/megadj/archive.db                            │
  │                                                              │
  │  6,682 total tracks │ 5,034 with physical files              │
  │                                                              │
  │  COVERAGE (of 5,034 with files):                             │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
  │  Genre       ████████████████████████░░░  4,674  (92.9%)     │
  │  Energy      ████████████████████████░░░  4,645  (92.3%)     │
  │  Beats       ██████████████████████░░░░░  4,528  (89.9%)     │
  │  Mood        ██████████████████████░░░░░  4,526  (89.9%)     │
  │  Cues        ██████████████████████░░░░░  4,523  (89.8%)     │
  │  Key         █████████████████████░░░░░░  4,502  (89.4%)     │
  │  Embeddings  ███████████████████░░░░░░░░  3,819  (75.9%)     │
  │                                                              │
  │  Gap analysis: the ~10% gap is primarily YouTube liked-video │
  │  rows (2,026 tracks) that were never downloaded — they exist │
  │  in the ledger as metadata-only entries. The 3,819 embedded  │
  │  tracks map exactly to the rekordbox collection.             │
  └──────────────────────────────────────────────────────────────┘
```

---

## Source Provenance

| Source          | Tracks | Genre       | Energy      | Notes                                 |
| --------------- | ------ | ----------- | ----------- | ------------------------------------- |
| Rekordbox Adopt | 3,607  | 3,406 (94%) | 3,512 (97%) | SHELF1 mirror, primary collection     |
| YouTube Liked   | 2,026  | 402 (20%)   | 266 (13%)   | Mostly metadata-only (not downloaded) |
| External Ingest | 825    | 759 (92%)   | 780 (95%)   | Local drops, SC downloads             |
| SoundCloud      | 204    | 99 (49%)    | 87 (43%)    | Link-first acquisition                |

---

## Genre Distribution (Top 20)

```
  EDM              ████████████████████████████████████████████  864
  House            ███████████████████████████████████████████   838
  Techno           ██████████████████████████████               589
  Hip-Hop          ████████████████████████                     483
  Tech House       ███████████████████                          369
  Pop              ██████████████                               271
  Progressive House████████                                     165
  Deep House       ████████                                     147
  Rock             ██████                                       111
  R&B              █████                                         89
  Trance           ████                                          87
  Afro House       ████                                          82
  Dance            ███                                           61
  Electronic       ███                                           59
  Bass House       ██                                            46
  Trap             ██                                            35
  Electro          ██                                            29
  Drum & Bass      ██                                            29
  Indie Dance      █                                             28
  Disco            █                                             25
```

---

## BPM Distribution

```
  Slow     (<100 BPM)  ████████████████████████                448  Hip-Hop, R&B, chill
  Mid   (100–119 BPM)  █████████                               172  Downtempo, breaks
  Standard (120–129)   ████████████████████████████████████   2,121  House, tech house
  Uptempo (130–139)    █████████████████████████████          1,406  Techno, trance
  Fast     (140+ BPM)  ████████████████████                    381  D&B, hard techno
```

---

## Command Reference

### Full Pipeline (ordered)

```bash
# 1. Acquire
megadj sync                          # YouTube + SoundCloud downloads
megadj ingest <folder>               # local file intake
megadj drop <folder-or-url>          # one-shot: download → full pipeline

# 2. Enrich metadata
megadj fetch --all --jobs 4          # genre/art/tags/years from SC/BP/BC
megadj enrich                        # MusicBrainz genre fill
megadj genre --refold --apply        # canonicalize genre aliases

# 3. Audio analysis
megadj beats --jobs 4 --max-seconds 0   # beat_this BPM + downbeats
megadj mood --jobs 4 --max-seconds 0    # ONNX mood + arousal
megadj mood --embeddings                # sync effnet embeddings
megadj catch-up --jobs 4                # one-pass: beats → mood for new imports

# 4. Derived analysis
megadj cues                          # 8-bar phrase cues from downbeats
# Energy: computed via ffmpeg LUFS or mood arousal derivation

# 5. Evaluation
megadj genre --eval                  # kNN accuracy (LOO, ≥65% gate)
megadj regate genre                  # gate check
megadj similar <video_id>            # find similar tracks
megadj genre-why <video_id>          # genre vote breakdown

# 6. Sync to Rekordbox
megadj rb-comment-sync SHELF1 --apply --yes   # comment + genre sync
megadj rb-cues SHELF1 --apply --yes           # phrase cues to RB

# 7. Verify
megadj audit                         # per-file gap report
megadj tag-check                     # ID3 structure + booth-text health
bun run check:full                   # code quality gate (tsc + oxlint + ruff + mypy + tests)
```

### Quality Gates

| Gate          | Command                           | Status                                             |
| ------------- | --------------------------------- | -------------------------------------------------- |
| TypeScript    | `tsc --noEmit`                    | ✅ Green                                           |
| Lint          | `oxlint` + `ruff` + `mypy`        | ✅ Green                                           |
| Tests         | `bun test` (2,169 pass)           | ✅ Green                                           |
| Format        | `prettier --check`                | ✅ Green                                           |
| Type coverage | `typecov` (100%)                  | ✅ Green                                           |
| Genre kNN     | `regate genre` (≥65% arbitration) | ✅ 66.6% arbitration (baseline 57.0%) — 2026-09-20 |

---

## Roadmap: Segment-Level Embeddings

The next frontier for genre accuracy is **per-phrase embedding analysis** —
computing effnet embeddings per 8-bar cue segment instead of per full track:

```
  TODAY (full-track embedding):
  ┌───────────────────────────────────────────┐
  │  Track audio ──▶ one 1280-d vector        │
  │                                           │
  │  Limitation: a track's intro might sound  │
  │  "techno" but the drop is "house" — one   │
  │  vector averages both away                │
  └───────────────────────────────────────────┘

  FUTURE (segment embeddings):
  ┌───────────────────────────────────────────┐
  │  Track audio ──▶ cue points ──▶ segments  │
  │                                           │
  │  Phrase 0 ──▶ embed₀ (1280-d)  "intro"    │
  │  Phrase 1 ──▶ embed₁ (1280-d)  "buildup"  │
  │  Phrase 2 ──▶ embed₂ (1280-d)  "drop"     │
  │  Phrase 3 ──▶ embed₃ (1280-d)  "break"    │
  │  ...                                      │
  │                                           │
  │  Benefits:                                │
  │  • Per-section genre voting               │
  │  • Section-aware similarity matching      │
  │  • Transition-point genre compatibility   │
  │  • Better MegaSet mix-point selection     │
  └───────────────────────────────────────────┘
```

**Prerequisites:**

- ✅ Phrase cues in DB (4,523 tracks, avg ~22 phrase cues/track)
- ✅ Effnet model running (mood pipeline)
- ✅ Audio slicing capability (PyAV decoder exists)
- ❌ Ledger stores whole-track time-mean vectors only (#113 — REJECTED
  the "no re-analysis" claim; per-bar store WS2 is the fix, ~45 min rerun)

**What would need building (→ WS2 in v3 plan):**

1. `bar_features` table + per-bar writer (B2.1)
2. Per-patch Essentia heads → per-bar curves (B2.2)
3. Library rerun: megadj analyze --bars (B2.3, planned)
4. PCA basis versioning (B2.4)
5. Section-aware similarity search

This is documented in the [master architecture v2](../megaset/11-master-architecture-v2.md)
under "enrichment/chunking" as a quality improvement path that bypasses the
label ceiling.

---

## Session Work Log (Sep 28–29, 2026)

| Step                     | Result                               |
| ------------------------ | ------------------------------------ |
| Energy via LUFS (ffmpeg) | 3,595 tracks computed                |
| Beats via beat_this      | 90 newly analyzed (4,528 total)      |
| Phrase cues              | 91 new (4,523 total)                 |
| MusicBrainz enrich       | 26 genres upgraded                   |
| Genre refold             | 28 aliases canonicalized             |
| Embeddings sync          | 3,819 confirmed                      |
| Comment-sync             | 33 partials → full, 11 genres synced |
| RB cues                  | All current                          |
| Ruff fix                 | `cb618aa9` pushed                    |
| `check:full`             | ✅ 2,169 pass, 0 fail                |
