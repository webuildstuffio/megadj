import type { ArchiveState } from "../core/state";

export type GenreEvalRow = ReturnType<ArchiveState["evalPopulation"]>[number];

/** Small embedded-track row shared by genre command and dispute fixtures. */
export function genreEvalRow(
  videoId: string,
  genre: string,
  vecJson: string,
  overrides: Partial<GenreEvalRow> = {},
): GenreEvalRow {
  return {
    video_id: videoId,
    genre,
    vec_json: vecJson,
    duration_s: 300,
    artist: null,
    ...overrides,
  };
}
