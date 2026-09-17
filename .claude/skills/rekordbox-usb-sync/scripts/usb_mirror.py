#!/usr/bin/env python3
"""Mirror master drive -> mirror drive: music + analysis + rekordbox files.

Usage:
    uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py          # everything
    uv run python ... --contents-only        # just Contents/
    uv run python ... --anlz-only            # just PIONEER/USBANLZ/
    uv run python ... --rekordbox-only       # just PIONEER/rekordbox DB + support files
    uv run python ... --verify-only          # manifest comparison, no copying
    uv run python ... --hash-parity          # full byte-level parity report
    uv run python ... --audio-parity         # make audio byte-identical (slow)

Resumable: a state JSON in /tmp records already-copied paths across interrupted
runs (background jobs on this machine can be reaped mid-copy).

Structure (#117/#42 split): the differential copy plan + hash cache live in
mirror_plan.py; the byte-parity legs (hash_parity, audio_parity) live in
usb_mirror_parity.py; this file is the driver + verify.
"""

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
import unicodedata
from typing import Any

# Mirror state ledger: state-key → sorted list of completed mirror-relative
# paths (e.g. "contents", "anlz", "audio_parity").
StateDict = dict[str, Any]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import usb_mirror_parity  # noqa: E402
from mirror_plan import (  # noqa: E402
    cached_md5,
    load_hash_cache,
    plan_copies,
    save_hash_cache,
)
from progress import Progress, Stage  # noqa: E402

MASTER = os.environ.get("USB_SYNC_MASTER", "/Volumes/DJMASTER")
MIRROR = os.environ.get("USB_SYNC_MIRROR", "/Volumes/DJMIRROR")
STATE_FILE = "/tmp/usb-sync/usb_mirror_state.json"

REKORDBOX_FILES = [
    "export.pdb",
    "exportExt.pdb",
    "playlists3.sync",
    "playlists3Plus.sync",
    "RBFLTR.DAT",
]


def key(p: str) -> str:
    return unicodedata.normalize("NFC", p).casefold()


def md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest(root: str, subdir: str) -> dict[str, str]:
    m: dict[str, str] = {}
    base = os.path.join(root, subdir)
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d != ".Trashes"]
        for fn in fns:
            if fn.startswith("._") or fn == ".DS_Store" or fn == "TPS metadata.json":
                continue
            rel = os.path.relpath(os.path.join(dp, fn), base)
            m[key(rel)] = rel
    return m


def load_state() -> StateDict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                state: StateDict = json.load(f)
                return state
        except (json.JSONDecodeError, OSError):
            pass
    return {"contents": [], "anlz": []}


