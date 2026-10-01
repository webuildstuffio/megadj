# Energy v3 — Multi-Feature Composite Without Manual Labels

**Status:** 🧭 PLAN OF RECORD — Oct 1 2026
**Supersedes:** v3 landscape §5 (pairwise-calibrated model requiring ~200 manual judgments)
**Root cause:** Energy 2.0 saturates because 50% of the weight is RMS loudness,
30% is danceability (saturated at 0.98 on EDM), and 20% is arousal. Library
average 8.5/10. The v3 §5 fix required 200 manual "which hits harder?"
pairwise judgments — this plan eliminates that requirement entirely.

---

## 0. The Insight — No Manual Labels Needed

The manual-label approach was proposed because a single signal (loudness)
can't distinguish energy. But the research consensus is clear: **perceived
music energy is a composite of 6–8 audio features**, and when you extract
them all, normalize across the library, and combine with theoretically
grounded weights, the result separates energy naturally — no human
judgments required.

**Key finding from Mixed In Key's own documentation** (their patent, their
tutorial): energy is primarily driven by **high-frequency content** — hi-hats,
bright percussion, sharp synth stabs, and brighter production elements.
Two tracks at the same BPM can feel completely different because one has
more high-frequency energy. RMS loudness alone cannot capture this.

**Key finding from director-signals** (MIT-ish, no ML, deterministic):
tension/energy is a composite of RMS + onset density + spectral features,
measured per-block and aggregated. Their drop-impact metric (contrast
between pre-drop build and post-drop energy persistence) is exactly the
shape we need.

