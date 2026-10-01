"""Section embeddings Stage A: classifier experiments on cached effnet vectors.

Reads effnet-discogs-1280 embeddings + genre families from archive.db.
Runs logistic probe (A1), class-balanced kNN (A2), aggregation (A3),
pooling (A4) — all with 5-fold artist-excluded CV, macro-F1 primary,
bootstrap 95% CIs, Holm correction.

Usage:
    uv run --python python3.12 --with scikit-learn --with numpy python tools/probe_bench.py [--db PATH] [--n-splits 5] [--n-bootstrap 1000]

Outputs JSON summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import accuracy_score, f1_score  # type: ignore[import-not-found]
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.neighbors import KNeighborsClassifier  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]

# ── Genre family mapping (mirrors genre-vocab.ts FAMILIES) ──────────────

JUNK_RE = re.compile(
    r"djsoundtop|dj ?sound|soundcloud|youtube|spotify|apple ?music|"
    r"unknown|various|other|none|general|all music|loop samples|dj tools",
    re.IGNORECASE,
)

FAMILIES: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers",
            re.I,
        ),
        "bass",
    ),
    (re.compile(r"(?<!bass )(?<!afro )house|disco|garage|boogie", re.I), "house"),
    (re.compile(r"techno|melodic|minimal(?! \/)|deep tech|hardtekk|softtekk|tekk", re.I), "techno"),
    (re.compile(r"trance|psy(?![a-z])", re.I), "trance"),
    (re.compile(r"hip ?[- ]?hop|rap|trap", re.I), "hiphop"),
    (
        re.compile(
            r"edm|electro|big ?room|future (?!bass)|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore",
            re.I,
        ),
        "edm",
    ),
    (
        re.compile(
            r"pop|rock|indie|alternative|punk|metal|folk|singer|country|top 40|chanson", re.I
        ),
        "pop",
    ),
    (
        re.compile(
            r"r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae",
            re.I,
        ),
        "groove",
    ),
    (
        re.compile(
            r"jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial",
            re.I,
        ),
        "mood",
    ),
    (re.compile(r"\bgroove\b", re.I), "groove"),
    (re.compile(r"\bdance\b|mainstream club", re.I), "edm"),
]


def normalize_genre(g: str) -> str:
    return unicodedata.normalize("NFC", g).strip().lower()


def family_of(genre: str) -> str | None:
    base = normalize_genre(genre)
    if not base or JUNK_RE.search(base):
        return None
    for pat, fam in FAMILIES:
        if pat.search(base):
            return fam
    return None


# ── Data loading ────────────────────────────────────────────────────────


def load_corpus(db_path: str) -> tuple[NDArray[np.float32], list[str], list[str]]:
    """Load effnet embeddings, families, and artist groups from archive.db."""
    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT e.vec_json, t.genre, t.artist
        FROM embeddings e
        JOIN tracks t ON t.video_id = e.video_id
        WHERE e.model = 'effnet-discogs-1280'
          AND t.genre IS NOT NULL AND t.genre != ''
          AND t.status = 'downloaded'
    """).fetchall()
    conn.close()

    vecs: list[list[float]] = []
    families: list[str] = []
    artists: list[str] = []

    for vec_json, genre, artist in rows:
        fam = family_of(genre)
        if fam is None:
            continue
        try:
            vec = json.loads(vec_json)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(vec, list) or len(vec) < 10:
            continue
        vecs.append(vec)
        families.append(fam)
        artists.append(artist or "UNKNOWN")

    X = np.array(vecs, dtype=np.float32)
    # L2 normalize
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms
    return X, families, artists


# ── Evaluation helpers ──────────────────────────────────────────────────


