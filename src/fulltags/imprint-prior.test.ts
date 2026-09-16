// imprint-prior.test.ts — the #128 imprint→family vote rung: table
// integrity (provenance, live families, census from the producer) and
// the vote/arbitration contract (abstain-never-guess).
import { describe, expect, test } from "bun:test";
import {
  IMPRINT_COUNT,
  IMPRINT_FAMILIES,
  imprintStands,
  imprintVote,
} from "./imprint-prior";
import { familyOf } from "../../fulltags/src/exports";

describe("imprint prior (#128): the map is data with provenance", () => {
  test("every mapping cites a source and a verification date", () => {
    const uncited = IMPRINT_FAMILIES.filter(
      (m) => m.src.trim().length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(m.verified),
    );
    expect(uncited).toEqual([]);
  });

  test("every mapping's family is a live scoring family", () => {
    // a mapping into a family the vocab no longer knows is a dead vote —
    // the same failure class as a junk label mapping to edm (#187)
    const dead = IMPRINT_FAMILIES.filter(
      (m) => !familyOf(m.family) && !isKnownFamily(m.family),
    );
    expect(dead).toEqual([]);
  });

  test("census count matches the producer (never hand-copied)", () => {
    expect(IMPRINT_COUNT).toBe(IMPRINT_FAMILIES.length);
    expect(IMPRINT_COUNT).toBeGreaterThan(0);
  });
});

describe("imprint prior (#128): the vote", () => {
  test("known imprints vote their family (case/suffix tolerant)", () => {
    expect(imprintVote("Drumcode")?.family).toBe("techno");
    expect(imprintVote("drumcode records")?.family).toBe("techno");
    expect(imprintVote("Anjunabeats")?.family).toBe("trance");
    expect(imprintVote("Defected Records")?.family).toBe("house");
  });

  test("unknown/junk labels abstain (null, never a guess)", () => {
    expect(imprintVote("Some Random Label")).toBeNull();
    expect(imprintVote("")).toBeNull();
    expect(imprintVote(null)).toBeNull();
    expect(imprintVote("12345")).toBeNull(); // numeric junk gate
    expect(imprintVote("Music")).toBeNull(); // placeholder gate
  });

  test("arbitration: the prior abstains against a contradicting kNN consensus", () => {
    const vote = imprintVote("Drumcode")!;
    expect(vote.family).toBe("techno");
    // audio says house with conviction → the metadata prior steps aside
    expect(imprintStands(vote, "house")).toBe(false);
    // audio agrees, or has no opinion → the prior stands
    expect(imprintStands(vote, "techno")).toBe(true);
    expect(imprintStands(vote, null)).toBe(true);
  });
});

/** Family vocabulary is fixed by the vocab module's FAMILIES table; the
 *  nine names here are that table's output space (pinned by the
 *  cross-map test). Keep this list in lockstep with genre-vocab. */
function isKnownFamily(family: string): boolean {
  return [
    "bass",
    "house",
    "techno",
    "trance",
    "hiphop",
    "edm",
    "pop",
    "groove",
    "mood",
  ].includes(family);
}
