// genre-vote.test.ts — #173: the weighted multi-source vote ladder.
// Contract: highest total weight wins, ties break toward the harder single
// gate (deterministic), imprint votes are family-only, the breakdown
// round-trips through serialize/parse, and corrupt breakdowns read as
// empty (poison-row rule — never throws into a query).
import { describe, expect, test } from "bun:test";
import {
  GENRE_VOTE_WEIGHTS,
  electGenre,
  parseVotes,
  serializeVotes,
  type GenreVote,
} from "./genre-vote";

const v = (
  rung: GenreVote["rung"],
  genre: string,
  detail?: string,
): GenreVote => ({
  rung,
  genre,
  weight: GENRE_VOTE_WEIGHTS[rung],
  ...(detail !== undefined ? { detail } : {}),
});

describe("GENRE_VOTE_WEIGHTS (the doc's W-table, versioned in code)", () => {
  test("catalog taxonomy > artist pages > free-text > file tags > category > imprint", () => {
    expect(GENRE_VOTE_WEIGHTS.bp).toBeGreaterThan(GENRE_VOTE_WEIGHTS.bc);
    expect(GENRE_VOTE_WEIGHTS.bc).toBeGreaterThan(GENRE_VOTE_WEIGHTS.sc);
    expect(GENRE_VOTE_WEIGHTS.file).toBeGreaterThan(GENRE_VOTE_WEIGHTS.sync);
    expect(GENRE_VOTE_WEIGHTS.imprint).toBeLessThan(GENRE_VOTE_WEIGHTS.sync);
  });

  test("the imprint prior can never outvote two agreeing catalog rungs", () => {
    expect(GENRE_VOTE_WEIGHTS.imprint * 2).toBeLessThan(GENRE_VOTE_WEIGHTS.sc);
  });
});

describe("electGenre", () => {
  test("empty votes → honest null election", () => {
    const r = electGenre([]);
    expect(r.genre).toBeNull();
    expect(r.winnerRungs).toEqual([]);
    expect(r.weight).toBe(0);
    expect(r.familyOnly).toBe(false);
  });

  test("single rung wins with its own weight", () => {
    const r = electGenre([v("bp", "Techno")]);
    expect(r.genre).toBe("Techno");
    expect(r.winnerRungs).toEqual(["bp"]);
    expect(r.weight).toBe(GENRE_VOTE_WEIGHTS.bp);
    expect(r.familyOnly).toBe(false);
  });

  test("agreement stacks: sc + bc beat bp alone", () => {
    const r = electGenre([
      v("sc", "Techno"),
      v("bc", "Techno"),
      v("bp", "House"),
    ]);
    expect(r.genre).toBe("Techno");
    expect(r.winnerRungs).toEqual(["sc", "bc"]);
    expect(r.weight).toBeCloseTo(
      GENRE_VOTE_WEIGHTS.sc + GENRE_VOTE_WEIGHTS.bc,
      10,
    );
  });

  test("exact tie breaks toward the higher single weight (the harder gate)", () => {
    // mb (0.4) vs sync (0.2) + sync (0.2): doubling a float is exact, so
    // both totals are the IDENTICAL bit pattern — a genuine tie. The tie
    // breaks to the rung with the higher single weight (mb), i.e. the
    // harder gate wins over two weak agreeing votes.
    const a = electGenre([v("mb", "Techno")]);
    const b = electGenre([v("sync", "House"), v("sync", "House")]);
    expect(a.weight).toBe(b.weight); // bit-identical totals
    const tied = electGenre([
      v("mb", "Techno"),
      v("sync", "House"),
      v("sync", "House"),
    ]);
    expect(tied.genre).toBe("Techno");
    expect(tied.winnerRungs).toEqual(["mb"]);
  });

  test("imprint-only votes elect the family (sole voice)", () => {
    const r = electGenre([v("imprint", "techno", "Drumcode")]);
    expect(r.genre).toBe("techno");
    expect(r.familyOnly).toBe(true);
    expect(r.weight).toBe(GENRE_VOTE_WEIGHTS.imprint);
  });

  test("one real genre vote beats the imprint prior (family never overwrites)", () => {
    const r = electGenre([v("imprint", "techno"), v("sync", "House")]);
    expect(r.genre).toBe("House");
    expect(r.familyOnly).toBe(false);
  });

  test("familyOnly is false when a non-imprint rung joins the family label", () => {
    const r = electGenre([v("imprint", "techno"), v("sc", "techno")]);
    expect(r.genre).toBe("techno");
    expect(r.familyOnly).toBe(false);
    expect(r.winnerRungs).toEqual(["imprint", "sc"]);
  });

  test("deterministic: same votes → same winner (alphabetical final tiebreak)", () => {
    const votes: GenreVote[] = [v("ai", "Ambient"), v("ai", "Downtempo")];
    // same rung, same weight → alphabetical
    expect(electGenre(votes).genre).toBe("Ambient");
    expect(electGenre(votes.toReversed()).genre).toBe("Ambient");
  });
});

describe("serializeVotes / parseVotes round-trip", () => {
  test("breakdown survives the ledger column", () => {
    const votes = [v("bp", "Techno"), v("imprint", "techno", "Drumcode")];
    const back = parseVotes(serializeVotes(votes));
    expect(back).toEqual(votes);
  });

  test("null/empty reads as empty", () => {
    expect(parseVotes(null)).toEqual([]);
    expect(parseVotes("")).toEqual([]);
  });

  test("corrupt JSON reads as empty — never throws into a query", () => {
    expect(parseVotes("{not json")).toEqual([]);
    expect(parseVotes("[broken")).toEqual([]);
  });

  test("non-array or malformed entries are dropped, not thrown", () => {
    expect(parseVotes(JSON.stringify({ rung: "bp" }))).toEqual([]);
    expect(
      parseVotes(JSON.stringify([{ rung: "nope", genre: "X", weight: 1 }])),
    ).toEqual([]); // unknown rung
    expect(
      parseVotes(JSON.stringify([{ rung: "bp", genre: 5, weight: 0.6 }])),
    ).toEqual([]); // non-string genre
    const partial = parseVotes(
      JSON.stringify([
        { garbage: true },
        { rung: "bp", genre: "Techno", weight: 0.6 },
      ]),
    );
    expect(partial).toEqual([v("bp", "Techno")]);
  });
});
