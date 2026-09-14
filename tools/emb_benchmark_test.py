"""Regression tests for the embedding benchmark's leave-one-out metrics."""

from __future__ import annotations

import unittest

import numpy as np

from tools.emb_benchmark import embedding_metrics


class EmbeddingMetricsTest(unittest.TestCase):
    def test_failed_middle_row_keeps_compact_and_source_indices_separate(self) -> None:
        vectors = np.asarray(
            [
                [1.0, 0.0],
                [0.0, 0.0],  # failed embedding: excluded from evaluation
                [0.9, 0.1],
                [0.0, 1.0],
            ],
            dtype=np.float32,
        )
        vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)
        labels = np.asarray(["house", "ignored", "house", "techno"])

        total, agreement, coherence = embedding_metrics(vectors, labels, k=1)

        self.assertEqual(total, 3)
        self.assertAlmostEqual(agreement, 2 / 3)
        self.assertAlmostEqual(coherence, 2 / 3)

    def test_k_is_bounded_to_real_non_self_neighbors(self) -> None:
        vectors = np.asarray([[1.0, 0.0]], dtype=np.float32)
        labels = np.asarray(["house"])

        total, agreement, coherence = embedding_metrics(vectors, labels, k=99)

        self.assertEqual(total, 1)
        self.assertEqual(agreement, 0.0)
        self.assertEqual(coherence, 0.0)


if __name__ == "__main__":
    unittest.main()
