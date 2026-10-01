"""P6: Compare position-only vs RMS-guided drop finder on real tracks.

Loads audio + downbeats, computes per-bar RMS, runs both heuristics,
and reports how often the RMS-guided finder picks a different (louder)
section than the position-only finder.

Usage:
    uv run --python python3.12 --with essentia-tensorflow --with numpy \
      python tools/probe_drop_finder.py [--db PATH] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float32]
SR = 16000


def load_mono(path: str) -> FloatArray | None:
    """Load audio at 16kHz mono via essentia."""
    try:
        from essentia.standard import MonoLoader  # type: ignore[import-not-found]

        return MonoLoader(filename=path, sampleRate=SR)().astype(np.float32)  # type: ignore[no-any-return]
    except Exception:
        return None


def rms_per_bar(audio: FloatArray, downbeats: list[float]) -> list[float]:
    """Compute RMS energy for each bar defined by consecutive downbeat pairs."""
    rms: list[float] = []
    for i in range(len(downbeats)):
        s = int(downbeats[i] * SR)
        if i + 1 < len(downbeats):
            e = int(downbeats[i + 1] * SR)
        else:
            e = min(s + int(2.0 * SR), len(audio))
        segment = audio[s:e]
        if len(segment) < 100:
            rms.append(0.0)
        else:
            rms.append(float(np.sqrt(np.mean(segment**2))))
    return rms


def find_drop_position_only(
    downbeats: list[float], n: int = 3
) -> list[tuple[float, float, float]]:
    """Port of the ORIGINAL (position+density only) drop finder."""
    if len(downbeats) < 33:
        return []
    total_dur = downbeats[-1] - downbeats[0]
    if total_dur <= 0:
        return []

    candidates: list[tuple[float, float, float, float]] = []
    for i in range(len(downbeats) - 32):
        start = downbeats[i]
        end = downbeats[i + 32]
        mid = (start + end) / 2
        rel_pos = (mid - downbeats[0]) / total_dur
        pos_score = 1.0 - 4.0 * (rel_pos - 0.5) ** 2
        dur = end - start
        mean_iv = dur / 32 if dur > 0 else 2.0
        density_score = 2.0 / max(0.5, mean_iv)
        score = pos_score * 0.7 + density_score * 0.3
        candidates.append((score, start, end, float(i)))

    candidates.sort(key=lambda x: -x[0])
    result: list[tuple[float, float, float]] = []
    for score, start, end, _idx in candidates:
        overlap = any(start < re and end > rs for rs, re, _ in result)
        if not overlap:
            result.append((start, end, score))
        if len(result) >= n:
            break
    return result


def find_drop_rms_guided(
    downbeats: list[float], bar_rms: list[float], n: int = 3
) -> list[tuple[float, float, float]]:
    """The NEW RMS-guided drop finder (mirrors P6 TS implementation)."""
    if len(downbeats) < 33 or len(bar_rms) < len(downbeats):
        return []
    total_dur = downbeats[-1] - downbeats[0]
    if total_dur <= 0:
        return []

    raw_pos: list[float] = []
    raw_density: list[float] = []
    raw_rms: list[float] = []

    total_bars = len(downbeats)
    section_bars = min(32, total_bars)

    for i in range(total_bars - section_bars + 1):
        mid_bar = i + section_bars / 2
        pos_frac = mid_bar / total_bars
        raw_pos.append(1.0 - 4.0 * (pos_frac - 0.5) ** 2)

        ivs = [
            downbeats[j + 1] - downbeats[j]
            for j in range(i, i + section_bars - 1)
            if downbeats[j + 1] - downbeats[j] > 0
        ]
        mean_iv = sum(ivs) / len(ivs) if ivs else 2.0
        raw_density.append(2.0 / max(0.5, mean_iv))

        rms_sum = sum(bar_rms[j] for j in range(i, i + section_bars))
        raw_rms.append(rms_sum / section_bars)

    def minmax(vals: list[float]) -> list[float]:
        lo, hi = min(vals), max(vals)
        rng = hi - lo
        if rng < 1e-12:
            return [0.0] * len(vals)
        return [(v - lo) / rng for v in vals]

    norm_pos = minmax(raw_pos)
    norm_dens = minmax(raw_density)
    norm_rms = minmax(raw_rms)

    scored = [
        (norm_rms[i] * 0.5 + norm_pos[i] * 0.35 + norm_dens[i] * 0.15, i)
        for i in range(len(raw_pos))
    ]
    scored.sort(key=lambda x: -x[0])

    result: list[tuple[float, float, float]] = []
    for score, idx in scored:
        start = downbeats[idx]
        end_idx = min(idx + section_bars, len(downbeats) - 1)
        end = downbeats[end_idx] + (downbeats[end_idx] - downbeats[max(0, end_idx - 1)])
        overlap = any(start < re and end > rs for rs, re, _ in result)
        if not overlap:
            result.append((start, end, score))
        if len(result) >= n:
            break
    return result


def section_rms(audio: FloatArray, start: float, end: float) -> float:
    """Mean RMS of a time range."""
    s, e = int(start * SR), int(end * SR)
    seg = audio[s:e]
    if len(seg) < 100:
        return 0.0
    return float(np.sqrt(np.mean(seg**2)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.expanduser("~/.local/state/megadj/archive.db"))
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    rows = conn.execute("""
        SELECT t.video_id, t.file_path, b.downbeats_json
        FROM tracks t
        JOIN beats b ON b.video_id = t.video_id
        WHERE t.status = 'downloaded'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.file_path IS NOT NULL
          AND b.downbeats_json IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ?
    """, (args.limit,)).fetchall()
    conn.close()

    print(f"Loaded {len(rows)} tracks", file=sys.stderr)

    moved = 0
    rms_wins = 0
    rms_loses = 0
    total = 0
    t0 = time.time()

    for i, (_vid, fpath, db_json) in enumerate(rows):
        try:
            downbeats: list[float] = json.loads(db_json)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(downbeats, list) or len(downbeats) < 33:
            continue
        if not os.path.exists(fpath):
            continue

        audio = load_mono(fpath)
        if audio is None:
            continue

        bar_rms_vals = rms_per_bar(audio, downbeats)

        pos_sections = find_drop_position_only(downbeats, 1)
        rms_sections = find_drop_rms_guided(downbeats, bar_rms_vals, 1)

        if not pos_sections or not rms_sections:
            continue

        total += 1
        pos_start, pos_end, _pos_score = pos_sections[0]
        rms_start, rms_end, _rms_score = rms_sections[0]

        if abs(pos_start - rms_start) > 5.0:
            moved += 1
            pos_loudness = section_rms(audio, pos_start, pos_end)
            rms_loudness = section_rms(audio, rms_start, rms_end)
            if rms_loudness > pos_loudness * 1.02:
                rms_wins += 1
            elif pos_loudness > rms_loudness * 1.02:
                rms_loses += 1

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            print(
                f"  [{i+1}/{len(rows)}] {total} valid, {moved} moved, "
                f"rms_wins={rms_wins} rms_loses={rms_loses} "
                f"({elapsed:.0f}s)",
                file=sys.stderr,
            )

    elapsed = time.time() - t0
    pct_moved = moved / total * 100 if total > 0 else 0
    pct_wins = rms_wins / moved * 100 if moved > 0 else 0

    print("\n--- P6 Drop Finder Comparison ---", file=sys.stderr)
    print(f"Tracks analyzed: {total}", file=sys.stderr)
    print(f"Sections moved:  {moved}/{total} ({pct_moved:.1f}%)", file=sys.stderr)
    print(f"RMS picks louder: {rms_wins}/{moved} ({pct_wins:.1f}%)", file=sys.stderr)
    print(f"RMS picks quieter: {rms_loses}/{moved}", file=sys.stderr)
    print(f"Same loudness: {moved - rms_wins - rms_loses}/{moved}", file=sys.stderr)
    print(f"Time: {elapsed:.0f}s", file=sys.stderr)

    json.dump({
        "total": total,
        "moved": moved,
        "rms_wins": rms_wins,
        "rms_loses": rms_loses,
        "pct_moved": round(pct_moved, 1),
        "pct_wins": round(pct_wins, 1),
        "elapsed_s": round(elapsed),
    }, sys.stdout)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
