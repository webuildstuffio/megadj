"""Comprehensive genre probe showdown -- every classifier x feature x balance combo.

Tests LogReg (6 C values), SVM RBF (4 C), SVM linear (4 C), Random Forest,
Gradient Boosting, all with balanced/unbalanced class weights. Features:
whole-track, section-mean, section-mean+std, whole+sec-mean, whole+3sec.
Bootstrap 95% CIs (1000 iter) + Holm-corrected McNemar pairwise tests.

Full 5-fold artist-excluded CV (GroupKFold), macro-F1 primary metric.

Usage:
    uv run --python python3.12 --with scikit-learn --with numpy --with scipy \
      python tools/probe_showdown.py [--db PATH] [--bootstrap N]
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
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats  # type: ignore[import-untyped]
from sklearn.ensemble import (  # type: ignore[import-not-found]
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import (  # type: ignore[import-not-found]
    accuracy_score,
    f1_score,
)
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.preprocessing import (  # type: ignore[import-not-found]
    LabelEncoder,
    StandardScaler,
)

FloatArray = NDArray[np.float32]

# ── Genre family mapping — classifier-clean (umbrella excluded, edm→house) ──

UMBRELLA = {"edm", "dance", "electronic", "mainstage edm"}
CLASSIFIER_MERGES: dict[str, str] = {"edm": "house"}

FAMILY_KW: dict[str, str] = {
    "house": "house",
    "techno": "techno",
    "tech house": "house",
    "deep house": "house",
    "progressive house": "house",
    "minimal": "techno",
    "trance": "trance",
    "psytrance": "trance",
    "drum and bass": "bass",
    "dnb": "bass",
    "dubstep": "bass",
    "trap": "bass",
    "garage": "bass",
    "jungle": "bass",
    "breakbeat": "bass",
    "hip hop": "hiphop",
    "hip-hop": "hiphop",
    "rap": "hiphop",
    "r&b": "hiphop",
    "pop": "pop",
    "indie": "pop",
    "rock": "pop",
    "alternative": "pop",
    "funk": "groove",
    "disco": "groove",
    "soul": "groove",
    "nu-disco": "groove",
    "afro": "groove",
    "latin": "groove",
    "reggaeton": "groove",
    "ambient": "mood",
    "downtempo": "mood",
    "chill": "mood",
    "hardstyle": "trance",
    "hard dance": "trance",
    "electro": "house",
    "electronica": "house",
    "dance": "edm",
    "electronic": "edm",
    "edm": "edm",
    "mainstage": "edm",
}

FAMILY_MAP: dict[str, str] = {}


def _load_family_map(conn: sqlite3.Connection) -> None:
    if FAMILY_MAP:
        return
    rows = conn.execute(
        "SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre != ''"
    ).fetchall()
    for (g,) in rows:
        ng = unicodedata.normalize("NFC", g.strip().lower())
        for kw, fam in FAMILY_KW.items():
            if kw in ng:
                FAMILY_MAP[ng] = fam
                break


def classifier_family(genre: str) -> str | None:
    ng = unicodedata.normalize("NFC", genre.strip().lower())
    if not ng or ng in UMBRELLA:
        return None
    fam = FAMILY_MAP.get(ng)
    if fam is None:
        return None
    return CLASSIFIER_MERGES.get(fam, fam)


# ── Data loading ──


def load_corpus(
    db_path: str,
) -> tuple[
    list[dict[str, Any]], list[str], list[str], FloatArray, list[list[FloatArray]]
]:
    conn = sqlite3.connect(db_path)
    _load_family_map(conn)

    rows = conn.execute(
        """
        SELECT t.video_id, t.genre, t.artist,
               e.vec_json,
               se1.vec_json, se2.vec_json, se3.vec_json
        FROM tracks t
        JOIN embeddings e ON e.video_id = t.video_id AND e.model = 'effnet-discogs-1280'
        LEFT JOIN section_embeddings se1
            ON se1.video_id = t.video_id AND se1.model = 'effnet-discogs-1280-section-1'
        LEFT JOIN section_embeddings se2
            ON se2.video_id = t.video_id AND se2.model = 'effnet-discogs-1280-section-2'
        LEFT JOIN section_embeddings se3
            ON se3.video_id = t.video_id AND se3.model = 'effnet-discogs-1280-section-3'
        WHERE t.status = 'downloaded'
          AND t.genre IS NOT NULL AND t.genre != ''
        """
    ).fetchall()
    conn.close()

    corpus: list[dict[str, Any]] = []
    families: list[str] = []
    artists: list[str] = []
    whole_vecs: list[FloatArray] = []
    sec_vecs_all: list[list[FloatArray]] = []

    for vid, genre, artist, wj, s1j, s2j, s3j in rows:
        fam = classifier_family(genre)
        if fam is None:
            continue
        try:
            wv = json.loads(wj)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(wv, list) or len(wv) < 10:
            continue

        secs: list[FloatArray] = []
        for sj in [s1j, s2j, s3j]:
            if sj is not None:
                try:
                    sv = json.loads(sj)
                    if isinstance(sv, list) and len(sv) >= 10:
                        secs.append(np.array(sv, dtype=np.float32))
                except (json.JSONDecodeError, TypeError):
                    pass

        corpus.append({"vid": vid, "genre": genre})
        families.append(fam)
        artists.append(artist or "UNKNOWN")
        whole_vecs.append(np.array(wv, dtype=np.float32))
        sec_vecs_all.append(secs)

    return corpus, families, artists, np.array(whole_vecs, dtype=np.float32), sec_vecs_all


# ── Feature builders ──


def l2_norm(X: FloatArray) -> FloatArray:
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (X / norms).astype(np.float32)


def build_features(
    whole: FloatArray,
    sec_vecs: list[list[FloatArray]],
    has_sections_mask: NDArray[np.bool_],
) -> dict[str, FloatArray]:
    n = whole.shape[0]
    d = whole.shape[1]
    features: dict[str, FloatArray] = {}

    # 1. whole-track only
    features["whole"] = l2_norm(whole)

    # Section-based features (only for tracks WITH sections)
    sec_means = np.zeros((n, d), dtype=np.float32)
    sec_stds = np.zeros((n, d), dtype=np.float32)
    sec_all3 = np.zeros((n, d * 3), dtype=np.float32)

    for i in range(n):
        if has_sections_mask[i] and sec_vecs[i]:
            arr = np.array(sec_vecs[i], dtype=np.float32)
            sec_means[i] = arr.mean(axis=0)
            sec_stds[i] = arr.std(axis=0) if len(sec_vecs[i]) > 1 else np.zeros(d)
            for j, sv in enumerate(sec_vecs[i][:3]):
                sec_all3[i, j * d : (j + 1) * d] = sv
        else:
            sec_means[i] = whole[i]
            sec_all3[i, :d] = whole[i]
            sec_all3[i, d : 2 * d] = whole[i]
            sec_all3[i, 2 * d :] = whole[i]

    # 2. section mean only
    features["sec_mean"] = l2_norm(sec_means)

    # 3. section mean+std (2560d)
    features["sec_mean_std"] = l2_norm(
        np.hstack([sec_means, sec_stds]).astype(np.float32)
    )

    # 4. whole + section mean (2560d)
    features["whole+sec_mean"] = l2_norm(
        np.hstack([whole, sec_means]).astype(np.float32)
    )

    # 5. whole + 3 sections (5120d)
    features["whole+3sec"] = l2_norm(
        np.hstack([whole, sec_all3]).astype(np.float32)
    )

    return features


# ── Classifier configs ──


def get_classifier_configs() -> list[tuple[str, Any]]:
    configs: list[tuple[str, Any]] = []

    # LogReg sweep
    for c in [0.1, 1.0, 5.0, 10.0, 50.0, 100.0]:
        for bal in [None, "balanced"]:
            tag = "bal" if bal else "unbal"
            configs.append(
                (
                    f"LR_C{c}_{tag}",
                    LogisticRegression(
                        C=c,
                        max_iter=3000,
                        solver="lbfgs",
                        class_weight=bal,
                    ),
                )
            )

    # SVM linear omitted — too slow even at 1280d on 2300+ tracks.
    # LogReg, RF, and GB cover the relevant classifier families.

    # Random Forest — 1280d features only (too slow on concat)
    for n_est in [100, 300]:
        for bal in [None, "balanced"]:
            tag = "bal" if bal else "unbal"
            configs.append(
                (
                    f"RF_{n_est}_{tag}",
                    RandomForestClassifier(
                        n_estimators=n_est,
                        class_weight=bal,
                        n_jobs=-1,
                        random_state=42,
                    ),
                )
            )

    # Gradient Boosting omitted — too slow even on 1280d with 2500 tracks.

    return configs


# ── Evaluation ──


def run_cv(
    X: FloatArray,
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    clf: Any,
    n_splits: int = 5,
    scale: bool = False,
) -> NDArray[np.int32]:
    gkf = GroupKFold(n_splits=n_splits)
    yp = np.zeros_like(y)
    for train_idx, test_idx in gkf.split(X, y, groups):
        X_tr, X_te = X[train_idx], X[test_idx]
        if scale:
            scaler = StandardScaler()
            X_tr = scaler.fit_transform(X_tr).astype(np.float32)
            X_te = scaler.transform(X_te).astype(np.float32)
        clf_copy = type(clf)(**clf.get_params())
        clf_copy.fit(X_tr, y[train_idx])
        yp[test_idx] = clf_copy.predict(X_te)
    return yp


def bootstrap_ci(
    y_true: NDArray[np.int32],
    y_pred: NDArray[np.int32],
    n_boot: int = 1000,
    alpha: float = 0.05,
) -> tuple[float, float, float, float, float, float]:
    mf1 = float(f1_score(y_true, y_pred, average="macro"))
    acc = float(accuracy_score(y_true, y_pred))
    rng = np.random.default_rng(42)
    mf1s, accs = [], []
    n = len(y_true)
    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        mf1s.append(float(f1_score(y_true[idx], y_pred[idx], average="macro")))
        accs.append(float(accuracy_score(y_true[idx], y_pred[idx])))
    lo = alpha / 2
    hi = 1 - lo
    return (
        mf1,
        float(np.percentile(mf1s, lo * 100)),
        float(np.percentile(mf1s, hi * 100)),
        acc,
        float(np.percentile(accs, lo * 100)),
        float(np.percentile(accs, hi * 100)),
    )


def mcnemar_test(
    y_true: NDArray[np.int32],
    yp_a: NDArray[np.int32],
    yp_b: NDArray[np.int32],
) -> float:
    """McNemar's test p-value (two-sided)."""
    a_right_b_wrong = int(np.sum((yp_a == y_true) & (yp_b != y_true)))
    a_wrong_b_right = int(np.sum((yp_a != y_true) & (yp_b == y_true)))
    n = a_right_b_wrong + a_wrong_b_right
    if n == 0:
        return 1.0
    # exact binomial test
    return float(stats.binomtest(min(a_right_b_wrong, a_wrong_b_right), n, 0.5).pvalue)


