import { inferGenre } from "../../archive/similar";
import { writeJson } from "../../shared/cli-output";
import type { GenreOptions } from "./genre-run-types";
import { parseInferencePopulation } from "./genre-run-population";

type CommandLog = (message: string) => void;

interface GenreProposal {
  video_id: string;
  title: string | null;
  genre: string;
  agreement: number;
}

export async function runGenreInference(
  opts: GenreOptions,
  log: CommandLog,
  k: number,
  minAgreement: number,
): Promise<void> {
  const { seeds, queries, queryCount } = parseInferencePopulation(opts.state);
  let inferred = 0;
  let split = 0;
  const proposals: GenreProposal[] = [];
  for (const query of queries) {
    const vote = inferGenre(seeds, query.vec, k, minAgreement);
    if (vote.inferred === null) {
      split++;
      continue;
    }
    inferred++;
    if (opts.apply) opts.state.updateGenre(query.videoId, vote.inferred);
    proposals.push({
      video_id: query.videoId,
      title: query.title,
      genre: vote.inferred,
      agreement: vote.agreement,
    });
  }

  log(
    `genre: ${inferred} inferred, ${split} split-vote (left untouched), from ${seeds.length} seeds — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  for (const proposal of proposals.slice(0, 20))
    log(
      `  ${proposal.genre.padEnd(8)} ${(proposal.agreement * 100).toFixed(0)}%  ${proposal.title ?? proposal.video_id}`,
    );

  await writeJson({
    command: "genre",
    mode: "infer",
    seeds: seeds.length,
    queries: queryCount,
    inferred,
    split,
    applied: opts.apply === true,
    proposals: proposals.slice(0, 40),
  });
  if (inferred === 0 && split === 0)
    log(
      "genre: nothing to infer — run `megadj mood --embeddings` to build the embedding ledger first",
    );
}
