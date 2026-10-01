# Energy v3.1 — Multi-Tier Composite, Label-Free, Training-Free

**Status:** 🧭 PLAN OF RECORD — Oct 1 2026 (rev 2)
**Supersedes:** v3 rev 1 (single hand-weighted formula), v3 landscape §5
(pairwise-calibrated model requiring ~200 manual judgments)
**Root cause:** Energy 2.0 saturates because 50% of the weight is RMS loudness,
30% is danceability (saturated at 0.98 on EDM), and 20% is arousal. Library
average 8.5/10. This plan eliminates saturation with zero manual labels
and zero gradient training.

---

## 0. Why v3.1 Over v3 rev 1

The rev 1 plan had the right thesis (multi-feature composite) but three
structural weaknesses identified through review:

1. **Circular validation.** E1–E9 percentile bands pass decile-spread by
   construction — a random number generator passes too. Genre separation
   is the only gate with teeth, and using it to tune weights AND validate
   makes it circular.
2. **Collinear features fight each other.** `hf_ratio` and `low_band_share`
   are shares of the same total: bass up → HF share down mechanically.
   Brightness is counted three times (hf_ratio, centroid, flux). Effective
   brightness weight is ~0.40, recreating single-signal domination.
3. **Source-quality bias.** The 4–20 kHz band measures YouTube Opus/AAC
   codec lowpass (15–17 kHz cutoff varies by encode quality) as much as
   music content.

v3.1 fixes all three with: **independent multi-tier estimation** (so tiers
validate each other), **bloc-based weighting** (so correlated signals pool
instead of stacking), and **non-circular causal validation gates** (section
ordering + perturbation tests that a random number generator cannot pass).

---

## 1. Architecture — Three Independent Tiers

Instead of one formula with eight hand-weighted features, v3.1 runs three
independent kinds of energy estimate. Where they agree, you get built-in
validation for free.

| Tier | Signals | Training needed | Already in repo |
|------|---------|-----------------|-----------------|
| **A. DSP features** | Onsets/beat, 4–12 kHz energy re:LUFS, 20–150 Hz energy re:LUFS, crest factor (inverted dynamic complexity), spectral flux, drop LUFS, BPM | None | `bar_features` (LUFS, onset density, low-band share, flux), `computeDropEnergy()`, `measureRms()` |
| **B. Pretrained effnet heads** | `mood_aggressive`, `engagement`, `approachability` (inverted), arousal (drop window) | None — downloaded ONNX from essentia model zoo, same discogs-effnet embedding the mood pipeline already computes | `models.ts` already runs `mood_aggressive` + effnet embeddings; `engagement` + `approachability` heads are ~500 KB ONNX each |
| **C. Optional CLAP** (future) | Cosine similarity of drop audio to "peak-time high-energy club track" minus "chill relaxed lounge track" | None — text prompts only | Not yet wired |

All tiers run on the **LUFS-normalized drop section** (loudest 16-bar
window, loudness-normalized to a fixed short-term LUFS before any spectral
feature extraction).

---

## 2. Tier A — DSP Features (Fixed From Rev 1)

### 2.1 Fixes Applied

| Rev 1 problem | v3.1 fix |
|---------------|----------|
| `hf_ratio` and `low_band_share` cancel (compositional shares of same total) | Measure bass and HF as **dB above drop LUFS** — absolute spectral energy relative to integrated loudness, not shares |
| HF band goes to 20 kHz (measures codec quality) | Cap at **4–12 kHz** (codec-safe; YouTube lowpass is ≥15 kHz) |
| Onset density (onsets/sec) is basically BPM | Use **onsets per beat** — tempo-independent rhythmic complexity |
| Spectral centroid triple-counts brightness | Move centroid to a **tie-break** within the Brightness bloc, not a top-level feature |
| Plain z-scores compress on skewed/heavy-tailed distributions | Use **rank normalization** (library percentile) — robust to outliers |
| Arousal measured on whole track, not drop | **Re-run emomusic head on the drop window** |
| `EnergyBand` called on raw audio | Correct: **frame → Windowing → Spectrum → EnergyBand**, mean across frames |
| `LoudnessEBUR128` called on mono | Correct: use **`AudioLoader`** (stereo) for EBU R128 |
| No LUFS normalization before spectral features | **Normalize drop to fixed LUFS** before computing any spectral feature (prevents mastering loudness leaking into every spectral ratio) |
| No fallback for tracks without a real drop | If drop contrast (drop mean LUFS − rest mean LUFS) < 3 dB: **75% drop + 25% whole-track median**, flag `low_drop_contrast` |
| BPM not explicit | Add BPM explicitly at 0.05–0.08 weight; use onsets/beat for density |