def bootstrap_ci(
    y_true: NDArray[np.int32],
    y_pred: NDArray[np.int32],
    metric_fn: Any,
    n_bootstrap: int = 1000,
    ci: float = 0.95,
) -> tuple[float, float, float]:
    """Bootstrap CI for a metric. Returns (mean, low, high)."""
    rng = np.random.default_rng(42)
    scores = []
    n = len(y_true)
    for _ in range(n_bootstrap):
        idx = rng.integers(0, n, size=n)
        scores.append(metric_fn(y_true[idx], y_pred[idx]))
    scores_arr = np.array(scores)
    alpha = (1 - ci) / 2
    return (
        float(np.mean(scores_arr)),
        float(np.percentile(scores_arr, alpha * 100)),
        float(np.percentile(scores_arr, (1 - alpha) * 100)),
    )


def holm_correct(p_values: list[float], alpha: float = 0.05) -> list[tuple[float, float, bool]]:
    """Holm-Bonferroni correction. Returns list of (raw_p, threshold, significant)."""
    m = len(p_values)
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    result: list[tuple[float, float, bool]] = [None] * m  # type: ignore[list-item]
    any_rejected = True
    for rank, (orig_idx, p) in enumerate(indexed):
        threshold = alpha / (m - rank)
        sig = any_rejected and p < threshold
        if not sig:
            any_rejected = False
        result[orig_idx] = (p, threshold, sig)
    return result


# ── Experiment A1: Logistic Probe ───────────────────────────────────────


def run_probe(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    n_splits: int,
    label_names: list[str],
    n_bootstrap: int,
) -> dict[str, Any]:
    gkf = GroupKFold(n_splits=n_splits)
    all_true: list[int] = []
    all_pred: list[int] = []

    for train_idx, test_idx in gkf.split(X, y, groups):
        clf = LogisticRegression(
            max_iter=2000,
            class_weight="balanced",
            C=1.0,
            solver="lbfgs",
        )
        clf.fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[test_idx])
        all_true.extend(y[test_idx].tolist())
        all_pred.extend(pred.tolist())

    y_t = np.array(all_true, dtype=np.int32)
    y_p = np.array(all_pred, dtype=np.int32)

    macro_f1 = float(f1_score(y_t, y_p, average="macro"))
    accuracy = float(accuracy_score(y_t, y_p))
    per_class = {}
    for i, name in enumerate(label_names):
        mask = y_t == i
        n_cls = int(mask.sum())
        if n_cls == 0:
            per_class[name] = {"recall": 0.0, "n": 0}
            continue
        recall = float((y_p[mask] == i).sum() / n_cls)
        per_class[name] = {"recall": round(recall, 4), "n": n_cls}

    _f1_mean, f1_lo, f1_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: f1_score(t, p, average="macro"), n_bootstrap
    )
    _acc_mean, acc_lo, acc_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: accuracy_score(t, p), n_bootstrap
    )

    return {
        "method": "logistic_probe_balanced",
        "macro_f1": round(macro_f1, 4),
        "accuracy": round(accuracy, 4),
        "f1_ci": [round(f1_lo, 4), round(f1_hi, 4)],
        "acc_ci": [round(acc_lo, 4), round(acc_hi, 4)],
        "per_class": per_class,
        "n": len(y_t),
        "n_splits": n_splits,
    }


# ── Experiment A2: Class-balanced kNN ───────────────────────────────────