def save_state(state: StateDict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def copy_missing(
    stage: Stage,
    state_key: str,
    src_root: str,
    dst_root: str,
    src_manifest: dict[str, str],
    dst_manifest: dict[str, str],
    label: str,
) -> None:
    # Differential plan (#117): skip files identical by size+mtime (ExFAT
    # 2s resolution), hash-verify size-matched/mtime-drifted files, re-copy
    # size-mismatched files (a partial copy from an interrupted run, or a
    # changed file — both must re-copy or they'd never heal). The old
    # name-manifest-first behavior copied only by absence, so a partial
    # copy stayed partial forever and a changed master file never traveled.
    already = set(load_state().get(state_key, []))
    plan = plan_copies(src_root, dst_root, src_manifest, dst_manifest, already)
    todo = plan["copy"]
    total_bytes = sum(
        os.path.getsize(os.path.join(src_root, r))
        for r in todo
        if os.path.exists(os.path.join(src_root, r))
    )
    if not todo:
        stage.info(
            f"{label}: nothing to do (0 to copy · {len(plan['skip'])} identical · "
            f"{len(plan['verify'])} size-ok/mtime-drift · {len(plan['done'])} done in prior runs)"
        )
        return
    stage.info(
        f"{label}: {len(todo)} to copy · {len(plan['skip'])} identical (skipped, not re-read) · "
        f"{len(plan['verify'])} size-ok/mtime-drift (hashing) · {len(plan['done'])} done in prior runs"
    )

    # The verify bucket: size matches but mtime drifted. One hash decides —
    # same bytes → skip; different bytes → re-copy (heals changed masters).
    # Hashes go through the cached_md5 store (#117): a file already hashed
    # in a prior run at the same (path, size, mtime) is NOT re-read.
    verify_extra: list[str] = []
    if plan["verify"]:
        hash_cache = load_hash_cache()
        dirty: set[str] = set()
        prog_v = Progress(len(plan["verify"]), label=f"{label} verify", unit="files")
        v_errs = 0
        for rel in plan["verify"]:
            s = os.path.join(src_root, rel)
            d = os.path.join(dst_root, dst_manifest.get(key(rel), rel))
            try:
                if cached_md5(s, hash_cache, dirty) != cached_md5(
                    d, hash_cache, dirty
                ):
                    verify_extra.append(rel)
            except Exception as e:
                v_errs += 1
                print(f"\nERR verify {rel[:80]}: {e}", flush=True)
            prog_v.update(1)
        prog_v.close(f"differ: {len(verify_extra)}, errors: {v_errs}")
        save_hash_cache(hash_cache)
        todo.extend(verify_extra)
        total_bytes += sum(
            os.path.getsize(os.path.join(src_root, r))
            for r in verify_extra
            if os.path.exists(os.path.join(src_root, r))
        )

    prog = Progress(len(todo), label=label, total_bytes=total_bytes)
    errs = 0
    state = load_state()
    state.setdefault(state_key, [])
    done_set = set(state[state_key])
    for rel in todo:
        s = os.path.join(src_root, rel)
        d = os.path.join(dst_root, rel)
        try:
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)
            done_set.add(rel)
            prog.update(1, os.path.getsize(s))
        except Exception as e:
            errs += 1
            print(f"\nERR {rel[:80]}: {e}", flush=True)
        if prog.done % 200 == 0:
            save_state({**state, state_key: sorted(done_set)})
    state[state_key] = sorted(done_set)
    save_state(state)
    prog.close(f"errors: {errs}")


def sync_rekordbox(stage: Stage) -> None:
    src_dir = os.path.join(MASTER, "PIONEER/rekordbox")
    dst_dir = os.path.join(MIRROR, "PIONEER/rekordbox")
    os.makedirs(dst_dir, exist_ok=True)
    prog = Progress(len(REKORDBOX_FILES) + 1, label="rekordbox files")
    copied = []
    for fn in REKORDBOX_FILES:
        s, d = os.path.join(src_dir, fn), os.path.join(dst_dir, fn)
        if os.path.exists(s):
            shutil.copy2(s, d)
            copied.append(fn)
        prog.update(1)
    # deploy DB + its .backup twin, drop stale WAL/SHM
    for fn in ("exportLibrary.db", "exportLibrary.db.backup"):
        s, d = os.path.join(src_dir, fn), os.path.join(dst_dir, fn)
        if os.path.exists(s):
            shutil.copy2(s, d)
    for fn in ("exportLibrary.db-wal", "exportLibrary.db-shm"):
        stale = os.path.join(dst_dir, fn)
        if os.path.exists(stale):
            os.remove(stale)
    prog.close()
    h1 = md5(os.path.join(src_dir, "exportLibrary.db"))
    h2 = md5(os.path.join(dst_dir, "exportLibrary.db"))
    stage.info(
        f"DB MD5 master={h1[:10]}… mirror={h2[:10]}… -> {'IDENTICAL' if h1 == h2 else 'MISMATCH!'}"
    )
    # A DB just rewritten here must NOT be served stale by the #117 hash
    # cache — invalidate both sides so the next verify() re-hashes honestly.
    cache = load_hash_cache()
    for p in (s, d):
        if os.path.exists(p):
            st = os.stat(p)
            stale = f"{p}:{st.st_size}:{st.st_mtime}"
            cache.pop(stale, None)
    save_hash_cache(cache)