### 2.2 Tier A Feature Set

| Feature | What it captures | Extraction |
|---------|-----------------|------------|
| **Onsets per beat** | Rhythmic complexity (tempo-independent) | `onset_rate / (bpm/60)` from bar_features |
| **BPM** | Tempo contribution (explicit, controlled weight) | From beats ledger |
| **HF energy re:LUFS** | Brightness/hardness (4–12 kHz) | `frame→Windowing→Spectrum→EnergyBand(4k,12k)` averaged, expressed as dB above drop LUFS |
| **Low energy re:LUFS** | Bass physical impact (20–150 Hz) | `EnergyBand(20,150)` dB above drop LUFS |
| **Crest factor** (inverted dynamic complexity) | Compression level — lower dynamics = more relentless | `essentia.DynamicComplexity`, inverted |
| **Spectral flux** | Timbral change rate | Already in `bar_features.spectral_flux` |
| **Drop LUFS** | Baseline loudness (diminished role) | EBU R128 short-term, stereo via `AudioLoader` |

---

## 3. Tier B — Pretrained Essentia Heads (New)

These run on the **same discogs-effnet 1280-d embedding** the mood
pipeline already computes. Adding new heads is ~500 KB of ONNX download
per head and zero training.

| Head | Model | What it captures | Direction |
|------|-------|-----------------|-----------|
| **Aggressive** | `mood_aggressive-discogs-effnet-1.onnx` | Hard/abrasive production | ↑ = more energy |
| **Engagement** | `engagement_regression-discogs-effnet-1.onnx` | "Lean forward" attention demand | ↑ = more energy |
| **Approachability** (inverted) | `approachability_regression-discogs-effnet-1.onnx` | Accessible / mainstream feel | ↓ = more energy (inverted: less approachable = harder) |
| **Arousal** (drop) | `emomusic-audioset-vggish-2.onnx` | Perceptual excitement (1–9 DEAM) | ↑ = more energy |

**Critical change from rev 1:** arousal is re-run on the **drop window
audio**, not read from the whole-track mood table. The whole-track value
dilutes the drop's intensity with intro/outro calm.

### Implementation

The effnet embedding for the drop window is already available when
`sectionEmbedding` is computed (models.ts already supports this for
mood). Add the three new heads to `MODEL_HEADS`, run them on the drop
embedding, and store results alongside the Tier A features.

```python
# New heads — same embedding, new ONNX classifiers
ENERGY_HEADS = {
    "aggressive":     "mood_aggressive-discogs-effnet-1.onnx",       # already loaded
    "engagement":     "engagement_regression-discogs-effnet-1.onnx",  # new download
    "approachability":"approachability_regression-discogs-effnet-1.onnx", # new download
}
# Run on drop-window effnet embedding (1280-d), not whole-track
for name, onnx_file in ENERGY_HEADS.items():
    sess = ort.InferenceSession(f"{MODEL_DIR}/{onnx_file}", providers=PROV)
    score = sess.run(["activations"], {"embeddings": drop_emb1280})[0].flatten()
    # regression heads output a single value; classification heads use idx 0
```

---

## 4. Combining Signals — Blocs, Not Individual Weights

### 4.1 Dead-Signal Auto-Exclusion

Before combining, check every signal's **interquartile range** across the
frozen library. If the IQR is below a threshold (effectively: the signal
barely varies), it is **excluded and logged**. This rule is what would have
caught danceability stuck at 0.98 in Energy 2.0.

```python
def is_dead_signal(values: list[float], iqr_threshold: float = 0.05) -> bool:
    q25, q75 = np.percentile(values, [25, 75])
    return (q75 - q25) < iqr_threshold
```

### 4.2 Bloc Structure

Group correlated signals into blocs. Average within each bloc (pooling
correlated signals instead of stacking them). Weight the blocs.

| Bloc | Members | Weight |
|------|---------|--------|
| **Rhythm** | Onsets/beat, BPM | 0.20 |
| **Brightness** | 4–12 kHz energy re:LUFS (spectral centroid as tie-break within bloc) | 0.20 |
| **Body** | 20–150 Hz energy re:LUFS, crest factor (inverted dynamic complexity), drop LUFS | 0.20 |
| **Activity** | Spectral flux | 0.10 |
| **Perceptual** (Tier B) | Arousal (drop), aggressive, engagement, approachability (inv), [CLAP when added] | 0.30 |

