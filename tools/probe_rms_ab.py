"""P6b: A/B test — position-only vs RMS-guided section embeddings for genre probe.

Loads ~200 tracks, computes BOTH position-only and RMS-guided section embeddings
on the fly, and runs the 5-fold artist-excluded probe on both. This gives us the
classification delta before waiting for the full RMS cache run (~4h).

Usage:
    uv run --python python3.12 --with essentia-tensorflow --with onnxruntime --with numpy \
      --with scikit-learn python tools/probe_rms_ab.py [--db PATH] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import unicodedata
from collections import Counter

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import accuracy_score, f1_score  # type: ignore[import-not-found]
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]

FloatArray = NDArray[np.float32]
MODEL_TAG = "effnet-discogs-1280"
SR = 16000

# ── Genre family mapping — classifier-clean (umbrella excluded, edm→house) ──

UMBRELLA = {"edm", "dance", "electronic", "mainstage edm"}
CLASSIFIER_MERGES = {"edm": "house"}


def normalize_genre(g: str) -> str:
    return unicodedata.normalize("NFC", g.strip().lower())


FAMILY_MAP: dict[str, str] = {}


def _load_family_map(conn: sqlite3.Connection) -> None:
    """Load genre→family from the existing genre votes."""
    if FAMILY_MAP:
        return
    rows = conn.execute(
        "SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre != ''"
    ).fetchall()
    kw_families = {
        "house": "house", "techno": "techno", "tech house": "house",
        "deep house": "house", "progressive house": "house", "minimal": "techno",
        "trance": "trance", "psytrance": "trance",
        "drum and bass": "bass", "dnb": "bass", "dubstep": "bass",
        "trap": "bass", "garage": "bass", "jungle": "bass", "breakbeat": "bass",
        "hip hop": "hiphop", "hip-hop": "hiphop", "rap": "hiphop", "r&b": "hiphop",
        "pop": "pop", "indie": "pop", "rock": "pop", "alternative": "pop",
        "funk": "groove", "disco": "groove", "soul": "groove", "nu-disco": "groove",
        "afro": "groove", "latin": "groove", "reggaeton": "groove",
        "ambient": "mood", "downtempo": "mood", "chill": "mood",
        "hardstyle": "trance", "hard dance": "trance",
        "electro": "house", "electronica": "house",
        "dance": "edm", "electronic": "edm", "edm": "edm", "mainstage": "edm",
    }
    for (g,) in rows:
        ng = normalize_genre(g)
        for kw, fam in kw_families.items():
            if kw in ng:
                FAMILY_MAP[ng] = fam
                break


def classifier_family(genre: str) -> str | None:
    ng = normalize_genre(genre)
    if not ng:
        return None
    if ng in UMBRELLA:
        return None
    fam = FAMILY_MAP.get(ng)
    if fam is None:
        return None
    return CLASSIFIER_MERGES.get(fam, fam)


# ── Audio + embedding helpers ──

def load_mono(path: str) -> FloatArray | None:
    try:
        from essentia.standard import MonoLoader  # type: ignore[import-not-found]
        return MonoLoader(filename=path, sampleRate=SR)().astype(np.float32)  # type: ignore[no-any-return]
    except Exception:
        return None


def rms_per_bar(audio: FloatArray, downbeats: list[float]) -> list[float]:
    rms: list[float] = []
    for i in range(len(downbeats)):
        s = int(downbeats[i] * SR)
        e = int(downbeats[i + 1] * SR) if i + 1 < len(downbeats) else min(s + int(2.0 * SR), len(audio))
        seg = audio[s:e]
        rms.append(float(np.sqrt(np.mean(seg**2))) if len(seg) >= 100 else 0.0)
    return rms


def find_drop_position(downbeats: list[float], n: int = 3) -> list[tuple[float, float]]:
    if len(downbeats) < 33:
        return []
    total_dur = downbeats[-1] - downbeats[0]
    if total_dur <= 0:
        return []
    candidates = []
    for i in range(len(downbeats) - 32):
        start, end = downbeats[i], downbeats[i + 32]
        mid = (start + end) / 2
        rel = (mid - downbeats[0]) / total_dur
        pos = 1.0 - 4.0 * (rel - 0.5) ** 2
        dur = end - start
        dens = 1.0 - min(dur / total_dur, 1.0) if total_dur > 0 else 0.5
        candidates.append((pos * 0.7 + dens * 0.3, start, end))
    candidates.sort(key=lambda x: -x[0])
    result: list[tuple[float, float]] = []
    for _sc, s, e in candidates:
        if not any(s < r_e and e > rs for rs, r_e in result):
            result.append((s, e))
        if len(result) >= n:
            break
    return result


def find_drop_rms(downbeats: list[float], bar_rms: list[float], n: int = 3) -> list[tuple[float, float]]:
    total_bars = len(downbeats)
    sb = min(32, total_bars)
    if total_bars < 33 or len(bar_rms) < total_bars:
        return find_drop_position(downbeats, n)
    raw_p, raw_d, raw_r = [], [], []
    for i in range(total_bars - sb + 1):
        mbar = i + sb / 2
        raw_p.append(1.0 - 4.0 * (mbar / total_bars - 0.5) ** 2)
        ivs = [downbeats[j + 1] - downbeats[j] for j in range(i, i + sb - 1) if downbeats[j + 1] - downbeats[j] > 0]
        raw_d.append(2.0 / max(0.5, sum(ivs) / len(ivs) if ivs else 2.0))
        raw_r.append(sum(bar_rms[j] for j in range(i, i + sb)) / sb)

    def mm(v: list[float]) -> list[float]:
        lo, hi = min(v), max(v)
        r = hi - lo
        return [0.0] * len(v) if r < 1e-12 else [(x - lo) / r for x in v]

    np_, nd, nr = mm(raw_p), mm(raw_d), mm(raw_r)
    scored = sorted(((nr[i] * 0.5 + np_[i] * 0.35 + nd[i] * 0.15, i) for i in range(len(raw_p))), reverse=True)
    result: list[tuple[float, float]] = []
    for _sc, idx in scored:
        s = downbeats[idx]
        ei = min(idx + sb, len(downbeats) - 1)
        e = downbeats[ei] + (downbeats[ei] - downbeats[max(0, ei - 1)])
        if not any(s < r_e and e > rs for rs, r_e in result):
            result.append((s, e))
        if len(result) >= n:
            break
    return result


def emb_section(audio: FloatArray, start: float, end: float, sess: object) -> FloatArray | None:
    from essentia.standard import TensorflowInputMusiCNN
    s, e = int(start * SR), int(end * SR)
    seg = audio[s:e]
    if len(seg) < SR:
        return None
    seg = seg.astype(np.float32)
    mel_ext = TensorflowInputMusiCNN()
    from essentia.standard import FrameGenerator
    frames = np.asarray([mel_ext(f) for f in FrameGenerator(seg, frameSize=512, hopSize=256)], dtype=np.float32)
    n_chunks = (frames.shape[0] // 128) * 128
    if n_chunks == 0:
        return None
    batch = frames[:n_chunks].reshape(-1, 128, frames.shape[1])
    out = sess.run(["embeddings"], {"melspectrogram": batch})[0]  # type: ignore[attr-defined]
    vec = np.asarray(out, dtype=np.float32).mean(axis=0, keepdims=False).astype(np.float32)
    nrm = float(np.linalg.norm(vec))
    return vec / nrm if nrm > 1e-8 else vec


# ── Main ──

def main() -> None:
    from pathlib import Path

    import onnxruntime as ort  # type: ignore[import-not-found]

    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.path.expanduser("~/.local/state/megadj/archive.db"))
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()

    model_path = Path.home() / ".local/share/fulltags-models/discogs-effnet-bsdynamic-1.onnx"
    if not model_path.exists():
        print(f"Model not found: {model_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    _load_family_map(conn)

    rows = conn.execute("""
        SELECT t.video_id, t.file_path, t.genre, t.artist,
               e.vec_json, b.downbeats_json
        FROM tracks t
        JOIN embeddings e ON e.video_id = t.video_id AND e.model = 'effnet-discogs-1280'
        JOIN beats b ON b.video_id = t.video_id
        WHERE t.status = 'downloaded'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.file_path IS NOT NULL
          AND b.downbeats_json IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ?
    """, (args.limit,)).fetchall()
    conn.close()

    # Build corpus
    corpus: list[dict[str, object]] = []
    for vid, fpath, genre, artist, vj, dj in rows:
        fam = classifier_family(genre)
        if fam is None:
            continue
        try:
            whole_vec = json.loads(vj)
            downbeats = json.loads(dj)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(whole_vec, list) or len(whole_vec) < 10:
            continue
        if not isinstance(downbeats, list) or len(downbeats) < 33:
            continue
        if not os.path.exists(fpath):
            continue
        corpus.append({
            "vid": vid, "path": fpath, "genre": genre,
            "artist": artist or "UNKNOWN", "family": fam,
            "whole": np.array(whole_vec, dtype=np.float32),
            "downbeats": downbeats,
        })

    print(f"Corpus: {len(corpus)} tracks", file=sys.stderr)
    fam_counts = Counter(c["family"] for c in corpus)
    print(f"Families: {dict(sorted(fam_counts.items(), key=lambda x: -x[1]))}", file=sys.stderr)

    # Load ONNX
    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])

    # Extract section embeddings — both position-only and RMS-guided
    t0 = time.time()
    success = 0
    for i, c in enumerate(corpus):
        audio = load_mono(str(c["path"]))
        if audio is None:
            c["pos_sec"] = None
            c["rms_sec"] = None
            continue

        db: list[float] = list(c["downbeats"])  # type: ignore[call-overload]
        pos_secs = find_drop_position(db, 3)
        bar_rms = rms_per_bar(audio, db)
        rms_secs = find_drop_rms(db, bar_rms, 3)

        pos_vecs = []
        for s, e in pos_secs:
            v = emb_section(audio, s, e, sess)
            if v is not None:
                pos_vecs.append(v)

        rms_vecs = []
        for s, e in rms_secs:
            v = emb_section(audio, s, e, sess)
            if v is not None:
                rms_vecs.append(v)

        c["pos_sec"] = pos_vecs if pos_vecs else None
        c["rms_sec"] = rms_vecs if rms_vecs else None
        if pos_vecs and rms_vecs:
            success += 1

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            print(f"  [{i+1}/{len(corpus)}] {success} ok, {elapsed:.0f}s", file=sys.stderr)

    print(f"Extracted: {success}/{len(corpus)} tracks, {time.time()-t0:.0f}s", file=sys.stderr)

    # Filter to tracks with both
    valid = [c for c in corpus if c["pos_sec"] is not None and c["rms_sec"] is not None]
    print(f"Valid for comparison: {len(valid)}", file=sys.stderr)

    if len(valid) < 50:
        print("Too few tracks for meaningful comparison", file=sys.stderr)
        sys.exit(1)

    # Prepare features
    families = [str(c["family"]) for c in valid]
    artists = [str(c["artist"]) for c in valid]
    le = LabelEncoder()
    y = le.fit_transform(families).astype(np.int32)
    ale = LabelEncoder()
    groups = ale.fit_transform(artists).astype(np.int32)
    ln = list(le.classes_)

    def l2(x: FloatArray) -> FloatArray:
        norms = np.linalg.norm(x, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return (x / norms).astype(np.float32)

    # Build feature matrices for each strategy
    strategies: dict[str, FloatArray] = {}

    # 1. whole_track_only
    strategies["whole_track_only"] = l2(np.array([c["whole"] for c in valid], dtype=np.float32))

    # 2. position_section_mean
    strategies["pos_section_mean"] = l2(np.array([
        np.mean(np.array(c["pos_sec"]), axis=0) for c in valid
    ], dtype=np.float32))

    # 3. rms_section_mean
    strategies["rms_section_mean"] = l2(np.array([
        np.mean(np.array(c["rms_sec"]), axis=0) for c in valid
    ], dtype=np.float32))

    # 4. whole + pos_section_mean
    pos_means = np.array([np.mean(np.array(c["pos_sec"]), axis=0) for c in valid], dtype=np.float32)
    strategies["whole+pos_sec"] = l2(np.hstack([
        np.array([c["whole"] for c in valid], dtype=np.float32),
        pos_means,
    ]))

    # 5. whole + rms_section_mean
    rms_means = np.array([np.mean(np.array(c["rms_sec"]), axis=0) for c in valid], dtype=np.float32)
    strategies["whole+rms_sec"] = l2(np.hstack([
        np.array([c["whole"] for c in valid], dtype=np.float32),
        rms_means,
    ]))

    # Run 5-fold artist-excluded CV
    gkf = GroupKFold(n_splits=5)
    results: list[dict[str, object]] = []

    print(f"\n{'Strategy':<30} {'mF1':>6} {'Acc':>6}   " + " ".join(f"{f:>7}" for f in ln), file=sys.stderr)
    print("─" * (40 + 8 * len(ln)), file=sys.stderr)

    for name, X in sorted(strategies.items()):
        yp_all = np.zeros_like(y)
        for train_idx, test_idx in gkf.split(X, y, groups):
            clf = LogisticRegression(C=10, max_iter=2000, solver="lbfgs")
            clf.fit(X[train_idx], y[train_idx])
            yp_all[test_idx] = clf.predict(X[test_idx])

        mf1 = float(f1_score(y, yp_all, average="macro"))
        acc = float(accuracy_score(y, yp_all))

        per_class = {}
        for ci, cn in enumerate(ln):
            mask = y == ci
            recall = float(np.mean(yp_all[mask] == ci)) if mask.sum() > 0 else 0.0
            per_class[cn] = {"recall": round(recall, 4), "n": int(mask.sum())}

        results.append({"strategy": name, "macro_f1": round(mf1, 4), "accuracy": round(acc, 4), "per_class": per_class})

        cls_str = " ".join(f"{per_class[f]['recall']:>6.0%}" for f in ln)
        print(f"{name:<30} {mf1:>5.1%} {acc:>5.1%}   {cls_str}", file=sys.stderr)

    # Summary
    pos_mf1 = next(r["macro_f1"] for r in results if r["strategy"] == "whole+pos_sec")
    rms_mf1 = next(r["macro_f1"] for r in results if r["strategy"] == "whole+rms_sec")
    delta = float(rms_mf1) - float(pos_mf1)  # type: ignore[arg-type]
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"Delta(whole+rms_sec - whole+pos_sec) = {delta:+.1%}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    json.dump({"n": len(valid), "results": results, "delta_rms_vs_pos": round(delta, 4)}, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
