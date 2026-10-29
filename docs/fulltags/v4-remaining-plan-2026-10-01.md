# v4 Comment — Remaining Work Plan

**Oct 1 2026** · Status: **8/9 tokens shipped** — VOX/HOOK is the last reserved token

## Current state

```
E8 IN:32 OUT:16 Drop Dark · MelTechno+DeepHouse
```

3,656/3,658 tracks have valid v4 comments. Zero format errors validated
across the entire library.

### Shipped tokens (8/9)

| Token | Coverage | Source |
|-------|----------|--------|
| E1–E9 | 100% | `tracks.energy` percentile-ranked library-wide |
| IN/OUT | 74.7% (2,731) | PSSI phrase decode from ANLZ `.EXT` files |
| Drop/Roll | 97.5%/2.5% of IN/OUT | CHORUS ≥ 8 bars = Drop |
| Hard/Soft | 18.3%/22.7% | `mood.aggressive` within-family percentile |
| Dark/Euph | 20.5%/20.4% | `mood.happy` within-family percentile |
| VAR | 3.6% | `beats.bpm_residual_std > 15.0` |
| · Subgenre | 64.4% | `genre_secondary` + tertiary fallback |
| Track color | 100% | Energy band → ColorID map |
| My Tags | 100% | Energy/Mood/Tempo categories |

### Not yet shipped (1/9)

| Token | What it needs | Effort |
|-------|--------------|--------|
| **VOX/HOOK** | Vocal stem separation pipeline (Demucs or VAD batch) | ~3–4 sessions |

## Remaining work items

### 1. VOX/HOOK — Vocal detection pipeline

**Goal:** Tag each track with VOX (vocals in intro/outro mix zones) or
HOOK (vocals present but only in the body — clean mix zones).

**Approach options:**

| Option | Pro | Con |
|--------|-----|-----|
| A. Demucs stem separation | Gold-standard vocal isolation | ~30s/track GPU, ~2min/track CPU; 3,600 tracks = 3+ hours GPU |
| B. Silero VAD | Fast (real-time), lightweight | Detects speech, not singing — false negatives on melodic vocals |
| C. ONNX vocal classifier | Medium speed, can batch | Needs training data or a pretrained model |

**Recommended: Option A (Demucs htdemucs_ft)** — one-time batch, results
persist in `beats` table as `vocal_zones` JSON.

**Unified Demucs runner ([#556](https://github.com/webuildstuffio/megadj/issues/556)):**
The `megadj stems` command runs Demucs once per track and caches ALL 4 stems
(vocals, drums, bass, other). Three consumers share that cache:
- **VOX/HOOK** (#429): reads vocals stem → per-bar RMS → zone classification
- **XZ Mods stem export** ([#555](https://github.com/webuildstuffio/megadj/issues/555)):
  reads all 4 stems → writes OverCue format → FAT32 playing USB
- **Grid audit**: reads bass+drums → per-bar energy

**Implementation plan:**

1. Add `vocal_zones` column to `beats` table (JSON array of `{start_s, end_s}`)
2. `megadj stems` runs Demucs batch, caches 4 stems per track, ledgers in `stem_cache` table
3. VOX/HOOK module reads cached vocals stem → energy-threshold detection
4. In `resolve_data_v4`: read vocal zones, compare vs intro/outro beat
   positions from PSSI → VOX if vocals overlap mix zones, HOOK otherwise
5. Wire into `buildCommentV4` (already has the slot)
6. Bench against 50 manually-labeled tracks before fleet-wide run

**Dependencies:** `demucs` (pip/uv), PyTorch (CPU-only OK but slow; MPS on Apple Silicon ~30s/track).
No hardware dependency — runs on the Mac.

### 2. Multi-genre subgenre display (this session)

**Goal:** Show secondary + tertiary genre in the subgenre slot when both
are available and different from primary.

**Format:** `· MelTechno+DeepHouse` (plus-separated, both abbreviated)

**Current coverage:**
- Secondary genre: 60% (2,744 tracks)
- Tertiary genre: 14% (669 tracks)
- Both secondary AND tertiary (different from primary): ~10%

**Implementation:** Modify `resolve_data_v4` to emit `subgenre` as
`Abbrev1+Abbrev2` when both secondary and tertiary exist and differ.

### 3. Hardware validation

**Goal:** Confirm v4 comments render correctly on Pioneer hardware.

**Steps:**
1. Export from rekordbox to USB
2. Load on XDJ-XZ / CDJ-3000
3. Verify: comment text visible, My Tags filter works, color displays correctly
4. Check character rendering (the `·` separator, `&` in genres)

### 4. Web guide for DJs (this session)

**Goal:** One-pager HTML guide explaining what each token means and how
to use the metadata while DJing. Printable.

## Timeline

| Item | When | Blocked on |
|------|------|-----------|
| Multi-genre subgenre | Now | Nothing |
| Web guide | Now | Nothing |
| Hardware validation | Next drive day | Physical hardware |
| VOX/HOOK pipeline | Future session | `megadj stems` runner (#556) + bench |
| XZ Mods stem export | Future session | `megadj stems` + OverCue writer (#555) |

## Files involved

| File | Role |
|------|------|
| `src/fulltags/booth/comment-v4.ts` | Builder + parser + abbreviations |
| `src/fulltags/booth/comment-v4.test.ts` | 54 tests |
| `src/fulltags/analysis/anlz.ts` | PSSI phrase parser |
| `src/rekordbox/rb-scripts/comment-sync.kit.py` | Python builder + PSSI + all sync |
| `src/rekordbox/rb-comment-sync.ts` | TS orchestrator |
| `src/rekordbox/rb-comment-sync-parse.ts` | Wire payload parser |
| `docs/fulltags/v4-guide.html` | DJ-facing web guide |