**Energy = weighted mean of the bloc percentiles**, converted to E1–E9
against the frozen reference.

### 4.3 Rank Normalization (Not Z-Scores)

Rev 1 used z-scores, which compress on skewed/heavy-tailed distributions.
v3.1 converts every signal to a **library percentile** using the frozen
reference. This is robust to outliers, all signals land on [0, 1], and it
doesn't matter that some signals have no natural units.

```python
def to_percentile(value: float, frozen_sorted: list[float]) -> float:
    """Convert a raw value to its library percentile [0, 1]."""
    rank = bisect_right(frozen_sorted, value)
    return rank / len(frozen_sorted)
```

### 4.4 Weight Selection — Presets, Not Hand-Picked

Instead of committing to one set of hand-picked weights, score a fixed
set of **weight presets** against the automatic validation gates (§5).
Nothing is fitted or optimized: each preset is scored, the best one ships.

| Preset | Rhythm | Brightness | Body | Activity | Perceptual |
|--------|--------|------------|------|----------|------------|
| **Equal blocs** | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 |
| **Default** (table above) | 0.20 | 0.20 | 0.20 | 0.10 | 0.30 |
| **DSP-heavy** | 0.25 | 0.25 | 0.25 | 0.15 | 0.10 |
| **Perceptual-heavy** | 0.15 | 0.15 | 0.15 | 0.05 | 0.50 |
| **PC1 loadings** | From PCA Phase 0 — use PC1's component loadings mapped to blocs | |

No labels and no gradient training. Each preset is scored on the gates
below and the best one ships.

---

## 5. Validation — Non-Circular, Causal, Automatic

### 5.1 The Problem With Rev 1's Gates

Decile spread passes by construction for percentile bands. Genre
separation becomes circular when used for both weight tuning AND
validation. Rev 1's validation could not distinguish a real energy
measure from a random number generator.

### 5.2 New Validation Gates

| Gate | How it works | Pass | Why it's non-circular |
|------|-------------|------|----------------------|
| **Section ordering** | Score intro, breakdown, build, and drop sections of every track with the same pipeline (after LUFS-normalizing each section) | Drop > breakdown in ≥ 85% of tracks | Uses structure we already decode (PSSI phrases) — the energy score has no access to section labels |
| **Degradation test** | 4 kHz lowpass, drums attenuated 9 dB, and bass-cut versions must each score lower than the original | ≥ 95% of tracks | Causal: removing energy-producing content must reduce the score |
| **Gain invariance** | +3 dB gain should barely change the band | ≤ 1 band shift in 95% of tracks | Energy should not be just loudness |
| **Tier agreement** | Rank correlation between Tier A composite and Tier B composite (two unrelated estimation methods) | Spearman ρ ≥ 0.4 | Two independent methods agreeing is evidence |
| **Duplicate consistency** | Different rips or versions of the same track (from fingerprint clusters) | ±1 band | Stability check |
| **No bloc dominates** | Each bloc's share of the final score's variance | ≤ 40% per bloc | Prevents hidden single-signal domination |
| **Not just BPM** | Correlation of final score with BPM | |ρ| < 0.5 | BPM contributes but doesn't dominate |
| **Not just loudness** | Correlation of final score with raw LUFS | |ρ| < 0.5 | Loudness contributes but doesn't dominate |
| **Genre direction** | Hard Techno and D&B average higher than Ambient and Downtempo | Cohen's d > 0.5 | Sanity check only, NOT used for weight tuning |

**Critical constraint:** genre direction is a **sanity check**, never a
tuning signal. Weights are selected by preset scoring on all gates
*except* genre direction, then genre direction is reported as a read-only
diagnostic.

### 5.3 Section-Ordering Gate (Implementation Detail)

We already decode PSSI phrase structures in `anlz.ts`:
- `phraseInOutBars()` finds intro and outro sections
- `dropOrRoll()` classifies drops vs rolling grooves
- Phrase kinds map to: intro (kind=1), chorus/drop (kind=5 HIGH mood),
  outro (kind=6 HIGH mood), with breakdown and build implied by position

