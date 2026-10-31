import type { ArchiveState } from "../core/state";
import { vecToF32Blob } from "../shared/leaf/vector-space";

export type GenreEvalRow = ReturnType<ArchiveState["evalPopulation"]>[number];

/** Small embedded-track row shared by genre command and dispute fixtures.
 * #562: rows carry the `vec_f32` float32 blob the readers parse. */
export function genreEvalRow(
  videoId: string,
  genre: string,
  vec: number[],
  overrides: Partial<GenreEvalRow> = {},
): GenreEvalRow {
  return {
    video_id: videoId,
    genre,
    vec_f32: vecToF32Blob(vec),
    duration_s: 300,
    artist: null,
    ...overrides,
  };
}
