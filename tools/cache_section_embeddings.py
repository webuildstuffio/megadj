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
from typing import Any

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float32]
MODEL_DIR = Path.home() / ".local/share/fulltags-models"
EFFNET_PATH = MODEL_DIR / "discogs-effnet-bsdynamic-1.onnx"
MODEL_TAG = "effnet-discogs-1280"


def normalize(v: FloatArray) -> FloatArray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-8 else v


def frame_mel(audio: FloatArray, extractor: Any, frame_size: int, hop: int) -> FloatArray:
    from essentia.standard import FrameGenerator
    return np.asarray(
        [extractor(f) for f in FrameGenerator(audio, frameSize=frame_size, hopSize=hop)],
        dtype=np.float32,
    )


def chunks(frames: FloatArray, size: int) -> FloatArray:
    n = (frames.shape[0] // size) * size
    if n == 0:
        return np.zeros((1, size, frames.shape[1]), dtype=np.float32)
    return frames[:n].reshape(-1, size, frames.shape[1])


def emb_effnet(a16k: FloatArray, sess: Any) -> FloatArray:
    from essentia.standard import TensorflowInputMusiCNN
    mel = frame_mel(a16k, TensorflowInputMusiCNN(), 512, 256)
    batch = chunks(mel, 128)
    out = sess.run(["embeddings"], {"melspectrogram": batch})[0]
    return normalize(
        np.asarray(out, dtype=np.float32).mean(axis=0, keepdims=False).astype(np.float32)
    )


def load_audio_section(path: str, start: float, end: float) -> FloatArray | None:
    """Load audio section at 16kHz mono."""
    try:
        from essentia.standard import MonoLoader
        audio = MonoLoader(filename=path, sampleRate=16000)()
        s = int(start * 16000)
        e = int(end * 16000)
        section = audio[s:e]
        if len(section) < 16000:
            return None
        return section.astype(np.float32)
    except Exception:
        return None


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

    result = []
    for score, start, end in candidates:
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.expanduser("~/.local/state/megadj/archive.db"))
    parser.add_argument("--limit", type=int, default=0, help="Limit tracks (0=all)")
    parser.add_argument("--force", action="store_true", help="Recompute existing")
    args = parser.parse_args()

    if not EFFNET_PATH.exists():
        print(f"Model not found: {EFFNET_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)

    # Find tracks needing section embeddings
    existing_ids: set[str] = set()
    if not args.force:
        existing_ids = {
            r[0] for r in conn.execute(
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
    import onnxruntime as ort
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

        sections = find_drop_candidates(downbeats, 3)
        if not sections:
            failed += 1
            continue

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        stored = 0

        for si, (start, end) in enumerate(sections):
            audio = load_audio_section(file_path, start, end)
            if audio is None:
                continue

            vec = emb_effnet(audio, sess)
            model_tag = f"{MODEL_TAG}-section-{si + 1}"

            conn.execute(
                """INSERT OR REPLACE INTO section_embeddings
                   (video_id, model, dim, vec_json, source_path, analyzed_at, section_start, section_end)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (video_id, model_tag, len(vec), json.dumps(vec.tolist()), file_path, now, start, end),
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
    total = conn.execute("SELECT count(*) FROM section_embeddings WHERE model LIKE 'effnet-discogs-1280-section-%'").fetchone()[0]
    print(f"Total section embeddings in DB: {total}", file=sys.stderr)
    conn.close()

    json.dump({"done": done, "failed": failed, "elapsed_s": round(elapsed), "total_in_db": total}, sys.stdout)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
