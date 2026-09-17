#!/usr/bin/env python3
"""usb_mirror_parity — byte-parity legs of usb_mirror (#117/#42 split).

- hash_parity: full-hash the analysis tree + audio spot-check (reports only)
- audio_parity: make mirrored audio byte-identical to master (master wins,
  variants backed up first; resumable via state['audio_parity'])

Pure-enough functions: drives/paths come in as arguments; state I/O goes
through the caller-passed load/save hooks so tests can run without /tmp.
"""

from __future__ import annotations

import os
import random
import shutil
from typing import Any

from mirror_plan import cached_md5, load_hash_cache, save_hash_cache
from progress import Progress, Stage

AUDIO_PARITY_BACKUP_DIR = "/tmp/usb-sync/nm_replaced_variants"


def _manifest(root: str, subdir: str) -> dict[str, str]:
    """NFC/casefold key → real relative name (same junk rules as usb_mirror)."""
    import unicodedata

    m: dict[str, str] = {}
    base = os.path.join(root, subdir)
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d != ".Trashes"]
        for fn in fns:
            if fn.startswith("._") or fn == ".DS_Store" or fn == "TPS metadata.json":
                continue
            rel = os.path.relpath(os.path.join(dp, fn), base)
            m[unicodedata.normalize("NFC", rel).casefold()] = rel
    return m


def hash_parity(master: str, mirror: str, stage: Stage) -> int:
    """Byte-level parity: analysis full-hash, audio spot-check. Fixes nothing — reports."""
    hash_cache = load_hash_cache()
    dirty: set[str] = set()
    src = {}
    for dp, _, fns in os.walk(os.path.join(master, "PIONEER/USBANLZ")):
        for fn in fns:
            if fn.startswith("._"):
                continue
            p = os.path.join(dp, fn)
            src[os.path.relpath(p, os.path.join(master, "PIONEER/USBANLZ"))] = p
    prog = Progress(len(src), label="anlz hash")
    mm = 0
    for rel, p in src.items():
        d = os.path.join(mirror, "PIONEER/USBANLZ", rel)
        try:
            hp = cached_md5(p, hash_cache, dirty)
            hd: str | None = cached_md5(d, hash_cache, dirty) if os.path.exists(d) else None
        except OSError:
            # unreadable on either side = mismatch by definition; report and
            # continue — one unreadable file must not kill the parity run
            hp = ""
            hd = None
        if hd is None or hp != hd:
            mm += 1
            stage.info(f"  ANLZ MISMATCH: {rel}")
        prog.update(1)
    prog.close(f"mismatches: {mm}")

    pool = list(_manifest(master, "Contents").values())
    random.seed()
    sample = random.sample(pool, min(40, len(pool)))
    am = 0
    for rel in sample:
        fa = os.path.join(master, "Contents", rel)
        fb = os.path.join(mirror, "Contents", rel)
        if not os.path.exists(fb):
            continue
        try:
            differs = cached_md5(fa, hash_cache, dirty) != cached_md5(
                fb, hash_cache, dirty
            )
        except OSError:
            # unreadable master file: count it, don't die — the report
            # must complete for the remaining sampled files
            differs = True
        if differs:
            am += 1
            stage.info(f"  AUDIO MISMATCH (different rips — run --audio-parity): {rel}")
    stage.info(f"audio spot-check ({len(sample)}): {am} mismatches")
    save_hash_cache(hash_cache)
    return mm + am


def audio_parity(master: str, mirror: str, stage: Stage, state: dict[str, Any]) -> int:
    """Make every mirrored audio file byte-identical to master's version.

    Multi-origin libraries accumulate different rips of the same track (same
    path, different bytes). Master wins; mirror variants are backed up first.
    Resumable via state['audio_parity'].
    """
    backup_dir = AUDIO_PARITY_BACKUP_DIR
    midx: dict[str, list[str]] = {}
    base = os.path.join(mirror, "Contents")
    for dp, _, fns in os.walk(base):
        for fn in fns:
            if fn.startswith("._") or fn == ".DS_Store":
                continue
            p = os.path.join(dp, fn)
            key = os.path.relpath(p, base).casefold()
            midx.setdefault(key, []).append(p)

    done = set(state.get("audio_parity", []))
    pool = sorted(_manifest(master, "Contents").values())
    prog = Progress(len(pool), label="audio hash", initial=len(done))
    fixed = errs = 0
    for rel in pool:
        if rel in done:
            prog.update(0)
            continue
        cands = midx.get(rel.casefold(), [])
        mp = cands[0] if cands else None
        fa = os.path.join(master, "Contents", rel)
        try:
            if mp and os.path.exists(fa) and os.path.exists(mp) and cached_md5(
                fa, {}, set()
            ) != cached_md5(mp, {}, set()):
                os.makedirs(backup_dir, exist_ok=True)
                shutil.copy2(mp, os.path.join(backup_dir, rel.replace("/", "__")))
                shutil.copy2(fa, mp)
                fixed += 1
            done.add(rel)
        except Exception as e:
            errs += 1
            print(f"\nERR {rel[:80]}: {e}", flush=True)
        prog.update(1)
        if prog.done % 100 == 0:
            state["audio_parity"] = sorted(done)
    state["audio_parity"] = sorted(done)
    prog.close(f"variants fixed: {fixed}, errors: {errs} (backups: {backup_dir})")
    return errs


__all__ = ["audio_parity", "hash_parity"]
