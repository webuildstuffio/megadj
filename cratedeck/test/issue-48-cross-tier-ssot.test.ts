// Issue #48: the engine and CrateDeck must share pure finding/similarity
// semantics through a leaf module. A hand-copied implementation can drift
// without either side's unit tests noticing.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cosineSimilarity } from "../shared/similarity";

const root = join(import.meta.dir, "..", "..");

test("#48: engine and spoke import the one cosine implementation", () => {
  expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  expect(cosineSimilarity([1], [1, 0])).toBe(0);

  const engine = readFileSync(join(root, "src/archive/similar.ts"), "utf8");
  const spoke = readFileSync(
    join(root, "cratedeck/src/archive_similar.ts"),
    "utf8",
  );
  expect(engine).toContain('from "../../cratedeck/shared/similarity"');
  expect(spoke).toContain('from "../shared/similarity"');
  expect(engine).not.toContain("function cosineSimilarity(");
  expect(spoke).not.toContain("function cosine(");
});

test("#48: both hygiene readers hydrate rows through the shared contract", () => {
  const contract = readFileSync(
    join(root, "cratedeck/shared/hygiene.ts"),
    "utf8",
  );
  const engine = readFileSync(
    join(root, "src/archive/hygiene/store.ts"),
    "utf8",
  );
  const spoke = readFileSync(
    join(root, "cratedeck/src/hygiene_reader.ts"),
    "utf8",
  );

  expect(contract).toContain("export function hydrateHygieneFinding");
  expect(engine).toContain("hydrateHygieneFinding");
  expect(engine).toContain("type Row = HygieneFindingRow;");
  expect(spoke).toContain("hydrateHygieneFinding");
  expect(engine).not.toContain("private hydrate(");
  expect(spoke).not.toContain("function hydrate(");
});