```python
# Per-track: score each section with the energy pipeline
# (all sections LUFS-normalized to the same level first)
sections = extract_pssi_sections(track)  # intro, breakdown, build, drop
section_energies = {name: energy_pipeline(audio[s:e]) for name, (s, e) in sections}

# Kendall tau between composite and expected section order
expected_order = {'intro': 0, 'breakdown': 1, 'build': 2, 'drop': 3}
tau = kendalltau(
    [expected_order[s] for s in sorted_sections],
    [section_energies[s] for s in sorted_sections]
)
# Gate: median tau > 0.6 across all tracks with 4+ sections
```

### 5.4 Degradation Tests (Implementation Detail)

```python
# Three degradations, each applied to the drop section:
degradations = {
    'lowpass_4k':  lambda audio: apply_lowpass(audio, 4000),    # remove brightness
    'drums_minus9': lambda audio: attenuate_drums(audio, -9),   # reduce rhythmic energy
    'bass_cut':    lambda audio: apply_highpass(audio, 150),    # remove physical bass
}

for name, degrade in degradations.items():
    degraded_audio = degrade(drop_audio)
    degraded_score = energy_pipeline(degraded_audio)
    assert degraded_score < original_score  # must hold for ≥95% of tracks
```

### 5.5 Confidence Score (Free)

If Tier A and Tier B percentiles for a track disagree by more than 30
percentile points, store `energy_confidence = 'low'`. CrateDeck can
display it, and `energy-why` shows which bloc caused the disagreement.

### 5.6 Baseline Comparison

Energy 2.0 and v3 rev 1 run through the **same gates** as baselines.
**Ship v3.1 only if it wins.** This prevents regressions and makes the
comparison honest.

---

## 6. Phase 0 — PCA + Correlation Matrix (Prerequisite)

Before committing to ANY weights, run a correlation matrix and PCA on the
extracted features across the library. This takes about an hour and
prevents the "eight hand-picked weights that are really one hidden
judgment" problem.

### 6.1 What to check

1. **Correlation matrix**: identify pairs with |r| > 0.7. Correlated
   features go in the same bloc. If two features in different blocs
   correlate > 0.7, merge the blocs.
2. **PCA PC1**: if it explains ≥ 40% of variance and its loadings have
   intuitive signs (positive for onsets, brightness, aggression; negative
   for dynamic complexity), its loadings are a genuinely label-free
   energy axis. Use PC1 loadings mapped to blocs as the fifth weight
   preset.
3. **Variance check on arousal**: the DEAM training set has almost no EDM.
   If arousal variance on the library is IQR < 0.5, it may be as
   saturated as danceability — auto-exclude via the dead-signal rule.

### 6.2 What to output

- Correlation heatmap (for docs)
- PC1 loadings + variance explained
- Dead-signal report (any feature with IQR below threshold)
- Recommended bloc assignments (validated against the correlation matrix)

---

## 7. DB Schema

```sql
-- Per-track energy features (drop section, all tiers)
CREATE TABLE energy_features (
  video_id             TEXT PRIMARY KEY,
  -- Tier A: DSP
  onsets_per_beat       REAL,    -- onsets/beat (tempo-independent)
  bpm                  REAL,    -- from beats ledger
  hf_energy_re_lufs    REAL,    -- 4–12 kHz dB above drop LUFS
  low_energy_re_lufs   REAL,    -- 20–150 Hz dB above drop LUFS
  crest_factor         REAL,    -- inverted dynamic complexity
  spectral_flux        REAL,    -- mean frame-to-frame change
  lufs_drop            REAL,    -- EBU R128 short-term, drop section
  spectral_centroid    REAL,    -- tie-break within brightness bloc
  -- Tier B: pretrained effnet heads (drop window)
  aggressive           REAL,    -- mood_aggressive head on drop embedding
  engagement           REAL,    -- engagement regression head
  approachability      REAL,    -- approachability regression head (inverted)
  arousal_drop         REAL,    -- emomusic arousal on drop window
  -- Composite
  composite_rank       REAL,    -- weighted mean of bloc percentiles
  energy_band          INTEGER, -- E1–E9
  energy_confidence    TEXT,    -- 'high' or 'low' (tier disagreement)
  -- Metadata
  drop_start_s         REAL,
  drop_end_s           REAL,
  drop_contrast_db     REAL,    -- drop mean LUFS − rest mean LUFS
  low_drop_contrast    INTEGER DEFAULT 0,  -- flag: drop barely stands out
  weight_preset        TEXT NOT NULL,       -- which preset was used
  model_version        TEXT NOT NULL DEFAULT 'energy-v3.1',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Library-wide normalization reference (frozen)
CREATE TABLE energy_reference (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  -- Per-signal: sorted values for percentile lookup
  signals_json         TEXT NOT NULL,  -- {signal_name: sorted_values[]}
  -- Per-bloc: frozen sorted bloc percentiles
  blocs_json           TEXT NOT NULL,  -- {bloc_name: sorted_bloc_means[]}
  -- Composites
  frozen_composites    TEXT NOT NULL,  -- sorted composite scores
  -- Diagnostics
  dead_signals         TEXT,           -- JSON array of excluded signal names
  correlation_matrix   TEXT,           -- JSON {pair: r_value}
  pc1_loadings         TEXT,           -- JSON {signal: loading}
  pc1_variance_pct     REAL,           -- % variance explained by PC1
  -- Identity
  track_count          INTEGER NOT NULL,
  weight_preset        TEXT NOT NULL,
  frozen_at            TEXT NOT NULL,
  model_version        TEXT NOT NULL
);
```

