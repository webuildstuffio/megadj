import { inferGenre } from "../../core/similar";
import { writeJson } from "../../shared/cli-output";
import type { GenreOptions } from "./genre-run-types";
import { parseInferencePopulation } from "./genre-run-population";

type CommandLog = (message: string) => void;

interface GenreProposal {
  video_id: string;
  title: string | null;
  genre: string;
  agreement: number;
  usedSection: boolean;
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
  let sectionWins = 0;
  const proposals: GenreProposal[] = [];
  for (const query of queries) {
    // Best-of-3 strategy (bench-validated Sep 30): try whole-track + all
    // section embeddings, pick the one with highest agreement.
    const allVecs = [query.vec, ...query.sectionVecs];
    let bestVote = inferGenre(seeds, query.vec, k, minAgreement);
    let bestVecIdx = 0;
    for (let vi = 1; vi < allVecs.length; vi++) {
      const vote = inferGenre(seeds, allVecs[vi]!, k, minAgreement);
      if (vote.agreement > bestVote.agreement) {
        bestVote = vote;
        bestVecIdx = vi;
      }
    }
    const usedSection = bestVecIdx > 0;
    if (usedSection) sectionWins++;

    if (bestVote.inferred === null) {
      split++;
      continue;
    }
    inferred++;
    if (opts.apply) opts.state.updateGenre(query.videoId, bestVote.inferred);
    proposals.push({
      video_id: query.videoId,
      title: query.title,
      genre: bestVote.inferred,
      agreement: bestVote.agreement,
      usedSection,
    });
  }

  const sectionPct =
    queryCount > 0 ? ((sectionWins / queryCount) * 100).toFixed(0) : "0";
  log(
    `genre: ${inferred} inferred, ${split} split-vote (left untouched), from ${seeds.length} seeds — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  log(
    `  section-aware: ${sectionWins}/${queryCount} queries used a section embedding (${sectionPct}%)`,
  );
  for (const proposal of proposals.slice(0, 20))
    log(
      `  ${proposal.genre.padEnd(8)} ${(proposal.agreement * 100).toFixed(0)}%${proposal.usedSection ? " §" : "  "}  ${proposal.title ?? proposal.video_id}`,
    );

  await writeJson({
    command: "genre",
    mode: "infer",
    seeds: seeds.length,
    queries: queryCount,
    inferred,
    split,
    sectionWins,
    applied: opts.apply === true,
    proposals: proposals.slice(0, 40),
  });
  if (inferred === 0 && split === 0)
    log(
      "genre: nothing to infer — run `megadj mood --embeddings` to build the embedding ledger first",
    );
}
