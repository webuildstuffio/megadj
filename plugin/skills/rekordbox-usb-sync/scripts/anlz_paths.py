#!/usr/bin/env python3
"""Shared Pioneer ANLZ hash-path computation.

Players ignore the DB's analysisDataFilePath — they compute the USBANLZ
folder from the device-relative audio path with this hash. On collision,
Pioneer uses open addressing: bump the 8-hex suffix by +1 until the folder
is free, keeping the PXXX device prefix of the original hash.

Single source of truth for usb_sync.py, usb_verify.py and fix_anlz_paths.py.
"""

ANLZ_HASH_MOD = 200003  # prime


def _device_prefix(hr: int) -> int:
    return (
        (hr & 1)
        | ((hr >> 1) & 2)
        | ((hr >> 4) & 0xC)
        | ((hr >> 5) & 0x10)
        | ((hr >> 8) & 0x20)
        | ((hr >> 10) & 0x40)
    )


def compute_anlz_folder(file_path: str) -> tuple[int, int]:
    """Return (device_folder_p, hash_remainder) for a device-relative audio path."""
    hash_val = 0
    for ch in file_path:
        c = ord(ch) & 0xFFFF
        hash_val = (hash_val * 0x5BC9 + c) & 0xFFFFFFFF
        hash_val = (hash_val * 0x93B5 + c) & 0xFFFFFFFF
    hr = hash_val % ANLZ_HASH_MOD
    return _device_prefix(hr), hr


def folder_key(p: int, hr: int) -> str:
    """The 'PXXX/HHHHHHHH' folder key for a device prefix + hash remainder."""
    return f"P{p:03X}/{hr:08X}"


def next_free_suffix(p: int, hr: int, occupied: set[str]) -> int:
    """Open addressing: bump hr by +1 (wrapping past the prime) until its
    folder key is not in `occupied`. The PXXX prefix stays fixed."""
    cand = hr
    while True:
        cand += 1
        if cand >= ANLZ_HASH_MOD:
            cand = 1
        if folder_key(p, cand) not in occupied:
            return cand
