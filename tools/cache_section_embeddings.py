"""Cache section embeddings for all tracks with effnet + downbeats.

Reads tracks from archive.db, computes 3 section embeddings per track
using the drop finder heuristic, stores in section_embeddings table.

Usage:
    uv run --python python3.12 --with essentia-tensorflow --with onnxruntime --with numpy \
      python tools/cache_section_embeddings.py [--db PATH] [--limit N] [--force]
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.lib.embedding import emb_effnet

FloatArray = NDArray[np.float32]
MODEL_DIR = Path.home() / ".local/share/fulltags-models"
EFFNET_PATH = MODEL_DIR / "discogs-effnet-bsdynamic-1.onnx"
MODEL_TAG = "effnet-discogs-1280"


def load_audio_section(path: str, start: float, end: float) -> FloatArray | None:
    """Load audio section at 16kHz mono."""
    try:
        from essentia.standard import MonoLoader  # type: ignore[import-not-found]

        audio = MonoLoader(filename=path, sampleRate=16000)()
        s = int(start * 16000)
        e = int(end * 16000)
        section = audio[s:e]
        if len(section) < 16000:
            return None
        return section.astype(np.float32)  # type: ignore[no-any-return]
    except Exception:
        return None


def load_full_audio(path: str) -> FloatArray | None:
    """Load full track at 16kHz mono (for RMS computation)."""
    try:
        from essentia.standard import MonoLoader

        return MonoLoader(filename=path, sampleRate=16000)().astype(np.float32)  # type: ignore[no-any-return]
    except Exception:
        return None


def rms_per_bar(audio: FloatArray, downbeats: list[float]) -> list[float]:
    """Compute RMS energy for each bar defined by consecutive downbeat pairs."""
    sr = 16000
    rms: list[float] = []
    for i in range(len(downbeats)):
        s = int(downbeats[i] * sr)
        e = (
            int(downbeats[i + 1] * sr)
            if i + 1 < len(downbeats)
            else min(s + int(2.0 * sr), len(audio))
        )
        segment = audio[s:e]
        if len(segment) < 100:
            rms.append(0.0)
        else:
            rms.append(float(np.sqrt(np.mean(segment**2))))
    return rms


def minmax_norm(vals: list[float]) -> list[float]:
    """Min-max normalize to [0, 1]."""
    lo, hi = min(vals), max(vals)
    rng = hi - lo
    if rng < 1e-12:
        return [0.0] * len(vals)
    return [(v - lo) / rng for v in vals]


def find_drop_candidates(downbeats: list[float], n: int = 3) -> list[tuple[float, float]]:
    """Port of drop-finder.ts — picks top N 32-bar windows by position + density score."""
    if len(downbeats) < 33:
        return []

    total_dur = downbeats[-1] - downbeats[0]
    if total_dur <= 0:
        return []

    candidates = []
    for i in range(len(downbeats) - 32):
        start = downbeats[i]
        end = downbeats[i + 32]
        mid = (start + end) / 2
        rel_pos = (mid - downbeats[0]) / total_dur

        pos_score = 1.0 - abs(rel_pos - 0.5) * 2.0
        dur = end - start
        density_score = 1.0 - min(dur / total_dur, 1.0) if total_dur > 0 else 0.5

        score = pos_score * 0.7 + density_score * 0.3
        candidates.append((score, start, end))

    candidates.sort(key=lambda x: -x[0])

    result: list[tuple[float, float]] = []
    for _score, start, end in candidates:
        overlap = False
        for rs, re in result:
            if start < re and end > rs:
                overlap = True
                break
        if not overlap:
            result.append((start, end))
        if len(result) >= n:
            break

    return result


def find_drop_candidates_rms(
    downbeats: list[float], bar_rms_vals: list[float], n: int = 3
) -> list[tuple[float, float]]:
    """P6: RMS-guided drop finder — mirrors the TS implementation.

    When bar_rms_vals is supplied, loudness peaks dominate scoring (0.50 weight)
    with position (0.35) and density (0.15). Picks actual energy peaks instead
    of relying on position heuristics.
    """
    total_bars = len(downbeats)
    section_bars = min(32, total_bars)
    if total_bars < 33 or len(bar_rms_vals) < total_bars:
        return find_drop_candidates(downbeats, n)

    raw_pos: list[float] = []
    raw_density: list[float] = []
    raw_rms: list[float] = []

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

        rms_sum = sum(bar_rms_vals[j] for j in range(i, i + section_bars))
        raw_rms.append(rms_sum / section_bars)

    norm_pos = minmax_norm(raw_pos)
    norm_dens = minmax_norm(raw_density)
    norm_rms = minmax_norm(raw_rms)

    scored = [
        (norm_rms[i] * 0.5 + norm_pos[i] * 0.35 + norm_dens[i] * 0.15, i)
        for i in range(len(raw_pos))
    ]
    scored.sort(key=lambda x: -x[0])

    result: list[tuple[float, float]] = []
    for _score, idx in scored:
        start = downbeats[idx]
        end_idx = min(idx + section_bars, len(downbeats) - 1)
        end = downbeats[end_idx] + (downbeats[end_idx] - downbeats[max(0, end_idx - 1)])
        overlap = any(start < re and end > rs for rs, re in result)
        if not overlap:
            result.append((start, end))
        if len(result) >= n:
            break

    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.expanduser("~/.local/state/megadj/archive.db"))
    parser.add_argument("--limit", type=int, default=0, help="Limit tracks (0=all)")
    parser.add_argument("--force", action="store_true", help="Recompute existing")
    parser.add_argument("--rms", action="store_true", help="P6: use RMS-guided drop finder")
    args = parser.parse_args()

    if not EFFNET_PATH.exists():
        print(f"Model not found: {EFFNET_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)

    # Find tracks needing section embeddings
    existing_ids: set[str] = set()
    if not args.force:
        existing_ids = {
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT video_id FROM section_embeddings WHERE model LIKE 'effnet-discogs-1280-section-%'"
            ).fetchall()
        }

    query = """
        SELECT t.video_id, t.file_path, b.downbeats_json
        FROM tracks t
        JOIN beats b ON b.video_id = t.video_id
        JOIN embeddings e ON e.video_id = t.video_id
        WHERE t.status = 'downloaded'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.file_path IS NOT NULL
          AND b.downbeats_json IS NOT NULL
          AND e.model = 'effnet-discogs-1280'
    """
    if args.limit > 0:
        query += f" LIMIT {args.limit}"

    rows = conn.execute(query).fetchall()
    todo = [(vid, fp, dj) for vid, fp, dj in rows if vid not in existing_ids]

    print(f"Total with effnet+beats+genre: {len(rows)}", file=sys.stderr)
    print(f"Already cached: {len(existing_ids)}", file=sys.stderr)
    print(f"To compute: {len(todo)}", file=sys.stderr)

    if not todo:
        print("Nothing to do.", file=sys.stderr)
        conn.close()
        return

    # Load ONNX session
    import onnxruntime as ort  # type: ignore[import-not-found]

    sess = ort.InferenceSession(str(EFFNET_PATH), providers=["CPUExecutionProvider"])

    done = 0
    failed = 0
    t0 = time.time()

    for i, (video_id, file_path, downbeats_json) in enumerate(todo):
        try:
            downbeats = json.loads(downbeats_json)
        except (json.JSONDecodeError, TypeError):
            failed += 1
            continue

        if not isinstance(downbeats, list) or len(downbeats) < 33:
            failed += 1
            continue

        if not os.path.exists(file_path):
            failed += 1
            continue

        if args.rms:
            full_audio = load_full_audio(file_path)
            if full_audio is None:
                failed += 1
                continue
            bar_rms_vals = rms_per_bar(full_audio, downbeats)
            sections = find_drop_candidates_rms(downbeats, bar_rms_vals, 3)
        else:
            sections = find_drop_candidates(downbeats, 3)

        if not sections:
            failed += 1
            continue

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        stored = 0

        for si, (start, end) in enumerate(sections):
            if args.rms:
                s_idx = int(start * 16000)
                e_idx = int(end * 16000)
                section_audio = full_audio[s_idx:e_idx].astype(np.float32)  # type: ignore[index]
                if len(section_audio) < 16000:
                    continue
                audio = section_audio
            else:
                audio = load_audio_section(file_path, start, end)
                if audio is None:
                    continue

            vec = emb_effnet(audio, sess)
            model_tag = f"{MODEL_TAG}-section-{si + 1}"

            conn.execute(
                """INSERT OR REPLACE INTO section_embeddings
                   (video_id, model, dim, vec_json, source_path, analyzed_at, section_start, section_end)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    video_id,
                    model_tag,
                    len(vec),
                    json.dumps(vec.tolist()),
                    file_path,
                    now,
                    start,
                    end,
                ),
            )
            stored += 1

        if stored > 0:
            done += 1
            if done % 10 == 0:
                conn.commit()
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(todo) - i - 1) / rate / 60 if rate > 0 else 0
                print(
                    f"  [{done}/{len(todo)}] {rate:.1f} tracks/s, ETA {eta:.0f}min — {video_id[:12]}",
                    file=sys.stderr,
                )
        else:
            failed += 1

    conn.commit()
    elapsed = time.time() - t0
    print(f"\nDone: {done} tracks, {failed} failed, {elapsed:.0f}s", file=sys.stderr)

    # Verify
    total = conn.execute(
        "SELECT count(*) FROM section_embeddings WHERE model LIKE 'effnet-discogs-1280-section-%'"
    ).fetchone()[0]
    print(f"Total section embeddings in DB: {total}", file=sys.stderr)
    conn.close()

    json.dump(
        {"done": done, "failed": failed, "elapsed_s": round(elapsed), "total_in_db": total},
        sys.stdout,
    )
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
