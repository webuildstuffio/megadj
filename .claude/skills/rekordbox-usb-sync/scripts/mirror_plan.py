"""Shared copy-planning logic for the rekordbox-usb-sync mirror scripts.

Pure functions only: no I/O, no environment reads — everything comes in as
arguments so the differential skip logic (#117) can be unit-tested without
a mounted drive. usb_mirror.py imports plan_copies from here.
"""

from __future__ import annotations

import hashlib
import json
import os

HASH_CACHE_FILE = "/tmp/usb-sync/mirror_hash_cache.json"


def plan_copies(
    src_root: str,
    dst_root: str,
    src_manifest: dict[str, str],
    dst_manifest: dict[str, str],
    done: set[str],
) -> dict[str, list[str]]:
    """Differential copy plan (#117): classify each master file.

    - ``copy``      — missing on the mirror, or size differs (a partial
                      copy from an interrupted run, or a changed file —
                      both must re-copy or they'd never heal).
    - ``skip``      — present with identical size AND mtime within 2s
                      (ExFAT has 2s resolution); trusted without a read.
    - ``verify``    — size matches but mtime differs; needs one hash to
                      decide (same size + different mtime is usually the
                      same bytes re-stamped, but only a hash proves it).
    - ``done``      — completed in a prior interrupted run (state ledger);
                      counted, never re-copied.

    Returns a dict with the four lists (mirror-relative paths).
    """
    copy: list[str] = []
    skip: list[str] = []
    verify: list[str] = []
    already: list[str] = []
    for k, rel in sorted(src_manifest.items()):
        if rel in done:
            already.append(rel)
            continue
        dst_rel = dst_manifest.get(k)
        if dst_rel is None:
            copy.append(rel)
            continue
        s = os.path.join(src_root, rel)
        d = os.path.join(dst_root, dst_rel)
        try:
            ss = os.stat(s)
            ds = os.stat(d)
        except OSError:
            copy.append(rel)
            continue
        if ss.st_size != ds.st_size:
            # partial/interrupted copy or changed file — re-copy heals both
            copy.append(rel)
        elif abs(ss.st_mtime - ds.st_mtime) <= 2:
            skip.append(rel)
        else:
            verify.append(rel)
    return {"copy": copy, "skip": skip, "verify": verify, "done": already}


def hash_key(path: str, size: int, mtime: float) -> str:
    """Cache key: path + size + mtime. Any byte-relevant change re-keys the
    entry, so a stale cached hash can never vouch for new content."""
    return f"{path}:{size}:{mtime}"


def load_hash_cache(path: str = HASH_CACHE_FILE) -> dict[str, str]:
    """Read the persistent hash cache; a missing/corrupt file is a cold
    cache, never an error (the cache is an accelerator, not a ledger)."""
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}


def save_hash_cache(cache: dict[str, str], path: str = HASH_CACHE_FILE) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, path)


def md5_file(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cached_md5(
    path: str,
    cache: dict[str, str],
    dirty: set[str],
    cache_path: str = HASH_CACHE_FILE,
) -> str:
    """MD5 of `path`, served from the hash cache when the file's
    (path, size, mtime) identity is unchanged; computed + cached otherwise.

    `dirty` accumulates keys written this run; the caller flushes the cache
    once at the end (usb_mirror.py saves the merged dict). `cache_path` is
    injectable so tests never touch the real cache file.
    """
    try:
        st = os.stat(path)
    except OSError:
        # unreadable file: hash what we can see so the caller still gets an
        # honest answer (open() will raise its own error if truly gone)
        key = f"{path}:gone"
        if key in cache:
            return cache[key]
        h = md5_file(path)
        cache[key] = h
        dirty.add(key)
        return h
    key = hash_key(path, st.st_size, st.st_mtime)
    if key in cache:
        return cache[key]
    h = md5_file(path)
    cache[key] = h
    dirty.add(key)
    if len(dirty) >= 512:
        save_hash_cache(cache, cache_path)
        dirty.clear()
    return h


def files_differ(a: str, b: str) -> bool:
    """Byte comparison without loading whole files (1MB chunks)."""
    try:
        with open(a, "rb") as fa, open(b, "rb") as fb:
            while True:
                ca = fa.read(1 << 20)
                cb = fb.read(1 << 20)
                if ca != cb:
                    return True
                if not ca:
                    return False
    except OSError:
        return True
