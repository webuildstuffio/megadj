"""Stage A re-run: exclude umbrella labels from probe training.

The prior run included 745 "EDM"/"Dance"/"Electronic" tracks as the "edm"
family — these are generic catch-all labels with zero genre information.
The scoring system already abstains them (scoringFamily returns null).
This run excludes them from training to see the honest classifier baseline.

Also tests with expanded families: trap split from hiphop, afrolatin from groove.

Usage:
    uv run --python python3.12 --with scikit-learn --with numpy \
      python tools/probe_bench_clean.py [--db PATH]
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression  # type: ignore[import-not-found]
from sklearn.metrics import accuracy_score, f1_score  # type: ignore[import-not-found]
from sklearn.model_selection import GroupKFold  # type: ignore[import-not-found]
from sklearn.preprocessing import LabelEncoder  # type: ignore[import-not-found]

# ── UMBRELLA labels (same as genre-vocab.ts) ────────────────────────────

UMBRELLA = {"edm", "dance", "electronic", "mainstage edm"}

# ── Current 9 families ──────────────────────────────────────────────────

JUNK_RE = re.compile(
    r"djsoundtop|dj ?sound|soundcloud|youtube|spotify|apple ?music|"
    r"unknown|various|other|none|general|all music|loop samples|dj tools",
    re.IGNORECASE,
)

FAMILIES_9: list[tuple[re.Pattern[str], str]] = [
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

# ── Expanded families: split trap + afrolatin ────────────────────────────
# Research-backed (Xu et al. 2026 §15.2):
# - Trap: 60-85 BPM half-time, 808 sub, triplet hi-hats (acoustically distinct from boom-bap)
# - Afrolatin: 3+3+2 rhythmic patterns, Latin percussion (distinct from R&B/Soul)

FAMILIES_EXPANDED: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"drum ?and ?bass|jungle|breakbeat|breaks|(?<!afro )(?<!future )bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers",
            re.I,
        ),
        "bass",
    ),
    (
        re.compile(
            r"amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae|cumbia|dembow|soca|bossa",
            re.I,
        ),
        "afrolatin",
    ),
    (re.compile(r"(?<!bass )(?<!afro )house|disco|garage|boogie", re.I), "house"),
    (re.compile(r"techno|melodic|minimal(?! \/)|deep tech|hardtekk|sofftekk|tekk", re.I), "techno"),
    (re.compile(r"trance|psy(?![a-z])", re.I), "trance"),
    (re.compile(r"\btrap\b|future bass", re.I), "trap"),
    (re.compile(r"hip ?[- ]?hop|rap(?! music)|boom bap", re.I), "hiphop"),
    (
        re.compile(
            r"edm|electro|big ?room|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore",
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
    (re.compile(r"r ?& ?b|soul|funk", re.I), "rnb"),
    (
        re.compile(
            r"jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial",
            re.I,
        ),
        "mood",
    ),
    (re.compile(r"\bgroove\b", re.I), "rnb"),
    (re.compile(r"\bdance\b|mainstream club", re.I), "edm"),
]


def normalize_genre(g: str) -> str:
    s = unicodedata.normalize("NFC", g).strip().lower()
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    if re.match(r"^(music|unknown|fixme|other|none)\s*$", s):
        return ""
    return s.split(",")[0].strip()


def family_of(genre: str, families: list[tuple[re.Pattern[str], str]]) -> str | None:
    base = normalize_genre(genre)
    if not base or JUNK_RE.search(base):
        return None
    for pat, fam in families:
        if pat.search(base):
            return fam
    return None


def is_umbrella(genre: str) -> bool:
    base = normalize_genre(genre)
    return base in UMBRELLA


def load_corpus(
    db_path: str,
    families: list[tuple[re.Pattern[str], str]],
    exclude_umbrella: bool = True,
) -> tuple[NDArray[np.float32], list[str], list[str], int]:
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

    vecs, fams, artists = [], [], []
    skipped_umbrella = 0
    for vec_json, genre, artist in rows:
        if exclude_umbrella and is_umbrella(genre):
            skipped_umbrella += 1
            continue
        fam = family_of(genre, families)
        if fam is None:
            continue
        try:
            vec = json.loads(vec_json)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(vec, list) or len(vec) < 10:
            continue
        vecs.append(vec)
        fams.append(fam)
        artists.append(artist or "UNKNOWN")

    X = np.array(vecs, dtype=np.float32)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms
    return X, fams, artists, skipped_umbrella


def eval_probe(
    X: NDArray[np.float32],
    y: NDArray[np.int32],
    groups: NDArray[np.int32],
    label_names: list[str],
    n_splits: int = 5,
    C: float = 10.0,
    balanced: bool = False,
) -> dict[str, Any]:
    gkf = GroupKFold(n_splits=n_splits)
    all_true, all_pred = [], []
    for train_idx, test_idx in gkf.split(X, y, groups):
        clf = LogisticRegression(
            max_iter=2000,
            class_weight="balanced" if balanced else None,
            C=C,
            solver="lbfgs",
        )
        clf.fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[test_idx])
        all_true.extend(y[test_idx].tolist())
        all_pred.extend(pred.tolist())

    yt = np.array(all_true, dtype=np.int32)
    yp = np.array(all_pred, dtype=np.int32)
    mf1 = float(f1_score(yt, yp, average="macro"))
    acc = float(accuracy_score(yt, yp))

    per_class = {}
    for i, name in enumerate(label_names):
        mask = yt == i
        n_cls = int(mask.sum())
        recall = float((yp[mask] == i).sum() / n_cls) if n_cls > 0 else 0.0
        per_class[name] = {"recall": round(recall, 4), "n": n_cls}

    return {"macro_f1": round(mf1, 4), "accuracy": round(acc, 4), "per_class": per_class}


def main() -> None:
    db_path = os.environ.get("MEGADJ_DB", os.path.expanduser("~/.local/state/megadj/archive.db"))

    configs = [
        ("9-fam WITH umbrella", FAMILIES_9, False),
        ("9-fam NO umbrella (clean)", FAMILIES_9, True),
        ("11-fam NO umbrella (expanded)", FAMILIES_EXPANDED, True),
    ]

    all_results = []

    for name, families, excl_umb in configs:
        X, fams, artists, skipped = load_corpus(db_path, families, excl_umb)
        le = LabelEncoder()
        y = le.fit_transform(fams).astype(np.int32)
        label_names = list(le.classes_)
        artist_le = LabelEncoder()
        groups = artist_le.fit_transform(artists).astype(np.int32)

        print(f"\n{'=' * 70}", file=sys.stderr)
        print(f"  {name}", file=sys.stderr)
        print(
            f"  {len(fams)} tracks, {len(label_names)} families, {len(set(artists))} artists",
            file=sys.stderr,
        )
        if skipped:
            print(f"  Excluded {skipped} umbrella-labeled tracks", file=sys.stderr)
        print(f"  {dict(Counter(fams).most_common())}", file=sys.stderr)
        print(f"{'=' * 70}\n", file=sys.stderr)

        for balanced in [False, True]:
            tag = "balanced" if balanced else "unbalanced"
            r = eval_probe(X, y, groups, label_names, C=10.0, balanced=balanced)
            print(
                f"  Probe C=10 {tag:<12} mF1={r['macro_f1']:.1%}  acc={r['accuracy']:.1%}",
                file=sys.stderr,
            )

            # Per-class
            print("    ", end="", file=sys.stderr)
            for ln in label_names:
                pc = r["per_class"].get(ln, {"recall": 0.0})
                print(f"{ln[:6]:>7}({pc['n']})", end="", file=sys.stderr)
            print(file=sys.stderr)
            print("    ", end="", file=sys.stderr)
            for ln in label_names:
                pc = r["per_class"].get(ln, {"recall": 0.0})
                print(f"{pc['recall']:>7.0%}   ", end="", file=sys.stderr)
            print(file=sys.stderr)

            all_results.append({"config": name, "balanced": balanced, **r})

    json.dump(all_results, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