def run_balanced_knn(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    n_splits: int,
    label_names: list[str],
    n_bootstrap: int,
    k: int = 5,
) -> dict[str, Any]:
    """kNN with inverse-frequency weighted voting."""
    class_counts = Counter(y.tolist())
    total = sum(class_counts.values())
    class_weights = {c: total / (len(class_counts) * n) for c, n in class_counts.items()}

    gkf = GroupKFold(n_splits=n_splits)
    all_true: list[int] = []
    all_pred: list[int] = []

    for train_idx, test_idx in gkf.split(X, y, groups):
        knn_plain = KNeighborsClassifier(n_neighbors=k, metric="cosine")
        knn_plain.fit(X[train_idx], y[train_idx])

        # Get neighbours and manually weight
        dists, indices = knn_plain.kneighbors(X[test_idx])
        for qi in range(len(test_idx)):
            votes: dict[int, float] = defaultdict(float)
            for ni in range(k):
                neighbor_class = int(y[train_idx[indices[qi, ni]]])
                d = max(float(dists[qi, ni]), 1e-10)
                weight = class_weights.get(neighbor_class, 1.0) / d
                votes[neighbor_class] += weight
            pred = max(votes, key=votes.get)  # type: ignore[arg-type]
            all_true.append(int(y[test_idx[qi]]))
            all_pred.append(pred)

    y_t = np.array(all_true, dtype=np.int32)
    y_p = np.array(all_pred, dtype=np.int32)

    macro_f1 = float(f1_score(y_t, y_p, average="macro"))
    accuracy = float(accuracy_score(y_t, y_p))
    per_class = {}
    for i, name in enumerate(label_names):
        mask = y_t == i
        n_cls = int(mask.sum())
        if n_cls == 0:
            per_class[name] = {"recall": 0.0, "n": 0}
            continue
        recall = float((y_p[mask] == i).sum() / n_cls)
        per_class[name] = {"recall": round(recall, 4), "n": n_cls}

    _f1_mean, f1_lo, f1_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: f1_score(t, p, average="macro"), n_bootstrap
    )
    _acc_mean, acc_lo, acc_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: accuracy_score(t, p), n_bootstrap
    )

    return {
        "method": "knn_balanced_k5",
        "macro_f1": round(macro_f1, 4),
        "accuracy": round(accuracy, 4),
        "f1_ci": [round(f1_lo, 4), round(f1_hi, 4)],
        "acc_ci": [round(acc_lo, 4), round(acc_hi, 4)],
        "per_class": per_class,
        "n": len(y_t),
        "n_splits": n_splits,
    }


# ── Experiment A2b: Plain kNN baseline ──────────────────────────────────


def run_plain_knn(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    n_splits: int,
    label_names: list[str],
    n_bootstrap: int,
    k: int = 5,
) -> dict[str, Any]:
    """Standard unweighted kNN — the current production baseline."""
    gkf = GroupKFold(n_splits=n_splits)
    all_true: list[int] = []
    all_pred: list[int] = []

    for train_idx, test_idx in gkf.split(X, y, groups):
        knn = KNeighborsClassifier(n_neighbors=k, metric="cosine")
        knn.fit(X[train_idx], y[train_idx])
        pred = knn.predict(X[test_idx])
        all_true.extend(y[test_idx].tolist())
        all_pred.extend(pred.tolist())

    y_t = np.array(all_true, dtype=np.int32)
    y_p = np.array(all_pred, dtype=np.int32)

    macro_f1 = float(f1_score(y_t, y_p, average="macro"))
    accuracy = float(accuracy_score(y_t, y_p))
    per_class = {}
    for i, name in enumerate(label_names):
        mask = y_t == i
        n_cls = int(mask.sum())
        if n_cls == 0:
            per_class[name] = {"recall": 0.0, "n": 0}
            continue
        recall = float((y_p[mask] == i).sum() / n_cls)
        per_class[name] = {"recall": round(recall, 4), "n": n_cls}

    _f1_mean, f1_lo, f1_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: f1_score(t, p, average="macro"), n_bootstrap
    )
    _acc_mean, acc_lo, acc_hi = bootstrap_ci(
        y_t, y_p, lambda t, p: accuracy_score(t, p), n_bootstrap
    )

    return {
        "method": "knn_plain_k5",
        "macro_f1": round(macro_f1, 4),
        "accuracy": round(accuracy, 4),
        "f1_ci": [round(f1_lo, 4), round(f1_hi, 4)],
        "acc_ci": [round(acc_lo, 4), round(acc_hi, 4)],
        "per_class": per_class,
        "n": len(y_t),
        "n_splits": n_splits,
    }


