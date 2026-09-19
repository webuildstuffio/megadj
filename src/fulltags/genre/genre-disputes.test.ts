// genre-disputes.test.ts — the #64 review surface: collect (read-only
// evidence) + resolve (agree/keep verbs through the state seam).
// The state double mirrors genre.test.ts's shape; the consensus math is
// the real inferGenre engine (2-d vectors, same as the --flag tests).
import { describe, expect, test } from "bun:test";
import { collectDisputes, resolveDispute } from "./genre-disputes";
import type { ArchiveState } from "../../archive/state";
import { genreEvalRow } from "../../test-support/genre-row";

describe("genre --disputes (#64 review surface)", () => {
  test("collect lists flagged rows with live consensus + embed age", () => {
    // one flagged row whose neighbourhood (3 house seeds) votes house
    // unanimously, one whose neighbourhood is split (no consensus)
    const state = {
      disputedRows: () => [
        {
          video_id: "bad",
          title: "Track A",
          artist: "Artist A",
          genre: "EDM",
        },
        // far corner: split neighbourhood, no quorum — k=2 sees one house
        // (the mislabeled row is ex-flagged in disputeVoteInputs' seeds)
        // and one techno → refused vote
        {
          video_id: "split",
          title: "Track B",
          artist: "Artist B",
          genre: "Bass",
        },
      ],
      disputeVoteInputs: () => ({
        flagged: [
          {
            video_id: "bad",
            vec_json: "[1,0]",
            analyzed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          },
          {
            video_id: "split",
            vec_json: "[0,1]",
            analyzed_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          },
        ],
        seeds: [
          genreEvalRow("h1", "House", "[1,0.01]"),
          genreEvalRow("h2", "House", "[1,0.02]"),
          genreEvalRow("h3", "House", "[0.99,0.03]"),
          // a techno corner for the "split" row to sit in: with k=5 the
          // split row's 5 nearest include 2 house (h1/h3 are near it too
          // in 2-d) — make the split real by keeping its neighbours
          // balanced: 2 house + 2 techno + 1 groove → no 60% quorum
          genreEvalRow("t1", "Techno", "[0,0.95]"),
          genreEvalRow("t2", "Techno", "[0.02,0.97]"),
          genreEvalRow("g1", "Groove", "[0.4,0.9]"),
        ],
      }),
    } as unknown as ArchiveState;

    const review = collectDisputes(state);
    expect(review.flagged).toBe(2);
    const bad = review.rows.find((r) => r.videoId === "bad");
    expect(bad?.consensus).toBe("house");
    // k=5 neighbourhood: 3 house + 2 near-house votes → gated at 0.6,
    // not unanimous — the review surface shows gated consensus strength
    expect(bad?.agreement).toBe(0.6);
    expect(bad?.embedAgeDays).toBe(2);
    const split = review.rows.find((r) => r.videoId === "split");
    expect(split?.consensus).toBeNull();
    expect(split?.embedAgeDays).toBe(5);
  });

  test("keep clears the flag, label untouched; re-keep refuses", () => {
    let cleared: string | null = null;
    const state = {
      disputedRows: (): {
        video_id: string;
        title: string;
        artist: string;
        genre: string;
      }[] =>
        cleared === null
          ? [
              {
                video_id: "rb-1",
                title: "T",
                artist: "A",
                genre: "Electronic",
              },
            ]
          : [],
      setGenreFlag: (videoId: string, flag: "disputed" | null) => {
        cleared = flag === null ? videoId : null;
      },
      setGenreFlagNote: (_videoId: string, _note: string) => {},
    } as unknown as ArchiveState;

    const res = resolveDispute(state, {
      videoId: "rb-1",
      verb: "keep",
      note: "source is right",
    });
    expect(res.ok).toBe(true);
    expect(cleared === "rb-1").toBe(true);
    // second keep: row is no longer flagged → refuses
    const again = resolveDispute(state, {
      videoId: "rb-1",
      verb: "keep",
    });
    expect(again.ok).toBe(false);
  });

  test("agree forces the label to the live consensus and clears the flag", () => {
    let written: { videoId: string; genre: string } | null = null;
    let flagCleared = false;
    const state = {
      disputedRows: () => [
        { video_id: "rb-2", title: "T", artist: "A", genre: "Dance" },
      ],
      disputeVoteInputs: () => ({
        flagged: [
          {
            video_id: "rb-2",
            vec_json: "[1,0]",
            analyzed_at: new Date().toISOString(),
          },
        ],
        seeds: [
          { video_id: "h1", genre: "House", vec_json: "[1,0.01]" },
          { video_id: "h2", genre: "House", vec_json: "[1,0.02]" },
          { video_id: "h3", genre: "House", vec_json: "[0.99,0.03]" },
        ],
      }),
      agreeDispute: (id: string, resolvedGenre: string) => {
        written = { videoId: id, genre: resolvedGenre };
      },
      setGenreFlag: (_videoId: string, flag: "disputed" | null) => {
        if (flag === null) flagCleared = true;
      },
    } as unknown as ArchiveState;

    const res = resolveDispute(state, {
      videoId: "rb-2",
      verb: "agree",
    });
    expect(res.ok).toBe(true);
    expect(
      (written as { videoId: string; genre: string } | null) ?? null,
    ).toEqual({
      videoId: "rb-2",
      genre: "house",
    });
    expect(flagCleared).toBe(false); // agreeDispute clears it atomically
  });

  test("agree with no live consensus refuses (never writes an arbitrary label)", () => {
    const state = {
      disputedRows: () => [
        { video_id: "rb-3", title: "T", artist: "A", genre: "EDM" },
      ],
      disputeVoteInputs: () => ({
        flagged: [
          {
            video_id: "rb-3",
            vec_json: "[1,0]",
            analyzed_at: new Date().toISOString(),
          },
        ],
        seeds: [
          // split neighbourhood: house vs techno → no quorum
          { video_id: "h1", genre: "House", vec_json: "[1,0.01]" },
          { video_id: "t1", genre: "Techno", vec_json: "[0,1]" },
        ],
      }),
      agreeDispute: () => {
        throw new Error("must not be called");
      },
    } as unknown as ArchiveState;

    const res = resolveDispute(state, { videoId: "rb-3", verb: "agree" });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("no current consensus");
  });

  test("--k threads into the review consensus (tighter k flips a split row)", () => {
    // k=5: 2 house + 2 techno + 1 groove → no 60% quorum. k=2: the two
    // house seeds are the nearest → unanimous. Same data, different k.
    // (module-scope factory — consistent-function-scoping)
    const wide = collectDisputes(SPLIT_ROW_STATE, 5).rows[0]!;
    const tight = collectDisputes(SPLIT_ROW_STATE, 2).rows[0]!;
    expect(wide.consensus).toBeNull();
    expect(tight.consensus).toBe("house");
  });
});

const SPLIT_ROW_STATE = {
  disputedRows: () => [
    { video_id: "rb-4", title: "T", artist: "A", genre: "EDM" },
  ],
  disputeVoteInputs: () => ({
    flagged: [
      {
        video_id: "rb-4",
        vec_json: "[0.9,0.1]",
        analyzed_at: new Date().toISOString(),
      },
    ],
    seeds: [
      { video_id: "h1", genre: "House", vec_json: "[1,0]" },
      { video_id: "h2", genre: "House", vec_json: "[0.95,0.05]" },
      { video_id: "t1", genre: "Techno", vec_json: "[0.3,0.9]" },
      { video_id: "t2", genre: "Techno", vec_json: "[0.2,0.95]" },
      { video_id: "g1", genre: "Groove", vec_json: "[0.5,0.8]" },
    ],
  }),
} as unknown as ArchiveState;
