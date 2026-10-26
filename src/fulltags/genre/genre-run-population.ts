import type { ArchiveState } from "../../core/state";
import { genreFamily, parseEmbeddingVector, type GenreSeed } from "../../core/similar";
import { l2normalize } from "../../shared/leaf/vector-space";
import type { ProbeRow } from "../analysis/linear-probe";

export interface ParsedEvalPopulation {
  sourceRows: ReturnType<ArchiveState["evalPopulation"]>;
  seeds: GenreSeed[];
  durations: { videoId: string; durationS: number | null }[];
  artists: Map<string, string>;
  probeRows: ProbeRow[];
}

export interface ParsedInferenceQuery {
  videoId: string;
  title: string | null;
  vec: number[];
  /** Section-candidate embeddings (best-of-3). Empty when no section
   * embeddings exist — falls back to whole-track vec. */
  sectionVecs: number[][];
}

export interface ParsedInferencePopulation {
  seeds: GenreSeed[];
  queries: ParsedInferenceQuery[];
  queryCount: number;
}

export function parseEvalPopulation(
  state: ArchiveState,
  purpose: "eval" | "flag",
): ParsedEvalPopulation {
  const sourceRows = state.evalPopulation();
  const seeds: GenreSeed[] = [];
  const durations: { videoId: string; durationS: number | null }[] = [];
  const artists = new Map<string, string>();
  const probeRows: ProbeRow[] = [];
  for (const row of sourceRows) {
    const vec = parseEmbeddingVector(row.vec_json, `genre ${purpose} ${row.video_id}`);
    seeds.push({ videoId: row.video_id, genre: row.genre, vec });
    durations.push({ videoId: row.video_id, durationS: row.duration_s });
    if (row.artist) artists.set(row.video_id, row.artist);
    const family = purpose === "eval" ? genreFamily(row.genre) : null;
    if (purpose === "eval" && family !== null)
      probeRows.push({ videoId: row.video_id, label: family, vec: l2normalize(vec) });
  }
  return { sourceRows, seeds, durations, artists, probeRows };
}

export function parseInferencePopulation(state: ArchiveState): ParsedInferencePopulation {
  const rows = state.genreSeeds();
  const seeds: GenreSeed[] = rows.seeds.map((row) => ({
    videoId: row.video_id,
    genre: row.genre!,
    vec: parseEmbeddingVector(row.vec_json, `genre seed ${row.video_id}`),
  }));
  const queries = rows.queries.map((row) => {
    const sectionVecs: number[][] = [];
    for (const svj of row.section_vecs) {
      try {
        sectionVecs.push(parseEmbeddingVector(svj, `section ${row.video_id}`));
      } catch {
        // skip corrupt section embedding
      }
    }
    return {
      videoId: row.video_id,
      title: row.title,
      vec: parseEmbeddingVector(row.vec_json, `genre query ${row.video_id}`),
      sectionVecs,
    };
  });
  return { seeds, queries, queryCount: rows.queries.length };
}
