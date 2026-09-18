import { describe, expect, test } from "bun:test";
import { classifyDisputes, type DisputedRow } from "./genre-flag";
import type { EvalSummary, LoORowOutcome } from "../../archive/similar";

const row = (
  videoId: string,
  family: string,
  predicted: string | null,
  agreement: number,
): LoORowOutcome => ({ videoId, family, predicted, agreement, top2: [] });

const summary = (rows: LoORowOutcome[]): EvalSummary => ({
  evaluated: rows.length,
  agree: 0,
  disagree: 0,
  refused: 0,
  agreement: 0,
  refusal: 0,
  ungatedAgreement: 0,
  rows,
});

describe("classifyDisputes (demote-and-flag §5b.3 step 2)", () => {
  test("flags only: gated prediction + different family + unanimous", () => {
    const result = classifyDisputes(
      summary([
        row("bad", "edm", "house", 1), // disputed
        row("ok", "house", "house", 1), // upheld
        row("split", "techno", "techno", 0.8), // no quorum (not unanimous)
        row("refused", "bass", null, 0), // refused
      ]),
    );
    expect(result.disputed).toBe(1);
    expect(result.upheld).toBe(1);
    expect(result.noQuorum).toBe(2);
    expect(result.rows[0]!.videoId).toBe("bad");
    expect(result.rows[0]!.consensus).toBe("house");
  });

  test("empty population → zero counts, empty rows", () => {
    const result = classifyDisputes(summary([]));
    expect(result.evaluated).toBe(0);
    expect(result.disputed).toBe(0);
    expect(result.rows).toEqual([]);
  });

  test("disputed rows carry family/consensus evidence", () => {
    const result = classifyDisputes(
      summary([row("x", "pop", "house", 1), row("y", "trance", "techno", 1)]),
    );
    const families = result.rows.map((r: DisputedRow) => [
      r.family,
      r.consensus,
    ]);
    expect(families).toContainEqual(["pop", "house"]);
    expect(families).toContainEqual(["trance", "techno"]);
  });

  test("near-unanimous is NOT disputed (unanimity is the evidence bar)", () => {
    const result = classifyDisputes(
      summary([
        row("a", "edm", "house", 1),
        row("b", "edm", "house", 0.99), // 4/5 — strong but not unanimous
        row("c", "edm", "house", 0.98),
      ]),
    );
    expect(result.disputed).toBe(1);
    expect(result.noQuorum).toBe(2);
  });
});
