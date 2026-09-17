"""Differential copy-plan tests for mirror_plan.plan_copies (#117).

Runs under the repo's unittest discovery:
    bun run test:py
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        ".claude",
        "skills",
        "rekordbox-usb-sync",
        "scripts",
    ),
)

from mirror_plan import (
    cached_md5,
    files_differ,
    hash_key,
    load_hash_cache,
    plan_copies,
    save_hash_cache,
)


def _touch(path: str, size: int, mtime: float | None = None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x00" * size)
    if mtime is not None:
        os.utime(path, (mtime, mtime))


class PlanCopiesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "master", "Contents")
        self.dst = os.path.join(self.tmp, "mirror", "Contents")
        os.makedirs(self.src)
        os.makedirs(self.dst)

    def _manifest(self, root: str, names: list[str]) -> dict[str, str]:
        return {n.lower(): n for n in names}

    def test_identical_tree_skips_everything(self) -> None:
        for i in range(5):
            _touch(os.path.join(self.src, f"t{i}.wav"), 1000 + i, 1700000000.0)
            _touch(os.path.join(self.dst, f"t{i}.wav"), 1000 + i, 1700000000.0)
        plan = plan_copies(
            self.src,
            self.dst,
            self._manifest(self.src, [f"t{i}.wav" for i in range(5)]),
            self._manifest(self.dst, [f"t{i}.wav" for i in range(5)]),
            set(),
        )
        self.assertEqual(plan["copy"], [])
        self.assertEqual(len(plan["skip"]), 5)
        self.assertEqual(plan["verify"], [])

    def test_one_changed_file_is_exactly_one_copy(self) -> None:
        for i in range(4):
            _touch(os.path.join(self.src, f"t{i}.wav"), 1000, 1700000000.0)
            _touch(os.path.join(self.dst, f"t{i}.wav"), 1000, 1700000000.0)
        # one mirror file truncated (partial copy from an interrupted run)
        _touch(os.path.join(self.dst, "t2.wav"), 400, 1700000000.0)
        plan = plan_copies(
            self.src,
            self.dst,
            self._manifest(self.src, [f"t{i}.wav" for i in range(4)]),
            self._manifest(self.dst, [f"t{i}.wav" for i in range(4)]),
            set(),
        )
        self.assertEqual(plan["copy"], ["t2.wav"])
        self.assertEqual(len(plan["skip"]), 3)

    def test_missing_file_is_a_copy(self) -> None:
        _touch(os.path.join(self.src, "a.wav"), 10, 1700000000.0)
        _touch(os.path.join(self.src, "b.wav"), 10, 1700000000.0)
        _touch(os.path.join(self.dst, "b.wav"), 10, 1700000000.0)
        plan = plan_copies(
            self.src,
            self.dst,
            self._manifest(self.src, ["a.wav", "b.wav"]),
            self._manifest(self.dst, ["b.wav"]),
            set(),
        )
        self.assertEqual(plan["copy"], ["a.wav"])

    def test_size_match_mtime_drift_goes_to_verify_not_copy(self) -> None:
        _touch(os.path.join(self.src, "a.wav"), 1000, 1700000000.0)
        _touch(os.path.join(self.dst, "a.wav"), 1000, 1700001000.0)
        plan = plan_copies(
            self.src,
            self.dst,
            self._manifest(self.src, ["a.wav"]),
            self._manifest(self.dst, ["a.wav"]),
            set(),
        )
        self.assertEqual(plan["copy"], [])
        self.assertEqual(plan["verify"], ["a.wav"])

    def test_state_ledger_done_files_never_recopy(self) -> None:
        _touch(os.path.join(self.src, "a.wav"), 10, 1700000000.0)
        plan = plan_copies(self.src, self.dst, self._manifest(self.src, ["a.wav"]), {}, {"a.wav"})
        self.assertEqual(plan["copy"], [])
        self.assertEqual(plan["done"], ["a.wav"])

    def test_case_variant_on_mirror_is_matched_nfc_casefold(self) -> None:
        _touch(os.path.join(self.src, "Track A.wav"), 10, 1700000000.0)
        _touch(os.path.join(self.dst, "track a.wav"), 10, 1700000000.0)
        plan = plan_copies(
            self.src,
            self.dst,
            self._manifest(self.src, ["Track A.wav"]),
            self._manifest(self.dst, ["track a.wav"]),
            set(),
        )
        self.assertEqual(plan["copy"], [])
        self.assertEqual(len(plan["skip"]), 1)

    def test_unreadable_dst_file_is_a_copy_not_a_crash(self) -> None:
        _touch(os.path.join(self.src, "a.wav"), 10, 1700000000.0)
        plan = plan_copies(
            self.src, self.dst, self._manifest(self.src, ["a.wav"]), {"a.wav": "a.wav"}, set()
        )
        # manifest claims it exists but stat fails (raced unlink) — copy heals
        self.assertEqual(plan["copy"], ["a.wav"])


class FilesDifferTest(unittest.TestCase):
    def test_same_bytes_differ_false(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            a = os.path.join(tmp, "a")
            b = os.path.join(tmp, "b")
            with open(a, "wb") as f:
                f.write(b"x" * (2 << 20))  # > 1 chunk
            with open(b, "wb") as f:
                f.write(b"x" * (2 << 20))
            self.assertFalse(files_differ(a, b))

    def test_different_bytes_differ_true(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            a = os.path.join(tmp, "a")
            b = os.path.join(tmp, "b")
            with open(a, "wb") as f:
                f.write(b"x" * (2 << 20))
            with open(b, "wb") as f:
                f.write(b"x" * (2 << 20 - 1) + b"y")
            self.assertTrue(files_differ(a, b))

    def test_missing_file_counts_as_differ(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(files_differ(os.path.join(tmp, "gone"), os.path.join(tmp, "gone")))


class HashCacheTest(unittest.TestCase):
    """The #117 cached-hash store: identical (path,size,mtime) → cached
    verdict, no re-read; any change re-keys → honest re-hash."""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.cache_path = os.path.join(self.tmp, "hash_cache.json")

    def test_identity_change_invalidates_cached_hash(self) -> None:
        p = os.path.join(self.tmp, "f.bin")
        with open(p, "wb") as f:
            f.write(b"AAA")
        os.utime(p, (1700000000.0, 1700000000.0))
        cache: dict[str, str] = {}
        dirty: set[str] = set()
        h1 = cached_md5(p, cache, dirty, self.cache_path)
        # same identity → cached, no new dirty entry
        h2 = cached_md5(p, cache, dirty, self.cache_path)
        self.assertEqual(h1, h2)
        self.assertEqual(len(dirty), 1)
        # content changes WITHOUT mtime change (writer preserves stamp) —
        # the cache key still matches, but this is exactly why callers
        # invalidate on write; a changed mtime must re-key:
        with open(p, "wb") as f:
            f.write(b"BBB")
        os.utime(p, (1700000500.0, 1700000500.0))
        h3 = cached_md5(p, cache, dirty, self.cache_path)
        self.assertNotEqual(h1, h3)
        self.assertEqual(len(dirty), 2)

    def test_cache_persists_across_load_save(self) -> None:
        p = os.path.join(self.tmp, "f.bin")
        with open(p, "wb") as f:
            f.write(b"hello")
        cache: dict[str, str] = {}
        dirty: set[str] = set()
        h = cached_md5(p, cache, dirty, self.cache_path)
        save_hash_cache(cache, self.cache_path)
        loaded = load_hash_cache(self.cache_path)
        self.assertEqual(loaded, {hash_key(p, 5, os.stat(p).st_mtime): h})
        # a fresh run with the loaded cache does NOT re-hash (no dirty keys)
        dirty2: set[str] = set()
        h2 = cached_md5(p, dict(loaded), dirty2, self.cache_path)
        self.assertEqual(h2, h)
        self.assertEqual(dirty2, set())

    def test_corrupt_cache_file_is_a_cold_cache(self) -> None:
        with open(self.cache_path, "w") as f:
            f.write("{not json")
        self.assertEqual(load_hash_cache(self.cache_path), {})

    def test_missing_cache_file_is_a_cold_cache(self) -> None:
        self.assertEqual(load_hash_cache(os.path.join(self.tmp, "gone.json")), {})

    def test_non_string_values_dropped_on_load(self) -> None:
        save_hash_cache({"k": "v"}, self.cache_path)
        with open(self.cache_path) as f:
            import json

            raw = json.load(f)
        raw[123] = ["not", "a", "string"]
        with open(self.cache_path, "w") as f:
            json.dump(raw, f)
        loaded = load_hash_cache(self.cache_path)
        self.assertEqual(loaded, {"k": "v"})


if __name__ == "__main__":
    unittest.main()