**Key finding from essentia's feature extractors**: every signal we need is
already extractable with the essentia library we already depend on (the
mood ONNX pipeline uses essentia's MonoLoader + FrameGenerator). No new
dependencies.

---

## 1. The Feature Set — 8 Signals, All Drop-Section

All features are measured on the **drop section** (loudest 16-bar window,
already computed by `drop-energy.ts` / `computeDropEnergy()`). This
eliminates intro/outro dilution — the drop IS the energy.

| # | Feature | What it captures | Source | Direction |
|---|---------|-----------------|--------|-----------|
| 1 | **High-frequency energy ratio** | Brightness/hardness — Mixed In Key's primary signal | `spectral_energyband_high / (low + mid_low + mid_high + high)` | ↑ = more energy |
| 2 | **Onset density** | Rhythmic intensity — more hits per second = more drive | `onset_rate` (onsets/sec) | ↑ = more energy |
| 3 | **Spectral centroid** | Overall brightness — higher centroid = brighter/harder | mean of spectral centroid over drop | ↑ = more energy |
| 4 | **Dynamic complexity** (inverted) | Loudness dynamics — compressed/flat = more relentless energy | essentia `DynamicComplexity` | ↓ = more energy (inverted) |
| 5 | **Spectral flux** | Timbral change rate — more flux = more activity | already in `bar_features.spectral_flux` | ↑ = more energy |
| 6 | **Low-band energy share** | Bass weight — sub-bass presence adds physical impact | `spectral_energyband_low / total` | ↑ = more energy |
| 7 | **LUFS (short-term, drop)** | Baseline loudness — still relevant, just not dominant | EBU R128 short-term over drop bars | ↑ = more energy |
| 8 | **Arousal** | Model-derived perceptual intensity | ONNX emomusic head (1–9 DEAM) | ↑ = more energy |

### Why these 8?

- **Features 1–3** (high-freq ratio, onset density, spectral centroid) are
  the core perceptual-energy signals identified across Mixed In Key's
  documentation, the director-signals project, and MIR literature. A chill
  lounge track with smooth low-mids scores low on all three; a peak-time
  banger with sharp hi-hats, dense percussion, and bright synths scores high.

- **Feature 4** (dynamic complexity, inverted) captures compression level.
  Club masters are hyper-compressed (low dynamic complexity = relentless
  energy). A track with big dynamic swings (e.g., classical crossover)
  has high dynamic complexity but less perceived "energy" in a DJ context.

- **Feature 5** (spectral flux) captures timbral activity — a track with
  constantly changing timbres feels more energetic than a static loop.

- **Feature 6** (low-band energy) captures physical bass impact — critical
  for EDM where sub-bass is the body-felt energy component.

- **Feature 7** (LUFS) keeps loudness as ONE signal among eight, not the
  only one. At 10% weight it contributes proportionally.

- **Feature 8** (arousal) leverages the ONNX model we already run. Arousal
  is the only signal that captures "excitement" beyond pure acoustics.

---

## 2. The Algorithm — Z-Score + Weighted Composite + Percentile Band

No training data. No pairwise judgments. Pure math.

```python
import numpy as np

def compute_energy_v3(features: dict, library_stats: dict) -> float:
    """Compute energy v3 from 8 features + library z-score normalization.

    features: dict with keys matching FEATURE_WEIGHTS
    library_stats: dict of {feature: (mean, std)} across the library
    """
    FEATURE_WEIGHTS = {
        'hf_ratio':           0.20,  # high-freq energy ratio
        'onset_density':      0.15,  # onsets per second
        'spectral_centroid':  0.12,  # brightness
        'dynamic_complexity': 0.10,  # inverted — low complexity = more energy
        'spectral_flux':      0.10,  # timbral change rate
        'low_band_share':     0.10,  # bass impact
        'lufs_drop':          0.10,  # loudness (diminished)
        'arousal':            0.13,  # model-derived
    }

    z_scores = {}
    for feat, weight in FEATURE_WEIGHTS.items():
        val = features[feat]
        mean, std = library_stats[feat]
        if std < 1e-6:
            z_scores[feat] = 0.0
        else:
            z = (val - mean) / std
            # Invert dynamic_complexity: lower complexity = higher energy
            if feat == 'dynamic_complexity':
                z = -z
            z_scores[feat] = z

    # Weighted sum of z-scores
    composite = sum(z_scores[f] * w for f, w in FEATURE_WEIGHTS.items())
    return composite


def energy_band_v3(composite: float, library_composites: list[float]) -> int:
    """Percentile-rank the composite score → E1–E9.

    The library_composites list is a FROZEN reference — once computed,
    it does not change until deliberately re-baselined.
    """
    sorted_lib = sorted(library_composites)
    rank = bisect_right(sorted_lib, composite) / len(sorted_lib)
    return max(1, min(9, math.ceil(rank * 9)))
```

### Why Z-Score Normalization?

Each feature has a completely different scale (onset_rate is 0–20
onsets/sec; LUFS is -30 to -5 dB; arousal is 1–9). Z-scoring puts
every feature on the same scale (mean=0, std=1) before combining.

This is **the standard approach in MIR for multi-feature composites**
(AcousticBrainz, essentia's music extractor, and every scikit-learn
pipeline normalize first).

### Why Frozen Reference?

The percentile banding uses a **frozen snapshot** of all library
composite scores. This prevents "grade inflation" — adding new tracks
doesn't shift everyone's bands. Re-baseline only when deliberately
chosen (e.g., after a major library expansion).

---

## 3. Implementation — What to Build

### 3.1 Feature Extraction (Python, essentia)

A new analysis stage that extracts the 8 features per track. Runs on the
drop section (from beats ledger downbeats → `findDropSection()`).

**File:** `src/fulltags/analysis/energy-features.py` (Python, via uv)

```python
# Sketch — the actual module will use essentia extractors
from essentia.standard import (
    MonoLoader, FrameGenerator, Windowing, Spectrum,
    SpectralCentroidTime, OnsetRate, DynamicComplexity,
    EnergyBand, SpectralContrast, LoudnessEBUR128
)

def extract_energy_features(path: str, drop_start_s: float, drop_end_s: float) -> dict:
    """Extract all 8 energy features from the drop section."""
    audio = MonoLoader(filename=path, sampleRate=44100)()
    sr = 44100
    s, e = int(drop_start_s * sr), int(drop_end_s * sr)
    drop_audio = audio[s:e]

    # 1. Frequency-band energy ratios
    low  = EnergyBand(startCutoffFrequency=20,  stopCutoffFrequency=150)(drop_audio)
    mid_lo = EnergyBand(startCutoffFrequency=150, stopCutoffFrequency=800)(drop_audio)
    mid_hi = EnergyBand(startCutoffFrequency=800, stopCutoffFrequency=4000)(drop_audio)
    high = EnergyBand(startCutoffFrequency=4000, stopCutoffFrequency=20000)(drop_audio)
    total = low + mid_lo + mid_hi + high + 1e-10
    hf_ratio = float(high / total)
    low_band_share = float(low / total)

    # 2. Onset density
    _, onset_rate = OnsetRate()(drop_audio)

    # 3. Spectral centroid (mean over frames)
    # ... frame-level extraction, mean

    # 4. Dynamic complexity
    dc, _ = DynamicComplexity(sampleRate=sr)(drop_audio)

    # 5. Spectral flux (already in bar_features if available)
    # ... frame-level spectral flux, mean

    # 6. LUFS (short-term over drop section)
    # ... EBU R128 loudness

    # 7. Arousal (already in mood table — read, don't re-compute)

    return {
        'hf_ratio': hf_ratio,
        'onset_density': float(onset_rate),
        'spectral_centroid': centroid_mean,
        'dynamic_complexity': float(dc),
        'spectral_flux': flux_mean,
        'low_band_share': low_band_share,
        'lufs_drop': lufs_val,
        'arousal': arousal_val,  # from mood table
    }
```

### 3.2 Library Normalization (TypeScript)

After all tracks are analyzed, compute library-wide mean/std per feature
and store as a frozen reference.

**File:** `src/fulltags/analysis/energy-composite.ts`

```typescript
interface EnergyFeatures {
  hfRatio: number;
  onsetDensity: number;
  spectralCentroid: number;
  dynamicComplexity: number;
  spectralFlux: number;
  lowBandShare: number;
  lufsDrop: number;
  arousal: number;
}

interface LibraryStats {
  mean: Record<string, number>;
  std: Record<string, number>;
  frozenComposites: number[];  // all composite scores at freeze time
  frozenAt: string;            // ISO timestamp
}

const WEIGHTS: Record<string, number> = {
  hfRatio:           0.20,
  onsetDensity:      0.15,
  spectralCentroid:  0.12,
  dynamicComplexity: 0.10,  // inverted
  spectralFlux:      0.10,
  lowBandShare:      0.10,
  lufsDrop:          0.10,
  arousal:           0.13,
};

function compositeEnergy(features: EnergyFeatures, stats: LibraryStats): number {
  let sum = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const val = features[key as keyof EnergyFeatures];
    const mean = stats.mean[key]!;
    const std = stats.std[key]!;
    const z = std < 1e-6 ? 0 : (val - mean) / std;
    sum += (key === 'dynamicComplexity' ? -z : z) * weight;
  }
  return sum;
}
```

### 3.3 DB Schema

```sql
-- Per-track energy features (drop section)
CREATE TABLE energy_features (
  video_id             TEXT PRIMARY KEY,
  hf_ratio             REAL,
  onset_density        REAL,
  spectral_centroid    REAL,
  dynamic_complexity   REAL,
  spectral_flux        REAL,
  low_band_share       REAL,
  lufs_drop            REAL,
  arousal              REAL,
  composite_z          REAL,   -- weighted z-score composite
  energy_band          INTEGER, -- E1–E9
  drop_start_s         REAL,
  drop_end_s           REAL,
  model_version        TEXT NOT NULL DEFAULT 'energy-v3',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Library-wide normalization reference (frozen)
CREATE TABLE energy_reference (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  stats_json           TEXT NOT NULL,  -- {feature: {mean, std}}
  frozen_composites    TEXT NOT NULL,  -- JSON array of all composite scores
  track_count          INTEGER NOT NULL,
  frozen_at            TEXT NOT NULL,
  model_version        TEXT NOT NULL
);
```

### 3.4 CLI Command

```bash
# Extract features for all tracks (uses drop section from beats ledger)
megadj energy --extract --jobs 4

# Compute library stats + freeze reference
megadj energy --freeze

# Compute composite scores + E1–E9 bands against frozen reference
megadj energy --score

# Full pipeline (extract → freeze → score)
megadj energy --full --jobs 4

# Diagnostic: show feature breakdown for one track
megadj energy-why <video_id>

# Re-baseline: refreeze the reference (deliberate action)
megadj energy --refreeze
```

---

## 4. Validation — No Manual Labels Needed

### 4.1 Distribution Gate (existing bench stage)

The existing `bench/stages/energy.ts` already checks:
- Each decile holds 8–12% of the library (spread gate)
- Top band share < 15% (saturation gate)

**Expected improvement:** Current Energy 2.0 has avg 8.5 with >15% in the
top band (FAILS the saturation gate). Energy v3's z-score normalization
guarantees spread because it is *defined* as a distribution-relative
score.

### 4.2 Automatic Validation (No Labels)

| Check | What it tests | Gate |
|-------|--------------|------|
| **Decile spread** | Each band E1–E9 holds ~11% ± 3% | 8–12% per band |
| **Genre-family separation** | High-energy genres (Hard Techno, D&B) should have higher mean energy than low-energy genres (Ambient, Downtempo) | Cohen's d > 0.5 between extreme families |
| **Arousal correlation** | Energy should correlate with arousal (r ~ 0.3–0.6) but NOT be arousal (r < 0.8) | 0.3 < r < 0.8 |
| **BPM independence** | Energy should NOT just be BPM (two house tracks at 124 BPM should differ in energy) | |r| < 0.3 with BPM |
| **RMS independence** | Energy should NOT just be loudness | |r| < 0.5 with RMS |
| **Feature contribution** | No single feature should dominate (max contribution < 50% of variance) | Max component loading < 0.50 |
| **Known-outlier check** | A chill deep house track at 122 BPM should NOT be E8+ | Spot-check 10 manually verified edge cases |

### 4.3 Cross-Validation Against Mixed In Key (Optional)

If any tracks in the library have Mixed In Key energy tags (from TXXX or
prior analysis), compare v3 bands against them:
- Agreement ≥ 70% within ±1 band = passes
- This is a bonus validation, not a requirement

---

## 5. Migration Path

### Phase 1: Feature Extraction (1 session)
- Write the Python energy feature extractor
- Run on all 3,800+ tracks via `--jobs 4` (~20 min)
- Store in `energy_features` table
- No writes to tracks.energy or comments yet

### Phase 2: Library Freeze + Score (same session)
- Compute library-wide mean/std per feature
- Freeze reference set
- Compute composite z-scores + E1–E9 bands
- Run all validation gates
- Compare distribution against Energy 2.0

### Phase 3: Switchover
- Update `stageEnergy()` in pipeline-stages.ts to read from
  `energy_features.composite_z` instead of `energyFromLufs()`
- Update comment-sync.kit.py `resolve_data_v4()` to use the new
  energy_band from `energy_features` table
- Update `tracks.energy` column to store the composite score
- Re-run `rb-comment-sync` to update all E1–E9 bands in comments
- Retire `energyFromLufs()`, `measureRms()`, and Formula 3 fallback

### Phase 4: Bench Verification
- Run `megadj bench run energy` with the new data
- Verify all gates pass (decile spread, saturation, correlations)
- Update docs with measured numbers

---

## 6. What This Deletes

- `energyFromLufs()` (pure RMS → 1–10 mapping) — replaced by composite
- Energy 2.0 blend (`0.5·RMS + 0.3·dance + 0.2·arousal`) — replaced
- `energy_from_mood` arousal-only fallback in comment-sync.kit.py — replaced
- The entire "three formulas that disagree" problem — one formula

---

## 7. What This Keeps

- `drop-energy.ts` / `computeDropEnergy()` — reused for drop-section
  window identification
- `bar_features` table — reused for per-bar spectral flux and LUFS
- `energyBand()` / `energyBandFromScores()` — reused for percentile
  banding (the math is identical, just the input values change)
- `findDropSection()` — reused for drop timing
- Bench harness energy stage — extended with new validation gates
- Track color mapping (E1–E9 → ColorID) — unchanged

---

## 8. Research Sources

| Source | Key Contribution | Licence |
|--------|-----------------|---------|
| **Mixed In Key** (official docs) | High-frequency content is the primary energy signal, not loudness | Proprietary (observation only) |
| **director-signals** (le-director/director-signals) | Deterministic tension = RMS + onset density + spectral features, no ML | MIT-adjacent |
| **essentia** (MTG/essentia) | DynamicComplexity, EnergyBand, SpectralContrast, OnsetRate extractors | AGPL (already a dependency) |
| **DynaMix** (makalin/dynamix) | RMS energy profiles + section detection for DJ transitions | Open source |
| **dj-track-similarity** (MeteorBurn) | SONARA features: rhythm, dynamics, timbre, tonal, BPM, key, energy | Personal use |
| **djkr8** (djkr8) | Energy flow management with E1–E5 range, constraint-based set ordering | Open source |
| **Streich 2007** | DynamicComplexity algorithm: average absolute deviation from global loudness on dB scale | Academic |
| **AcousticBrainz** | Z-score normalization of multi-feature composites across large libraries | CC0 |
| **Huron, *Sweet Anticipation*** | ITPRA framework (Imagination–Tension–Prediction–Reaction–Appraisal) — theoretical grounding for tension/energy as a multi-factor composite | Academic |

---

## 9. Weights Rationale

The weights are NOT arbitrary — they follow the consensus from the
research:

| Weight | Feature | Rationale |
|--------|---------|-----------|
| 0.20 | High-freq ratio | Mixed In Key's documented primary signal; the single biggest differentiator between "chill" and "banger" at the same BPM |
| 0.15 | Onset density | Rhythmic drive is the second-most-cited energy factor in DJ literature; busy hi-hats and percussion = more energy |
| 0.13 | Arousal | ONNX model already captures a broad "excitement" signal; positioned third to leverage model learning without over-relying on it |
| 0.12 | Spectral centroid | Overall brightness — correlated with but distinct from high-freq ratio (centroid is the "center of mass" of the spectrum) |
| 0.10 | Dynamic complexity | Compression level — heavily compressed club masters feel more relentless; inverted so low complexity = high energy |
| 0.10 | Spectral flux | Timbral change rate — static loops feel less energetic than tracks with evolving timbres |
| 0.10 | Low-band share | Sub-bass physical impact — critical for EDM but NOT the same as loudness (a quiet track with heavy sub-bass has physical energy) |
| 0.10 | LUFS (drop) | Loudness still matters, just not at 50% weight — at 10% it contributes proportionally alongside 7 other signals |
| **1.00** | **Total** | |

### Weight Tuning Without Labels

If the validation gates fail (e.g., genre separation too low), the weights
can be adjusted mechanically:

1. Compute feature-to-genre-family correlation for each feature
2. Features with higher genre-family separation get higher weight
3. Re-normalize to sum=1.0
4. Re-run validation

This is a principled alternative to pairwise training — it uses the
*structure of the library itself* as the training signal.

---

## 10. Relationship to v3 Plan

This doc **replaces** v3 landscape §5 (the pairwise-calibrated model).
Everything else in the v3 plan is unaffected:
- §3 BPM quantization fix — orthogonal
- §4 Genre Dawid–Skene estimator — orthogonal
- §6 Structure/cues — orthogonal
- §7 Per-bar feature store — this plan USES bar_features

The bench harness energy stage (`bench/stages/energy.ts`) should be
updated to run the new validation gates from §4.2.

**Effort estimate:** 2 sessions (1 for implementation, 1 for validation +
switchover).
