import { evalLeaveOneOut } from "../../core/similar";
import { writeJson } from "../../shared/cli-output";
import { classifyDisputes } from "./genre-flag";
import type { GenreOptions } from "./genre-run-types";
import { parseEvalPopulation } from "./genre-run-population";

type CommandLog = (message: string) => void;

/** Reassess every embedded label and optionally persist dispute flags. */
export async function runGenreFlag(
  opts: GenreOptions,
  log: CommandLog,
  k: number,
  minAgreement: number,
): Promise<boolean> {
  if (!opts.flag) return false;
  const { sourceRows, seeds, durations } = parseEvalPopulation(
    opts.state,
    "flag",
  );
  const result = classifyDisputes(
    evalLeaveOneOut(seeds, k, minAgreement, durations),
  );
  const disputeIds = new Set(result.rows.map((row) => row.videoId));
  if (opts.apply)
    for (const row of sourceRows)
      opts.state.setGenreFlag(
        row.video_id,
        disputeIds.has(row.video_id) ? "disputed" : null,
      );
  log(
    `genre flag: ${result.disputed} disputed of ${result.evaluated} assessed (${result.upheld} upheld by unanimous consensus, ${result.noQuorum} no quorum) — ${opts.apply ? "FLAGS WRITTEN (labels untouched)" : "proposals only (use --apply to write flags)"}`,
  );
  for (const row of result.rows.slice(0, 15))
    log(`  ${row.family} → consensus ${row.consensus}  (${row.videoId})`);
  await writeJson({
    command: "genre",
    mode: "flag",
    evaluated: result.evaluated,
    disputed: result.disputed,
    upheld: result.upheld,
    noQuorum: result.noQuorum,
    applied: opts.apply === true,
    samples: result.rows.slice(0, 40),
  });
  return true;
}
