# Stems Pipeline — Ultimate Validated Plan v3

> Status: **Phase 1 SHIPPED** — demucs-mlx running, 681/4184 tracks separated
> Last measured: Oct 29 2026 15:59 EDT
> Hardware: Apple M4 Pro, 48 GB, macOS

---

## Progress Dashboard

| Metric | Value | Notes |
|---|---|---|
| **stem_cache** | **681 / 4,184** tracks | 16.3% of downloaded library |
| Priority genre cached | ~500 / 2,842 | EDM/House/Techno first |
| Priority remaining | 2,342 | ~21h at 32s/track |
| VOX/HOOK classified | 570 / 681 | 288 VOX, 282 HOOK |
| Stems on disk | 54 GB | `/Volumes/GREY FIKWOK/stems/` |
| Free space | 1.7 TB | Plenty for full fleet (~330 GB) |
| Avg speed | 32s/track | ~9x realtime on M4 Pro |
| Errors today | 0 | GPU timeout fixed by memory safety |

### Genre breakdown (top 10 cached)

| Genre | Cached | % of genre |
|---|---|---|
| House | 165 | 17.6% of 940 |
| Techno | 119 | 20.8% of 571 |
| Tech House | 64 | 16.8% of 380 |
| Progressive House | 31 | 16.6% of 187 |
| Deep House | 30 | 17.6% of 170 |
| Hip-Hop | 26 | 6.8% of 382 |
| Edits / Bootlegs | 25 | 15.3% of 163 |
| Afro House | 22 | 24.2% of 91 |
| Trance | 19 | 19.4% of 98 |
| Bass House | 11 | 16.2% of 68 |

### Issues closed

- [#556](https://github.com/webuildstuffio/megadj/issues/556) — Unified Demucs runner (CLOSED)
- [#555](https://github.com/webuildstuffio/megadj/issues/555) — XZ Mods stem pipeline (CLOSED)
- [#429](https://github.com/webuildstuffio/megadj/issues/429) — VOX/HOOK vocal detection (CLOSED)

---

## Phase 1: demucs-mlx baseline — SHIPPED ✅

Committed `49797500`, pushed Oct 29 2026.

| Change | Detail |
|---|---|
| Engine | torch Demucs → demucs-mlx (pure MLX, Metal) |
| Speed | ~2.5x → ~9x realtime (3.6x faster) |
| shifts | 2 → 1 (ZFTurbo: +0.01 dB — identical) |
| Memory | 6 GB cache limit + clear per track + batch_size=1 |
| Duration | Skip < 30s and > 10 min |
| Genre | Priority sort: EDM/House/Dance first |
| Logging | JSONL batch log in stemDir |
| Persistence | Per-track atomic commit to stem_cache |

### Lessons learned (hardened into code + AGENTS.md)

1. **GPU Timeout after ~22 tracks** — Metal command buffer timeout (`kIOGPUCommandBufferCallbackErrorTimeout`). Root cause: MLX Metal cache grows unbounded. Fix: `mx.set_cache_limit(6GB)` + `mx.clear_cache()` + `gc.collect()` after every track + `batch_size=1`.

2. **Drive rename breaks batch** — `SHELF1` renamed to `GREY FIKWOK` mid-session. The old `MEGADJ_STEM_DIR=/Volumes/SHELF1/stems` path gave PermissionError (macOS returns PermissionError for absent mount points, not ENOENT). Fix: always use the env var, never hardcode.

3. **shifts=2 vs shifts=1** — ZFTurbo measured on Multisong 100-track: +0.01 dB drums, +0.00 dB bass. Functionally identical. shifts=1 is the permanent policy.

4. **FLAC not WAV** — XDJ-XZ reads PGZ (zlib s16le 96kHz), not our FLAC cache. FLAC sequential reads are faster than WAV (2.5x smaller I/O compensates for decode). Apple's AVAudioFile FLAC seek bug (0.75s) doesn't apply — we do full-file reads.

5. **Deprecated MLX API** — `mx.metal.clear_cache()` → `mx.clear_cache()`. The `mx.metal.*` variants still work but warn.

---

## Phase 2: Automated evaluation harness — PLANNED

Build `megadj stems-eval` to compare models without human scoring.

**Metrics (no ground truth needed):**
- 40% VOX/HOOK accuracy (our primary consumer)
- 25% cross-stem bleed (Pearson correlation between stem pairs)
- 20% spectral band leakage (energy in wrong frequency bands)
- 15% reconstruction error (sum stems vs original)

**Protocol:** 20 diverse EDM test tracks → separate with model A and B → score 4 metrics → weighted winner.

---

## Phase 3: Hierarchical ensemble — PLANNED (if eval passes)

BS-Roformer vocals → htdemucs_ft on cleaned instrumental → drums/bass/other.

| Stem | htdemucs_ft alone | Hierarchical | Gain |
|---|---|---|---|
| Vocals | 8.33 | 11.93 | +3.60 dB |
| Drums | 11.24 | 14.33 | +3.09 dB |
| Bass | 12.05 | 14.85 | +2.80 dB |
| Other | 5.74 | 9.00 | +3.26 dB |

2.75x compute for +3 dB avg. One-time fleet cost: ~10h.

---

## Cost-Per-Gain Summary

| Tier | Quality | Speed | Fleet Hours | Status |
|---|---|---|---|---|
| **1. demucs-mlx** | **Baseline** | **9x realtime** | **~13h** | **✅ SHIPPED** |
| 2. Hierarchical | +3 dB avg | 11s/track | ~10h | PLANNED |
| 3. BS-Roformer only | +1.67 dB vocals | 7s/track | ~7h | — |
| 4. Contest (7+ models) | +0.2 dB more | 600x slower | ~2400h | Never |

---

## Running a batch

```bash
# Resume the fleet (picks up where it left off)
MEGADJ_STEM_DIR="/Volumes/GREY FIKWOK/stems" bun run megadj stems --limit 1000

# Check progress
bun run megadj stem-status --json
tail -5 "/Volumes/GREY FIKWOK/stems/batch-log-$(date +%F).jsonl"

# After stems: run downstream
bun run megadj vocal-zones --limit 500
bun run megadj stem-export "GREY FIKWOK"
bun run megadj rb-comment-sync
```
