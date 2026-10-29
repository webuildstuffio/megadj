# Stems Batch — Demucs MLX Stem Separation

## What this does
Separate audio tracks into 4 stems (vocals, drums, bass, other) using demucs-mlx on Apple Silicon. Pause-safe, genre-prioritized, with full batch logging.

## Quick start

```bash
# Standard 1000-track batch on GREY FIKWOK (priority EDM/House first)
MEGADJ_STEM_DIR="/Volumes/GREY FIKWOK/stems" bun run megadj stems --limit 1000

# Check progress
megadj stem-status --json

# Check batch log
tail -5 "/Volumes/GREY FIKWOK/stems/batch-log-$(date +%F).jsonl"

# Dry run (see what would be separated)
MEGADJ_STEM_DIR="/Volumes/GREY FIKWOK/stems" bun run megadj stems --limit 500 --dry-run
```

## Architecture

- **Engine:** `demucs-mlx` (pure MLX, Metal-accelerated, same htdemucs_ft weights)
- **Speed:** ~32s/track avg (~9x realtime) on M4 Pro 48 GB
- **Output:** FLAC 16-bit stereo @ 44.1 kHz, 4 stems per track (~80 MB/track)
- **Worker:** Persistent NDJSON process, loads model once, separates tracks one-by-one
- **Memory:** MLX cache capped at 6 GB, cleared after every track. `batch_size=1`.

## Key files

| File | Role |
|---|---|
| `src/fulltags/analysis/stems.ts` | Orchestrator: queue, genre sort, limits, batch log, DB persist |
| `src/fulltags/analysis/stems-session.ts` | Worker session: spawn uv + demucs-mlx, NDJSON protocol |
| `src/fulltags/analysis/stems-worker.py` | Python worker: MLX Separator, memory management, FLAC output |
| `src/core/state.ts` | `setStemRecord()` / `stemRecord()` — per-track atomic commit |

## Duration caps

- **Min: 30 seconds** — sub-30s clips produce unusable stems
- **Max: 10 minutes** — sets/mixes are too long (override with `--max-seconds 0`)

## Genre priority

EDM/House/Dance genres are sorted first in the queue: House, Tech House, Deep House, Progressive House, Techno, EDM, Trance, Disco, etc. (full list in `PRIORITY_GENRES`). This means a `--limit 1000` batch will process the DJ-relevant tracks first.

## Pause/resume safety

Each track commits to `stem_cache` via `INSERT OR REPLACE` immediately after separation. If the batch is killed (Ctrl+C, crash, OOM), re-running the same command skips all cached tracks and continues from where it left off. Zero data loss.

## Batch logging

A dated JSONL log is written to the stem dir:
- `batch-log-YYYY-MM-DD.jsonl` in the stemDir
- One line per track: `{ts, type:"track", videoId, label, genre, status, elapsedS, durationS, outputMB}`
- Summary at end: `{type:"batch_end", separated, failed, batchElapsedMin, avgTrackS}`

## Monitoring a running batch

```bash
# Live tail of terminal output
# (or check the batch log on FIKWOK)
python3 -c "
import json
lines = open('/Volumes/GREY FIKWOK/stems/batch-log-$(date +%F).jsonl').readlines()
ok = sum(1 for l in lines if '\"status\":\"ok\"' in l)
err = sum(1 for l in lines if '\"status\":\"error\"' in l)
print(f'{ok} ok, {err} errors')
"

# DB count
sqlite3 ~/.local/state/megadj/archive.db "SELECT COUNT(*) FROM stem_cache"
```

## Memory crash fix (GPU Timeout)

The original torch Demucs + shifts=2 caused `kIOGPUCommandBufferCallbackErrorTimeout` after ~22 tracks. Fixed by:
1. `mx.set_cache_limit(6 * 1024**3)` — cap MLX Metal cache at 6 GB
2. `mx.clear_cache()` + `gc.collect()` after every track
3. `batch_size=1` in Separator constructor

## Environment

| Var | Default | Purpose |
|---|---|---|
| `MEGADJ_STEM_DIR` | `~/.local/state/megadj/stems/` | Stem cache directory |
| `DEMUCS_MODEL` | `htdemucs_ft` | Model name (don't change) |

## CLI flags

| Flag | Effect |
|---|---|
| `--limit N` | Process at most N tracks |
| `--force` | Re-separate even if cached |
| `--dry-run` | Show what would be separated |
| `--json` | JSON summary output |
| `--max-seconds N` | Override 10-min cap (0 = no cap) |

## Downstream consumers

After stems are cached, run:
1. `megadj vocal-zones` — classify VOX/HOOK from vocal stems
2. `megadj stem-export <volume>` — write OverCue PGZ mixes to USB for XDJ-XZ
3. `megadj rb-comment-sync` — write VOX/HOOK to booth comments

## Future: hierarchical ensemble (Phase 2)

BS-Roformer for vocals → htdemucs_ft on cleaned instrumental for drums/bass/other.
+3 dB avg across all stems. Requires `mlx-audio-separator` for BS-Roformer.
Build automated eval harness (megadj stems-eval) first. See `docs/stems/stems-pipeline-plan-2026-10-29.md`.