def verify(stage: Stage) -> int:
    failures = 0
    hash_cache = load_hash_cache()
    dirty: set[str] = set()
    for subdir, label in (("Contents", "music"), ("PIONEER/USBANLZ", "analysis")):
        src = manifest(MASTER, subdir)
        dst = manifest(MIRROR, subdir)
        diff = [rel for k, rel in src.items() if k not in dst]
        stage.info(f"{label}: master={len(src)} mirror={len(dst)} missing={len(diff)}")
        if diff:
            failures += 1
            for r in diff[:5]:
                stage.info(f"  MISSING: {r}")
    src_db = os.path.join(MASTER, "PIONEER/rekordbox/exportLibrary.db")
    dst_db = os.path.join(MIRROR, "PIONEER/rekordbox/exportLibrary.db")
    same = cached_md5(src_db, hash_cache, dirty) == cached_md5(
        dst_db, hash_cache, dirty
    )
    stage.info(f"DB identical across drives: {same}")
    failures += 0 if same else 1

    random.seed()
    pool = list(manifest(MASTER, "Contents").values())
    sample = random.sample(pool, min(10, len(pool)))
    mismatches = 0
    for rel in sample:
        if cached_md5(
            os.path.join(MASTER, "Contents", rel), hash_cache, dirty
        ) != cached_md5(os.path.join(MIRROR, "Contents", rel), hash_cache, dirty):
            mismatches += 1
            stage.info(f"  HASH MISMATCH: {rel}")
    stage.info(f"hash spot-check ({len(sample)} files): {mismatches} mismatches")
    save_hash_cache(hash_cache)
    failures += mismatches
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--contents-only", action="store_true")
    ap.add_argument("--anlz-only", action="store_true")
    ap.add_argument("--rekordbox-only", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument(
        "--hash-parity",
        action="store_true",
        help="full byte-level hash comparison of analysis + audio spot-checks",
    )
    ap.add_argument(
        "--audio-parity",
        action="store_true",
        help="make mirrored audio byte-identical to master (backs up variants first); slow, resumable",
    )
    args = ap.parse_args()

    for vol in (MASTER, MIRROR):
        if not os.path.isdir(vol):
            print(f"ERROR: {vol} not mounted")
            return 2

    stage = Stage()
    do_all = not any(
        [args.contents_only, args.anlz_only, args.rekordbox_only, args.verify_only]
    )

    if args.verify_only or do_all:
        stage.step("Verify manifests + DB parity")
        if verify(stage):
            print("\nRESULT: VERIFY FAILED")
            return 1
        if args.hash_parity and usb_mirror_parity.hash_parity(MASTER, MIRROR, stage):
            print("\nRESULT: HASH PARITY FAILED")
            return 1

    if args.verify_only:
        print("\nRESULT: VERIFY OK")
        return 0

    if args.audio_parity:
        stage.step("Audio byte-parity (master wins, variants backed up)")
        state = load_state()
        if usb_mirror_parity.audio_parity(MASTER, MIRROR, stage, state):
            save_state(state)
            print("\nRESULT: AUDIO PARITY ERRORS")
            return 1
        save_state(state)
        print("\nRESULT: OK")
        return 0

    if do_all or args.contents_only:
        stage.step("Mirror Contents/ (music files)")
        src = manifest(MASTER, "Contents")
        dst = manifest(MIRROR, "Contents")
        copy_missing(
            stage,
            "contents",
            os.path.join(MASTER, "Contents"),
            os.path.join(MIRROR, "Contents"),
            src,
            dst,
            "Contents copy",
        )

    if do_all or args.anlz_only:
        stage.step("Mirror PIONEER/USBANLZ/ (analysis)")
        src = manifest(MASTER, "PIONEER/USBANLZ")
        dst = manifest(MIRROR, "PIONEER/USBANLZ")
        copy_missing(
            stage,
            "anlz",
            os.path.join(MASTER, "PIONEER/USBANLZ"),
            os.path.join(MIRROR, "PIONEER/USBANLZ"),
            src,
            dst,
            "Analysis copy",
        )

    if do_all or args.rekordbox_only:
        stage.step("Sync PIONEER/rekordbox DB + support files")
        sync_rekordbox(stage)

    if do_all:
        stage.step("Final verification")
        if verify(stage):
            print("\nRESULT: MIRRORED, VERIFY FAILED")
            return 1
        if args.hash_parity and usb_mirror_parity.hash_parity(MASTER, MIRROR, stage):
            print("\nRESULT: MIRRORED, HASH PARITY FAILED")
            return 1

    print("\nRESULT: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
