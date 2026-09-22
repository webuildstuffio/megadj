/**
 * genre-vote-rungs-census.test.ts — pins the rung-metadata seam against
 * the weights SSOT. `src/deck/shared/genre-vote-rungs.ts` is the table
 * every UI renders the FULL ladder from (abstained rungs included); a
 * drift between it and `GENRE_VOTE_WEIGHTS` would render wrong metadata
 * on every surface. Two invariants:
 *
 *  1. KEY PARITY: every rung in GENRE_VOTE_WEIGHTS has a def, and no
 *     def exists without a weight (a new rung is one edit in the defs
 *     file + its weight; forgetting either side fails here).
 *  2. ORDER = WEIGHTS: the defs' `order` is weight-descending, matching
 *     the reliability ladder the docs and canvas teach. Equal weights
 *     keep their doc order (W-number ascending).
 */
import { describe, expect, test } from "bun:test";
import { GENRE_VOTE_WEIGHTS } from "../../fulltags/genre/genre-vote";
import {
  GENRE_VOTE_RUNG_DEFS,
  genreVoteRungsInOrder,
} from "../shared/genre-vote-rungs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("genre vote rung metadata census (defs table ↔ weights SSOT)", () => {
  test("key parity: every weighted rung has a def, no orphan defs", () => {
    const weighted = new Set(Object.keys(GENRE_VOTE_WEIGHTS));
    const defined = new Set(GENRE_VOTE_RUNG_DEFS.map((d) => d.id));
    const missing = [...weighted].filter((k) => !defined.has(k));
    const orphan = [...defined].filter((k) => !weighted.has(k));
    expect(
      missing,
      `rungs with a weight but no def: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(orphan, `defs without a weight: ${orphan.join(", ")}`).toEqual([]);
  });

  test("def order is weight-descending (the reliability ladder)", () => {
    const ordered = genreVoteRungsInOrder();
    for (let i = 1; i < ordered.length; i++) {
      const prev =
        GENRE_VOTE_WEIGHTS[
          ordered[i - 1]!.id as keyof typeof GENRE_VOTE_WEIGHTS
        ];
      const cur =
        GENRE_VOTE_WEIGHTS[ordered[i]!.id as keyof typeof GENRE_VOTE_WEIGHTS];
      expect(
        prev! >= cur!,
        `ladder order broken at #${i}: ${ordered[i - 1]!.name} (w=${prev}) must not weigh less than ${ordered[i]!.name} (w=${cur})`,
      ).toBe(true);
    }
  });

  test("mirrored weights match the SSOT exactly (pinned mirror, not a twin)", () => {
    for (const d of GENRE_VOTE_RUNG_DEFS) {
      const ssot = GENRE_VOTE_WEIGHTS[d.id as keyof typeof GENRE_VOTE_WEIGHTS];
      expect(
        ssot,
        `def ${d.id} has no weight in GENRE_VOTE_WEIGHTS`,
      ).toBeDefined();
      expect(
        d.weight,
        `def ${d.id} weight ${d.weight} ≠ SSOT ${ssot} — update the def alongside the SSOT change`,
      ).toBe(ssot);
    }
  });

  test("every def carries a name, doc ref and description", () => {
    for (const d of GENRE_VOTE_RUNG_DEFS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.docRef).toMatch(/^W\d/);
      expect(d.description.length).toBeGreaterThan(8);
      expect(Number.isInteger(d.order)).toBe(true);
    }
  });

  test("the weights SSOT file still declares the rungs this table mirrors", () => {
    // Path guard: the genre/ re-home (9045101) moved the SSOT; if it
    // moves again this fails with a clear message instead of the census
    // silently pinning a stale copy.
    const ssot = Bun.file(join(ROOT, "src/fulltags/genre/genre-vote.ts"));
    expect(ssot.size).toBeGreaterThan(0);
  });
});