---

## 8. CLI Commands

```bash
# Phase 0: correlation matrix + PCA (run before choosing weights)
megadj energy --phase0

# Phase 1: extract all features (Tier A + Tier B, drop section)
megadj energy --extract --jobs 4

# Phase 2: freeze reference + score all presets + run gates
megadj energy --freeze --score

# Phase 2 output: gate results for each preset
megadj energy --gates

# Full pipeline (extract → phase0 → freeze → score → gates)
megadj energy --full --jobs 4

# Shadow mode: diff report of biggest movers vs Energy 2.0
megadj energy --shadow --top 30

# Diagnostic: show bloc breakdown for one track
megadj energy-why <video_id>

# Switch over (only after gates pass)
megadj energy --apply

# Re-baseline (deliberate action)
megadj energy --refreeze
```

---

## 9. Migration Path

### Phase 0: PCA + Correlation (30 min)
- Extract raw Tier A + Tier B features for all tracks
- Compute correlation matrix, PCA, dead-signal check
- Output diagnostic report (correlation heatmap, PC1 loadings)
- Validate bloc assignments against correlation matrix
- Store Phase 0 results in `energy_reference`

### Phase 1: Feature Extraction (1 session)
- Write the Python energy feature extractor with corrected essentia calls:
  - `frame → Windowing → Spectrum → EnergyBand` (not raw audio)
  - `AudioLoader` for stereo LUFS (not MonoLoader)
  - HF band capped at 12 kHz
  - LUFS-normalize drop section before spectral features
  - Arousal re-run on drop window, not read from whole-track mood table
- Download `engagement` and `approachability` ONNX heads (~500 KB each)
- Run on all 3,800+ tracks via `--jobs 4`
- Store in `energy_features` table
- **No writes to tracks.energy or comments yet**

### Phase 2: Freeze + Score + Select (same session)
- Compute library-wide sorted values per signal for percentile lookup
- Freeze reference set
- Score all five weight presets against all validation gates
- Pick the preset that passes the most gates (ties: prefer Default)
- Compare distribution against Energy 2.0 on the same gates
- **Ship v3.1 only if it beats Energy 2.0 on every gate**

### Phase 3: Shadow Mode (brief)
- Generate diff report: the 30 biggest band movers vs Energy 2.0
- For each mover, show the bloc breakdown (which blocs pushed it up/down)
- Listen to a few of the big movers (~10 min, discretionary, not required)
- Sanity-check only — no labels collected

### Phase 4: Switchover
- Update `stageEnergy()` in `pipeline-stages.ts` to read from
  `energy_features.composite_rank` instead of `energyFromLufs()`
- Update `comment-sync.kit.py` `resolve_data_v4()` to use the new
  `energy_band` from `energy_features` table
- Update `tracks.energy` column to store the composite score
- Re-run `rb-comment-sync` to update all E1–E9 bands in comments
- Retire `energyFromLufs()`, `measureRms()`, and the arousal-only
  fallback in `comment-sync.kit.py`

### Phase 5: Bench Verification
- Run `megadj bench run energy` with all new gates
- Verify all gates pass
- Record Energy 2.0 → v3.1 comparison as a bench baseline
- Update docs with measured numbers

---

## 10. What This Deletes

- `energyFromLufs()` (pure RMS → 1–10 mapping) — replaced by composite
- Energy 2.0 blend (`0.5·RMS + 0.3·dance + 0.2·arousal`) — replaced
- `energy_from_mood` arousal-only fallback in `comment-sync.kit.py` — replaced
- `energy-model.ts` (Bradley-Terry pairwise model) — never used in
  production, superseded by the label-free composite
