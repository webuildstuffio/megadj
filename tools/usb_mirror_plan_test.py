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

from mirror_plan import files_differ, plan_copies


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


if __name__ == "__main__":
    unittest.main()
