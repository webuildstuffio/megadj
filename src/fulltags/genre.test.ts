import { describe, expect, test } from "bun:test";
import type { ArchiveState } from "../archive/state";
import { genre } from "./genre";

describe("genre command JSON boundary", () => {
  test("pre-validates every stored vector before --apply mutates a track", async () => {
    const updates: string[] = [];
    const state = {
      genreSeeds: () => ({
        seeds: [{ video_id: "seed", genre: "House", vec_json: "[1,0]" }],
        queries: [
          { video_id: "would-write", title: "First", vec_json: "[1,0]" },
          { video_id: "corrupt", title: "Second", vec_json: "not-json" },
        ],
      }),
      updateGenre: (videoId: string) => updates.push(videoId),
    } as unknown as ArchiveState;

    await expect(genre({ state, apply: true })).rejects.toThrow(
      "genre query corrupt has invalid vec_json",
    );
    expect(updates).toEqual([]);
  });

  test("rejects syntactically valid non-vector JSON with row context", async () => {
    const state = {
      genreSeeds: () => ({
        seeds: [{ video_id: "bad-seed", genre: "House", vec_json: '[1,"x"]' }],
        queries: [],
      }),
      updateGenre: () => {
        throw new Error("must not write");
      },
    } as unknown as ArchiveState;

    await expect(genre({ state, apply: true })).rejects.toThrow(
      "genre seed bad-seed has invalid vec_json: expected a non-empty array of finite numbers",
    );
  });
});