- The entire "three formulas that disagree" problem — one pipeline

---

## 11. What This Keeps

- `drop-energy.ts` / `computeDropEnergy()` — reused for drop-section
  window identification (extended with drop contrast calculation)
- `bar_features` table — reused for per-bar LUFS, onset density,
  low-band share, spectral flux
- `energyBand()` / `energyBandFromScores()` in `comment-v4.ts` — reused
  for E1–E9 percentile banding (input values change, banding math same)
- PSSI phrase parsing (`anlz.ts`) — reused for section-ordering gate
- `mood_aggressive` head in `models.ts` — reused as Tier B signal
- Discogs-effnet embedding pipeline — reused for all Tier B heads
- Track color mapping (E1–E9 → ColorID) — unchanged
- Bench harness energy stage — extended with new gates

---

## 12. Scalability

- **Per track:** one audio decode, one embedding pass (already run for
  mood), DSP over a single 16-bar drop. Roughly 0.3 s plus the existing
  mood cost, fully parallel with `--jobs N`.
- **New tracks:** scored against the frozen percentile tables at negligible
  cost, no recomputation for the rest of the library.
- **Re-baselining:** sorts each signal once — trivial even at 50k+ tracks.
- **Adding a new head later:** new column + inclusion in the Perceptual
  bloc. Nothing else changes.

---

## 13. Fixes Carried Over From the v3 Critique

| Fix | Detail |
|-----|--------|
| Cap HF at 12 kHz | YouTube codec cutoffs at 15–17 kHz don't masquerade as brightness |
| LUFS-normalize drop before spectral features | Mastering loudness doesn't leak into every spectral ratio |
| Energy relative to loudness, not shares | Bass and HF as dB above LUFS — they stop cancelling each other |
| Arousal on drop window, not whole track | Drop-only arousal matches the measurement window of all other features |
| Correct essentia calls | `EnergyBand` gets a spectrum (frame→window→spectrum→band); LUFS gets stereo via `AudioLoader` |
| No-drop fallback | If drop contrast < 3 dB: 75% drop + 25% whole-track median, flag `low_drop_contrast` |
| BPM as explicit signal | Controlled weight (0.05–0.08 within Rhythm bloc), not smuggled through onset density |
| Onsets per beat | Tempo-independent rhythmic complexity — D&B at 174 doesn't auto-win |

---

## 14. Research Sources

| Source | Key Contribution | Licence |
|--------|-----------------|---------|
| **Mixed In Key** (official docs) | High-frequency content is the primary energy signal, not loudness | Proprietary (observation only) |
| **director-signals** (le-director/director-signals) | Deterministic tension = RMS + onset density + spectral features, no ML | MIT-adjacent |
| **essentia** (MTG/essentia) | DynamicComplexity, EnergyBand, SpectralContrast, OnsetRate extractors + pretrained classification heads (engagement, approachability, mood_aggressive) | AGPL (already a dependency) |
| **DynaMix** (makalin/dynamix) | RMS energy profiles + section detection for DJ transitions | Open source |
| **dj-track-similarity** (MeteorBurn) | SONARA features: rhythm, dynamics, timbre, tonal, BPM, key, energy | Personal use |
| **djkr8** (djkr8) | Energy flow management with E1–E5 range, constraint-based set ordering | Open source |
| **Streich 2007** | DynamicComplexity algorithm: average absolute deviation from global loudness on dB scale | Academic |
| **AcousticBrainz** | Rank normalization of multi-feature composites across large libraries | CC0 |
| **Huron, *Sweet Anticipation*** | ITPRA framework — theoretical grounding for tension/energy as multi-factor composite | Academic |

---

## 15. Relationship to v3 Plan

This doc **replaces** v3 landscape §5 (pairwise-calibrated model) and
energy-v3-plan rev 1 (single formula). Everything else in the v3 plan is
unaffected:
- §3 BPM quantization fix — orthogonal
- §4 Genre Dawid–Skene estimator — orthogonal
- §6 Structure/cues — the section-ordering gate reuses PSSI infra
- §7 Per-bar feature store — Tier A reuses `bar_features`

WS7 in the rebench plan references this doc. The bench harness energy
stage (`bench/stages/energy.ts`) should be updated to run the new gates
from §5.2.

**Effort estimate:** 3–4 sessions (1 for Phase 0 + extraction, 1 for
scoring + gate evaluation, 1 for shadow mode + switchover, 1 for bench
verification and docs).