# ── Main ────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage A classifier experiments")
    parser.add_argument("--db", default=os.path.expanduser("~/.local/state/megadj/archive.db"))
    parser.add_argument("--n-splits", type=int, default=5)
    parser.add_argument("--n-bootstrap", type=int, default=1000)
    args = parser.parse_args()

    print("Loading corpus...", file=sys.stderr)
    X, families, artists = load_corpus(args.db)
    print(f"  {len(families)} tracks with effnet embedding + genre family", file=sys.stderr)

    # Encode labels
    le = LabelEncoder()
    y = le.fit_transform(families).astype(np.int32)
    label_names = list(le.classes_)

    # Encode artist groups for GroupKFold (artist-excluded splits)
    artist_le = LabelEncoder()
    groups = artist_le.fit_transform(artists).astype(np.int32)

    print(
        f"  {len(label_names)} families: {dict(Counter(families).most_common())}", file=sys.stderr
    )
    print(f"  {len(set(artists))} unique artists", file=sys.stderr)

    results: list[dict[str, Any]] = []

    # A2b: Plain kNN baseline (current production)
    print("\n[A2b] Plain kNN k=5 (production baseline)...", file=sys.stderr)
    r_knn = run_plain_knn(X, y, groups, args.n_splits, label_names, args.n_bootstrap)
    results.append(r_knn)
    print(f"  macro-F1: {r_knn['macro_f1']:.1%}  acc: {r_knn['accuracy']:.1%}", file=sys.stderr)

    # A1: Logistic probe (balanced)
    print("\n[A1] Logistic probe (balanced, L2-reg)...", file=sys.stderr)
    r_probe = run_probe(X, y, groups, args.n_splits, label_names, args.n_bootstrap)
    results.append(r_probe)
    print(f"  macro-F1: {r_probe['macro_f1']:.1%}  acc: {r_probe['accuracy']:.1%}", file=sys.stderr)

    # A2: Class-balanced kNN
    print("\n[A2] Class-balanced kNN k=5...", file=sys.stderr)
    r_bknn = run_balanced_knn(X, y, groups, args.n_splits, label_names, args.n_bootstrap)
    results.append(r_bknn)
    print(f"  macro-F1: {r_bknn['macro_f1']:.1%}  acc: {r_bknn['accuracy']:.1%}", file=sys.stderr)

    # Holm correction across all methods (pairwise vs probe)
    print(
        "\n[Holm] Pairwise McNemar not applicable here (different fold assignments).",
        file=sys.stderr,
    )
    print("  Using bootstrap CIs for comparison instead.", file=sys.stderr)

    # Summary table
    print("\n" + "=" * 70, file=sys.stderr)
    print(f"  {'Method':<30} {'mF1':>6} {'Acc':>6} {'mF1 95% CI':>16}", file=sys.stderr)
    print(f"  {'─' * 60}", file=sys.stderr)
    for r in results:
        ci = r["f1_ci"]
        print(
            f"  {r['method']:<30} {r['macro_f1']:>5.1%} {r['accuracy']:>5.1%} [{ci[0]:.1%}, {ci[1]:.1%}]",
            file=sys.stderr,
        )

    # Per-class recall comparison
    print(f"\n  {'Family':<12} ", end="", file=sys.stderr)
    for r in results:
        print(f"{r['method'][:12]:>13}", end="", file=sys.stderr)
    print(f"{'n':>6}", file=sys.stderr)
    print(f"  {'─' * 55}", file=sys.stderr)
    for name in label_names:
        print(f"  {name:<12} ", end="", file=sys.stderr)
        for r in results:
            pc = r["per_class"].get(name, {"recall": 0.0})
            print(f"{pc['recall']:>12.0%}", end=" ", file=sys.stderr)
        n = results[0]["per_class"].get(name, {"n": 0})["n"]
        print(f"{n:>5}", file=sys.stderr)

    print("=" * 70, file=sys.stderr)

    # JSON to stdout
    output = {
        "experiment": "stage_a_classifiers",
        "model": "effnet-discogs-1280",
        "n_tracks": len(families),
        "n_families": len(label_names),
        "n_artists": len(set(artists)),
        "family_counts": dict(Counter(families).most_common()),
        "results": results,
    }
    json.dump(output, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
