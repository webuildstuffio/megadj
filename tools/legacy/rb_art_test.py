"""Write-safety regressions for the legacy rekordbox artwork helper."""

from __future__ import annotations

import io
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from tools.legacy import rb_art


class RbArtTargetSafetyTest(unittest.TestCase):
    def test_db_target_must_be_explicit_or_configured(self) -> None:
        with self.assertRaisesRegex(ValueError, "--db or MEGADJ_RB_MASTER"):
            rb_art.resolve_db_path(None, {})

    def test_explicit_target_wins_over_configured_target(self) -> None:
        explicit = Path("/Volumes/SHELF1/PIONEER/Master/master.db")
        configured = "/Volumes/OTHER/PIONEER/Master/master.db"
        self.assertEqual(
            rb_art.resolve_db_path(explicit, {"MEGADJ_RB_MASTER": configured}),
            explicit,
        )

    def test_stale_local_master_is_rejected_even_when_explicit(self) -> None:
        local = Path.home() / "Library/Pioneer/rekordbox/master.db"
        with self.assertRaisesRegex(ValueError, "stale local rekordbox DB"):
            rb_art.resolve_db_path(local, {})

    def test_mutating_modes_fail_before_opening_any_database(self) -> None:
        stderr = io.StringIO()
        with (
            patch.object(rb_art, "open_db") as open_db,
            redirect_stderr(stderr),
        ):
            code = rb_art.main(
                [
                    "pilot",
                    "--db",
                    "/Volumes/SHELF1/PIONEER/Master/master.db",
                ]
            )
        self.assertEqual(code, 2)
        self.assertIn("mutating artwork mode is disabled", stderr.getvalue())
        open_db.assert_not_called()


if __name__ == "__main__":
    unittest.main()
