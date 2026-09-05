#!/usr/bin/env python3
"""Mirror master drive -> mirror drive: music + analysis + rekordbox files.

Usage:
    uv run python .claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py          # everything
    uv run python ... --contents-only        # just Contents/
    uv run python ... --anlz-only            # just PIONEER/USBANLZ/
    uv run python ... --rekordbox-only       # just PIONEER/rekordbox DB + support files
    uv run python ... --verify-only          # manifest comparison, no copying

Resumable: a state JSON in /tmp records already-copied paths across interrupted
runs (background jobs on this machine can be reaped mid-copy).
"""

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from progress import Progress, Stage

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


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"contents": [], "anlz": []}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def copy_missing(
    stage: Stage,
    state_key: str,
    src_root: str,
    dst_root: str,
    src_manifest: dict,
    dst_manifest: dict,
    label: str,
) -> None:
    missing = [rel for k, rel in sorted(src_manifest.items()) if k not in dst_manifest]
    already = set(load_state().get(state_key, []))
    todo = [r for r in missing if r not in already]
    total_bytes = sum(
        os.path.getsize(os.path.join(src_root, r))
        for r in todo
        if os.path.exists(os.path.join(src_root, r))
    )
    if not todo:
        stage.info(f"{label}: nothing to do (0 missing)")
        return
    stage.info(
        f"{label}: {len(missing)} missing, {len(already & set(missing))} already done in prior runs"
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
            if os.path.exists(d):
                done_set.add(rel)  # case-variant present
                prog.update(0)
                continue
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)
            done_set.add(rel)
            prog.update(1, os.path.getsize(s))
        except Exception as e:  # noqa: BLE001
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


def verify(stage: Stage) -> int:
    failures = 0
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
    same = md5(src_db) == md5(dst_db)
    stage.info(f"DB identical across drives: {same}")
    failures += 0 if same else 1

    random.seed()
    pool = list(manifest(MASTER, "Contents").values())
    sample = random.sample(pool, min(10, len(pool)))
    mismatches = 0
    for rel in sample:
        if md5(os.path.join(MASTER, "Contents", rel)) != md5(
            os.path.join(MIRROR, "Contents", rel)
        ):
            mismatches += 1
            stage.info(f"  HASH MISMATCH: {rel}")
    stage.info(f"hash spot-check ({len(sample)} files): {mismatches} mismatches")
    failures += mismatches
    return failures


def hash_parity(stage: Stage) -> int:
    """Byte-level parity: analysis full-hash, audio spot-check. Fixes nothing — reports."""
    src = {}
    for dp, _, fns in os.walk(os.path.join(MASTER, "PIONEER/USBANLZ")):
        for fn in fns:
            if fn.startswith("._"):
                continue
            p = os.path.join(dp, fn)
            src[os.path.relpath(p, os.path.join(MASTER, "PIONEER/USBANLZ"))] = p
    prog = Progress(len(src), label="anlz hash")
    mm = 0
    for rel, p in src.items():
        d = os.path.join(MIRROR, "PIONEER/USBANLZ", rel)
        if not os.path.exists(d) or md5(p) != md5(d):
            mm += 1
            stage.info(f"  ANLZ MISMATCH: {rel}")
        prog.update(1)
    prog.close(f"mismatches: {mm}")

    pool = list(manifest(MASTER, "Contents").values())
    random.seed()
    sample = random.sample(pool, min(40, len(pool)))
    am = 0
    for rel in sample:
        fa = os.path.join(MASTER, "Contents", rel)
        fb = os.path.join(MIRROR, "Contents", rel)
        if os.path.exists(fb) and md5(fa) != md5(fb):
            am += 1
            stage.info(f"  AUDIO MISMATCH (different rips — run --audio-parity): {rel}")
    stage.info(f"audio spot-check ({len(sample)}): {am} mismatches")
    return mm + am


def audio_parity(stage: Stage) -> int:
    """Make every mirrored audio file byte-identical to master's version.

    Multi-origin libraries accumulate different rips of the same track (same
    path, different bytes). Master wins; mirror variants are backed up first.
    Resumable via state['audio_parity'].
    """
    backup_dir = "/tmp/usb-sync/nm_replaced_variants"
    midx = {}
    base = os.path.join(MIRROR, "Contents")
    for dp, _, fns in os.walk(base):
        for fn in fns:
            if fn.startswith("._") or fn == ".DS_Store":
                continue
            p = os.path.join(dp, fn)
            midx.setdefault(key(os.path.relpath(p, base)), []).append(p)

    state = load_state()
    done = set(state.get("audio_parity", []))
    pool = sorted(manifest(MASTER, "Contents").values())
    [r for r in pool if r not in done]
    prog = Progress(len(pool), label="audio hash", initial=len(done))
    fixed = errs = 0
    for rel in pool:
        if rel in done:
            prog.update(0)
            continue
        cands = midx.get(key(rel), [])
        mp = cands[0] if cands else None
        fa = os.path.join(MASTER, "Contents", rel)
        try:
            if mp and os.path.exists(fa) and os.path.exists(mp) and md5(fa) != md5(mp):
                os.makedirs(backup_dir, exist_ok=True)
                shutil.copy2(mp, os.path.join(backup_dir, rel.replace("/", "__")))
                shutil.copy2(fa, mp)
                fixed += 1
            done.add(rel)
        except Exception as e:  # noqa: BLE001
            errs += 1
            print(f"\nERR {rel[:80]}: {e}", flush=True)
        prog.update(1)
        if prog.done % 100 == 0:
            save_state({**state, "audio_parity": sorted(done)})
    state["audio_parity"] = sorted(done)
    save_state(state)
    prog.close(f"variants fixed: {fixed}, errors: {errs} (backups: {backup_dir})")
    return errs


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
        if args.hash_parity and hash_parity(stage):
            print("\nRESULT: HASH PARITY FAILED")
            return 1

    if args.verify_only:
        print("\nRESULT: VERIFY OK")
        return 0

    if args.audio_parity:
        stage.step("Audio byte-parity (master wins, variants backed up)")
        if audio_parity(stage):
            print("\nRESULT: AUDIO PARITY ERRORS")
            return 1
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
        if args.hash_parity and hash_parity(stage):
            print("\nRESULT: MIRRORED, HASH PARITY FAILED")
            return 1

    print("\nRESULT: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
