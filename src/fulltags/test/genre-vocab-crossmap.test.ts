// genre-vocab-crossmap.test.ts — the #187 cross-map consistency gate.
// Pins the CONTRACT between the vocabulary maps so the two historical
// mis-map classes can never silently return:
//   1. bare-label gap: every real canon value lands on a scoring family
//   2. over-broad regex: junk category labels map to NO family
// Pure — reads only the vocabulary tables.
import { describe, expect, test } from "bun:test";
import {
  AI_VOCAB,
  familyOf,
  isUmbrellaLabel,
  normalizeGenre,
  SC_GENRE_CANON,
} from "../genre-vocab";

describe("genre vocab: cross-map consistency (#187)", () => {
  test("every canon VALUE that is not an umbrella lands on a family", () => {
    const orphans = Object.values(SC_GENRE_CANON).filter(
      (label) => !isUmbrellaLabel(label) && familyOf(label) === null,
    );
    // "Edits / Bootlegs"-style non-genre canon values would be an honest
    // gap only if intentionally listed; today the canon map has none, so
    // ANY orphan is a regression (the bare-`d&b` gap class).
    expect(orphans).toEqual([]);
  });

  test("junk category claims map to NO family (the loop-samples rule)", () => {
    for (const junk of ["loop samples", "dj tools", "Loop Samples", "DJ Tools"])
      expect(familyOf(junk)).toBeNull();
  });

  test("umbrella labels abstain from scoring families", () => {
    for (const label of ["EDM", "Dance", "Electronic", "Mainstage EDM"])
      expect(isUmbrellaLabel(label)).toBe(true);
  });

  test("every AI vocabulary entry resolves through the family map", () => {
    // The real cross-map property: the AI can only vote labels the rest
    // of the pipeline understands. Each vocab label must land on a
    // scoring family, be an umbrella parent, or be one of the deliberate
    // non-scoring labels — anything else is a silent coverage hole.
    const NON_SCORING = new Set(["Edits / Bootlegs", "Unknown"]);
    const holes = AI_VOCAB.split(", ").filter(
      (label) =>
        !NON_SCORING.has(label) &&
        !isUmbrellaLabel(label) &&
        familyOf(label) === null,
    );
    expect(holes).toEqual([]);
  });

  test("normalizeGenre is escape-repairing and junk-refusing", () => {
    expect(normalizeGenre("Hip-hop \\u0026 rap")).toBe("hip-hop & rap");
    expect(normalizeGenre("Music")).toBeNull();
    expect(normalizeGenre("unknown")).toBeNull();
    expect(normalizeGenre("fixme")).toBeNull();
  });
});
