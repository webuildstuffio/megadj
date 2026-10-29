# Stems Batch — Demucs MLX Stem Separation

## What this does
Separate audio tracks into 4 stems (vocals, drums, bass, other) using demucs-mlx on Apple Silicon. Pause-safe, genre-prioritized, with full batch logging on GREY FIKWOK.

## Quick start

```bash
# Standard batch on GREY FIKWOK (priority EDM/House first, resumes automatically)
MEGADJ_STEM_DIR="/Volumes/GREY FIKWOK/stems" bun run megadj stems --limit 1000

# Check progress
bun run megadj stem-status --json
tail -5 "/Volumes/GREY FIKWOK/stems/batch-log-$(date +%F).jsonl"

# Dry run (see what would be separated)
MEGADJ_STEM_DIR="/Volumes/GREY FIKWOK/stems" bun run megadj stems --limit 500 --dry-run
```

## Architecture

- **Engine:** `demucs-mlx` (pure MLX, Metal-accelerated, `htdemucs_ft` weights — identical to torch, < 1 ppm)
- **Speed:** ~32s/track avg (~9x realtime) on M4 Pro 48 GB
- **Output:** FLAC 16-bit stereo @ 44.1 kHz, 4 stems per track (~80 MB/track)
- **Worker:** Persistent NDJSON process over stdin/stdout, loads model once, one track at a time
- **Memory:** MLX cache capped at 6 GB, cleared after every track + gc.collect(). `batch_size=1`.
- **Persistence:** Per-track atomic `INSERT OR REPLACE INTO stem_cache` — crash-safe, auto-resume
- **Genre priority:** EDM/House/Dance genres sorted first via `PRIORITY_GENRES` set
- **Logging:** Dated JSONL in stemDir, one line per track + batch summary

## Key files

| File | Role |
|---|---|
| `src/fulltags/analysis/stems.ts` | Orchestrator: queue building, genre sort, duration caps, batch log, DB persist |
| `src/fulltags/analysis/stems-session.ts` | Worker session: spawn `uv run --with demucs-mlx`, NDJSON protocol, timeouts |
| `src/fulltags/analysis/stems-worker.py` | Python worker: MLX Separator, memory safety, FLAC output |
| `src/core/state.ts` | `setStemRecord()` / `stemRecord()` — per-track atomic DB commit |
| `src/fulltags/cli/cli-commands.ts` | CLI registration: `stems`, `stem-status`, `stem-export`, `vocal-zones` |

## Duration caps

- **Min: 30 seconds** — sub-30s clips produce unusable stems for OverCue/VOX/HOOK
- **Max: 10 minutes** — sets/mixes are too long and slow (override: `--max-seconds 0`)

## CLI flags

| Flag | Effect |
|---|---|
| `--limit N` | Process at most N tracks |
| `--force` | Re-separate even if cached |
| `--dry-run` | Show what would be separated |
| `--json` | JSON summary output |
| `--max-seconds N` | Override 10-min cap (0 = no cap) |

## Environment

| Var | Default | Purpose |
|---|---|---|
| `MEGADJ_STEM_DIR` | `~/.local/state/megadj/stems/` | Stem cache directory — use GREY FIKWOK for fleet runs |
| `DEMUCS_MODEL` | `htdemucs_ft` | Model name (don't change) |

## Pause/resume

Each track commits to `stem_cache` immediately after separation. Kill (Ctrl+C, crash, OOM) at any point — re-run the same command to resume. Tracks already in stem_cache are skipped. Zero data loss.

## Batch logging

Dated JSONL in stemDir: `batch-log-YYYY-MM-DD.jsonl`

Per-track line:
```json
{"ts":"...","type":"track","videoId":"...","label":"...","genre":"House","status":"ok","elapsedS":32,"durationS":295,"outputMB":80,"n":1,"total":1000}
```

Summary at batch end:
```json
{"ts":"...","type":"batch_end","separated":1000,"failed":0,"batchElapsedMin":560,"avgTrackS":32,"workerRestarts":0,"errorCount":0}
```

## Monitoring

```bash
# Quick count
sqlite3 ~/.local/state/megadj/archive.db "SELECT COUNT(*) FROM stem_cache"

# Detailed stats from log
python3 -c "
import json
lines = open('/Volumes/GREY FIKWOK/stems/batch-log-$(date +%F).jsonl').readlines()
ok = sum(1 for l in lines if '\"status\":\"ok\"' in l)
err = sum(1 for l in lines if '\"status\":\"error\"' in l)
print(f'{ok} ok, {err} errors')
"

# Full status with VOX/HOOK breakdown
bun run megadj stem-status --json
```

## Downstream pipeline (run AFTER stems)

```bash
# 1. Classify vocals → VOX/HOOK zones
bun run megadj vocal-zones --limit 500

# 2. Export OverCue PGZ mixes to USB for XDJ-XZ
bun run megadj stem-export "GREY FIKWOK"

# 3. Write VOX/HOOK to Rekordbox booth comments
bun run megadj rb-comment-sync
```

## Lessons learned (hardened)

### 1. GPU Timeout (kIOGPUCommandBufferCallbackErrorTimeout)
**Symptom:** Metal command buffer crashes after ~22 tracks.
**Root cause:** MLX Metal cache grows unbounded → GPU stalls.
**Fix (in code):** `mx.set_cache_limit(6GB)` at startup + `mx.clear_cache()` + `gc.collect()` after EVERY track + `batch_size=1`. All three are required.

### 2. Drive rename breaks batch
**Symptom:** `PermissionError` on `/Volumes/SHELF1/stems`.
**Root cause:** macOS returns PermissionError (not ENOENT) for absent mount points.
**Fix:** Always pass `MEGADJ_STEM_DIR` via env var. Never hardcode drive names. The code uses `nonEmptyEnv("MEGADJ_STEM_DIR")` with a local-SSD fallback.

### 3. shifts=2 vs shifts=1 — identical quality
ZFTurbo measured on Multisong 100-track benchmark: shifts=10 vs shifts=1 gained +0.01 dB drums, +0.00 dB bass. **shifts=1 is permanent policy.** Do NOT re-separate the early fleet batch that used shifts=2.

### 4. FLAC is optimal (not WAV)
XDJ-XZ reads PGZ (zlib-compressed s16le @ 96kHz), not our FLAC stems. FLAC sequential reads via soundfile are FASTER than WAV (2.5x smaller I/O compensates for ~20ms decode). The "bigger = faster" intuition only applies to random-access seeks.

### 5. Deprecated MLX API
`mx.metal.clear_cache()` → `mx.clear_cache()`. Worker has fallback for both. Check for new deprecations after MLX updates.

### 6. torch Demucs is retired
uv deps are `demucs-mlx` + `soundfile`. NOT `demucs==4.1.0` + torch. Don't revert to torch — it's 3.6x slower and has no memory management.

### 7. Concurrent CPU usage
Stems uses GPU (Metal) heavily. Running embeddings/mood (CPU-bound) concurrently is safe but may slow both. For maximum throughput, run stems overnight and CPU work during the day.

## Future: hierarchical ensemble

BS-Roformer for vocals → htdemucs_ft on cleaned instrumental for drums/bass/other. +3 dB avg across all stems. Requires `mlx-audio-separator` for BS-Roformer. Build automated eval harness (megadj stems-eval) first. See `docs/stems/stems-pipeline-plan-2026-10-29.md`.