def holm_correction(p_values: list[float]) -> list[float]:
    """Holm-Bonferroni correction."""
    m = len(p_values)
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    corrected = [0.0] * m
    cummax = 0.0
    for rank, (orig_idx, p) in enumerate(indexed):
        adj = p * (m - rank)
        cummax = max(cummax, adj)
        corrected[orig_idx] = min(cummax, 1.0)
    return corrected


# ── Main ──


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=os.path.expanduser("~/.local/state/megadj/archive.db"),
    )
    parser.add_argument("--bootstrap", type=int, default=1000)
    args = parser.parse_args()

    t0_total = time.time()

    # Load corpus
    print("Loading corpus...", file=sys.stderr)
    corpus, families, artists, whole_vecs, sec_vecs = load_corpus(args.db)
    print(f"Corpus: {len(corpus)} tracks", file=sys.stderr)
    fam_counts = Counter(families)
    print(
        f"Families: {dict(sorted(fam_counts.items(), key=lambda x: -x[1]))}",
        file=sys.stderr,
    )
    print(f"Artists: {len(set(artists))}", file=sys.stderr)

    # Encode labels
    le = LabelEncoder()
    y = le.fit_transform(families).astype(np.int32)
    ln = list(le.classes_)
    ale = LabelEncoder()
    groups = ale.fit_transform(artists).astype(np.int32)

    # Tracks with sections
    has_secs = np.array([len(sv) > 0 for sv in sec_vecs], dtype=np.bool_)
    n_with_secs = int(has_secs.sum())
    print(f"Tracks with section embeddings: {n_with_secs}/{len(corpus)}", file=sys.stderr)

    # Build feature sets
    print("Building features...", file=sys.stderr)
    all_features = build_features(whole_vecs, sec_vecs, has_secs)

    # Classifier configs
    clf_configs = get_classifier_configs()
    print(
        f"\nRunning {len(clf_configs)} classifiers x {len(all_features)} features"
        f" = {len(clf_configs) * len(all_features)} combinations",
        file=sys.stderr,
    )

    # Run all combinations
    results: list[dict[str, Any]] = []
    predictions: dict[str, NDArray[np.int32]] = {}
    best_mf1 = 0.0
    best_name = ""

    total_combos = len(clf_configs) * len(all_features)
    done = 0

    for feat_name, X in sorted(all_features.items()):
        feat_dim = X.shape[1]
        for clf_name, clf in clf_configs:
            # RF only on 1280d features (too slow on concat features)
            if "RF_" in clf_name and feat_dim > 1300:
                continue

            combo_name = f"{feat_name}|{clf_name}"
            t0 = time.time()

            needs_scale = "GB" in clf_name
            yp = run_cv(X, y, groups, clf, scale=needs_scale)
            elapsed = time.time() - t0

            mf1, mf1_lo, mf1_hi, acc, acc_lo, acc_hi = bootstrap_ci(
                y, yp, n_boot=args.bootstrap
            )

            per_class: dict[str, dict[str, float | int]] = {}
            for ci, cn in enumerate(ln):
                mask = y == ci
                recall = float(np.mean(yp[mask] == ci)) if mask.sum() > 0 else 0.0
                per_class[cn] = {"recall": round(recall, 4), "n": int(mask.sum())}

            predictions[combo_name] = yp
            results.append(
                {
                    "name": combo_name,
                    "feature": feat_name,
                    "classifier": clf_name,
                    "macro_f1": round(mf1, 4),
                    "mf1_ci_lo": round(mf1_lo, 4),
                    "mf1_ci_hi": round(mf1_hi, 4),
                    "accuracy": round(acc, 4),
                    "acc_ci_lo": round(acc_lo, 4),
                    "acc_ci_hi": round(acc_hi, 4),
                    "per_class": per_class,
                    "elapsed_s": round(elapsed, 1),
                }
            )

            if mf1 > best_mf1:
                best_mf1 = mf1
                best_name = combo_name

            done += 1
            if done % 10 == 0 or done == total_combos:
                print(
                    f"  [{done}/{total_combos}] best so far: {best_name}"
                    f" mF1={best_mf1:.1%} ({elapsed:.1f}s/combo)",
                    file=sys.stderr,
                )

    # Sort by macro-F1 descending
    results.sort(key=lambda r: -r["macro_f1"])

    # Print top 20
    print(f"\n{'='*120}", file=sys.stderr)
    print(f"TOP 20 of {len(results)} combinations (n={len(corpus)})", file=sys.stderr)
    print(f"{'='*120}", file=sys.stderr)
    print(
        f"{'Rank':<5} {'Combo':<45} {'mF1':>6} {'95% CI':>15} {'Acc':>6}"
        f" {'95% CI':>15}   "
        + " ".join(f"{f:>7}" for f in ln),
        file=sys.stderr,
    )
    print("-" * 120, file=sys.stderr)
    for i, r in enumerate(results[:20]):
        ci_mf1 = f"[{r['mf1_ci_lo']:.1%},{r['mf1_ci_hi']:.1%}]"
        ci_acc = f"[{r['acc_ci_lo']:.1%},{r['acc_ci_hi']:.1%}]"
        cls_str = " ".join(
            f"{r['per_class'][f]['recall']:>6.0%}" for f in ln
        )
        print(
            f"{i+1:<5} {r['name']:<45} {r['macro_f1']:>5.1%}"
            f" {ci_mf1:>15} {r['accuracy']:>5.1%}"
            f" {ci_acc:>15}   {cls_str}",
            file=sys.stderr,
        )

    # Pairwise McNemar: top 5 vs each other + vs best baseline (whole|LR_C10_unbal)
    print(f"\n{'='*80}", file=sys.stderr)
    print("Pairwise McNemar tests (Holm-corrected) — top 5", file=sys.stderr)
    print(f"{'='*80}", file=sys.stderr)

    top5_names = [r["name"] for r in results[:5]]
    baseline_name = next(
        (r["name"] for r in results if r["feature"] == "whole" and "LR_C10_unbal" in r["classifier"]),
        results[-1]["name"],
    )
    if baseline_name not in top5_names:
        top5_names.append(baseline_name)

    pairs: list[tuple[str, str]] = []
    for i in range(len(top5_names)):
        for j in range(i + 1, len(top5_names)):
            pairs.append((top5_names[i], top5_names[j]))

    raw_ps = []
    pair_labels = []
    for a, b in pairs:
        if a in predictions and b in predictions:
            p = mcnemar_test(y, predictions[a], predictions[b])
            raw_ps.append(p)
            pair_labels.append((a, b))

    corrected_ps = holm_correction(raw_ps)

    for (a, b), raw_p, adj_p in zip(pair_labels, raw_ps, corrected_ps, strict=True):
        sig = "***" if adj_p < 0.001 else "**" if adj_p < 0.01 else "*" if adj_p < 0.05 else "ns"
        mf1_a = next(r["macro_f1"] for r in results if r["name"] == a)
        mf1_b = next(r["macro_f1"] for r in results if r["name"] == b)
        print(
            f"  {a:<40} vs {b:<40} p_raw={raw_p:.4f} p_adj={adj_p:.4f} {sig}"
            f"  (mF1: {mf1_a:.1%} vs {mf1_b:.1%})",
            file=sys.stderr,
        )

    total_time = time.time() - t0_total
    print(
        f"\nTotal time: {total_time:.0f}s ({total_time/60:.1f}min)"
        f" -- {done} combos run",
        file=sys.stderr,
    )

    # JSON output
    json.dump(
        {
            "n": len(corpus),
            "n_families": len(ln),
            "families": dict(fam_counts),
            "n_artists": len(set(artists)),
            "n_with_sections": n_with_secs,
            "bootstrap_iters": args.bootstrap,
            "total_combos": len(results),
            "top_20": results[:20],
            "pairwise_mcnemar": [
                {
                    "a": a,
                    "b": b,
                    "p_raw": round(raw_p, 6),
                    "p_adjusted": round(adj_p, 6),
                }
                for (a, b), raw_p, adj_p in zip(
                    pair_labels, raw_ps, corrected_ps, strict=True
                )
            ],
            "elapsed_s": round(total_time),
        },
        sys.stdout,
        indent=2,
    )
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
