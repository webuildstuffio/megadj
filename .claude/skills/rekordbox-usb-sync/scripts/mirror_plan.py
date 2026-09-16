"""Shared copy-planning logic for the rekordbox-usb-sync mirror scripts.

Pure functions only: no I/O, no environment reads — everything comes in as
arguments so the differential skip logic (#117) can be unit-tested without
a mounted drive. usb_mirror.py imports plan_copies from here.
"""

from __future__ import annotations

import os


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
