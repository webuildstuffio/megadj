// Issue #48: the engine and CrateDeck must share pure finding/similarity
// semantics through a leaf module. A hand-copied implementation can drift
// without either side's unit tests noticing.
import { expect, test } from "bun:test";
import { cosineSimilarity } from "../../shared/leaf/vector-space";

test("#48: engine and spoke import the one cosine implementation", () => {
  expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  expect(cosineSimilarity([1], [1, 0])).toBe(0);
});
