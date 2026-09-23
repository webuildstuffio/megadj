import { describe, expect, test } from "bun:test";
import { tier0Diagnostics } from "./genre-diagnostics";
import type { GenreSeed, LoORowOutcome } from "../../core/similar";

/** A two-family population: 6 house rows by "Alice" (a tight cluster)
 *  + 4 techno rows by "Bob", all unit-ish 2-d vectors. */
const basePop = (): (GenreSeed & { artist: string; family: string })[] => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`,
      family: "house",
      artist: "Alice",
      vec: [1, i * 0.01],
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      family: "techno",
      artist: "Bob",
      vec: [i * 0.01, 1],
    })),
  ];
  return rows.map((r) => ({
    videoId: r.id,
    genre: r.family,
    family: r.family,
    artist: r.artist,
    vec: r.vec,
  }));
};

const looRow = (
  videoId: string,
  family: string,
  predicted: string | null,
  top2: string[],
): LoORowOutcome => ({
  videoId,
  family,
  predicted,
  agreement: predicted === family ? 1 : 0,
  top2,
});

/** L2 normalize (module scope — oxlint consistent-function-scoping). */
const n3 = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
};

const mk = (
  id: string,
  family: string,
  artist: string,
  vec: number[],
): GenreSeed & { artist: string; family: string } => ({
  videoId: id,
  genre: family,
  family,
  artist,
  vec,
});

describe("tier-0 genre diagnostics (research review 0.1–0.4)", () => {
  test("clean LOO: verdict random, low hubness, no triangle confusion", () => {
    const pop = basePop();
    const loo = pop.map((p) =>
      looRow(p.videoId, p.family, p.family, [p.family]),
    );
    const d = tier0Diagnostics(pop, loo);
    expect(d.labelErrors.top10Share).toBe(0);
    expect(d.labelErrors.verdict).toBe("random");
    expect(d.confusion.triangleShare).toBe(0);
    expect(d.confusion.top2Accuracy).toBe(1);
    // tight clusters: every neighbour is same-artist (Alice's 6 rows)
    expect(d.artistOverlap.rerunNeeded).toBe(true);
  });

  test("systematic label errors concentrate on one artist", () => {
    const pop = basePop();
    // 4 disagreements, 3 from "Eve" → top-10 share = 0.75 → systematic
    const loo = [
      looRow("h0", "house", "house", ["house"]),
      looRow("h1", "house", "techno", ["techno", "house"]),
      looRow("h2", "house", "trance", ["trance", "house"]),
      looRow("h3", "house", "bass", ["bass", "house"]),
      looRow("t0", "techno", "house", ["house", "techno"]),
    ];
    const d = tier0Diagnostics(pop, loo);
    // h1/h2/h3 are Alice's; t0 is Bob's → top artist holds 3/4
    expect(d.labelErrors.artists).toBe(2);
    expect(d.labelErrors.top10Share).toBe(1); // only 2 artists → both in top-10
    expect(d.labelErrors.verdict).toBe("systematic");
    expect(d.labelErrors.top[0]).toEqual({
      artist: "Alice",
      disagreements: 3,
      share: 0.75,
    });
  });

  test("confusion matrix counts truth→predicted and triangle share", () => {
    const pop = basePop();
    const loo = [
      looRow("h0", "house", "techno", ["techno", "house"]), // triangle
      looRow("h1", "house", "trance", ["trance", "house"]), // triangle
      looRow("t0", "techno", "pop", ["pop", "techno"]), // structural
    ];
    const d = tier0Diagnostics(pop, loo);
    expect(d.confusion.matrix.house!.techno).toBe(1);
    expect(d.confusion.matrix.house!.trance).toBe(1);
    expect(d.confusion.matrix.techno!.pop).toBe(1);
    expect(d.confusion.triangleShare).toBeCloseTo(2 / 3, 3);
    // top-2: h0 truth=house in [techno,house] ✓; h1 ✓; t0 truth=techno in
    // [pop,techno] ✓ → 3/3
    expect(d.confusion.top2Accuracy).toBe(1);
  });

  test("hubness: a central neighbour appears in every top-k list", () => {
    // high-dim cone: 3 rows = hub + orthogonal perturbations (pairwise
    // cos 0–0.5), hub at cos 0.707 from every row — so the hub wins a
    // slot in EVERY row's top-2 (the 2-d analog is geometrically
    // impossible: hubness is a high-dim phenomenon)
    const pop = [
      mk("hub", "techno", "Bob", [1, 0, 0]),
      mk("r1", "house", "Alice", n3([1, 1, 0])),
      mk("r2", "house", "Alice", n3([1, 0, 1])),
      mk("r3", "house", "Alice", n3([1, 0, -1])),
    ];
    const loo = pop.map((p) =>
      looRow(p.videoId, p.family, p.family, [p.family]),
    );
    const d = tier0Diagnostics(pop, loo, 2);
    expect(d.hubness.maxOccurrence).toBe(3); // hub in all three top-2 lists
    expect(d.hubness.tracks).toBe(3); // rows appearing in someone's top-2
    expect(d.hubness.hubs10).toBe(0); // 3 occurrences < the ≥10 hub bar
  });

  test("empty population degrades without throwing", () => {
    const d = tier0Diagnostics([], [], 5);
    expect(d.labelErrors.verdict).toBe("random");
    expect(d.hubness.tracks).toBe(0);
    expect(d.confusion.top2Accuracy).toBe(0);
  });
});
