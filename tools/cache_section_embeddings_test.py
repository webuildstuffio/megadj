"""Regression tests for the section cache tool's vec_f32 schema guard (#562)."""

from __future__ import annotations

import json
import sqlite3
import unittest

import numpy as np

from tools.cache_section_embeddings import ensure_vec_f32_column

# Pre-#562 schema (state-core.ts DDL minus the vec_f32 column) and the
# current one — the guard must bridge exactly this gap and nothing else.
LEGACY_DDL = """
CREATE TABLE section_embeddings (
    video_id TEXT NOT NULL, model TEXT NOT NULL,
    dim INTEGER NOT NULL, vec_json TEXT NOT NULL,
    source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL,
    section_start REAL, section_end REAL,
    PRIMARY KEY (video_id, model)
)
"""

CURRENT_DDL = """
CREATE TABLE section_embeddings (
    video_id TEXT NOT NULL, model TEXT NOT NULL,
    dim INTEGER NOT NULL, vec_json TEXT NOT NULL, vec_f32 BLOB,
    source_path TEXT NOT NULL, analyzed_at TEXT NOT NULL,
    section_start REAL, section_end REAL,
    PRIMARY KEY (video_id, model)
)
"""

# The tool's write statement: names vec_f32, so it needs the column.
INSERT = """
INSERT OR REPLACE INTO section_embeddings
    (video_id, model, dim, vec_json, vec_f32, source_path, analyzed_at,
     section_start, section_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def column_names(conn: sqlite3.Connection) -> list[str]:
    return [
        str(row[1]) for row in conn.execute("PRAGMA table_info(section_embeddings)")
    ]


class EnsureVecF32ColumnTest(unittest.TestCase):
    def test_legacy_archive_gains_column_and_insert_succeeds(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.execute(LEGACY_DDL)
        vec = np.asarray([0.25, -0.5, 2.0], dtype=np.float32)

        ensure_vec_f32_column(conn)
        self.assertIn("vec_f32", column_names(conn))

        # idempotent: a second pass neither raises nor duplicates
        ensure_vec_f32_column(conn)
        self.assertEqual(column_names(conn).count("vec_f32"), 1)

        # the tool's 9-column write then works and the blob round-trips
        # as little-endian float32 (the TS vecToF32Blob byte contract)
        conn.execute(
            INSERT,
            (
                "vid",
                "effnet-discogs-1280-section-1",
                len(vec),
                json.dumps(vec.tolist()),
                np.asarray(vec, dtype="<f4").tobytes(),
                "/music/a.mp3",
                "2026-10-31T00:00:00Z",
                1.0,
                33.0,
            ),
        )
        row = conn.execute(
            "SELECT vec_f32 FROM section_embeddings WHERE video_id = 'vid'"
        ).fetchone()
        self.assertIsNotNone(row)
        restored = np.frombuffer(row[0], dtype="<f4")
        np.testing.assert_array_equal(restored, vec)

    def test_current_archive_is_a_noop(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.execute(CURRENT_DDL)

        ensure_vec_f32_column(conn)

        self.assertEqual(column_names(conn).count("vec_f32"), 1)

    def test_missing_table_is_a_noop(self) -> None:
        conn = sqlite3.connect(":memory:")

        ensure_vec_f32_column(conn)

        self.assertIsNone(
            conn.execute("PRAGMA table_info(section_embeddings)").fetchone()
        )


if __name__ == "__main__":
    unittest.main()
