// `megadj genre` dispatch facade. Each mode owns its population parsing,
// decisions, reporting, and writes in a dedicated genre-run-* leaf.
import { finishCommandError } from "../../shared/cli-output";
import { commandLog } from "../../shared/progress";
import type { GenreOptions } from "./genre-run-types";
import { runGenreDisputes } from "./genre-run-disputes";
import { runGenreEval } from "./genre-run-eval";
import { runGenreFlag } from "./genre-run-flag";
import { runGenreInference } from "./genre-run-infer";
import { runGenreRefold } from "./genre-run-refold";

export async function genre(opts: GenreOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 5;
  const minAgreement = opts.minAgreement ?? 0.6;

  if (await runGenreDisputes(opts, log, k)) return;
  if (opts.refold && opts.flag) {
    await finishCommandError({
      command: "genre",
      json: opts.json === true,
      error: "--refold and --flag are separate passes — run one at a time",
      exitCode: 2,
    });
    return;
  }
  if (opts.eval) {
    await runGenreEval(opts, log, k, minAgreement);
    return;
  }
  if (await runGenreRefold(opts, log)) return;
  if (await runGenreFlag(opts, log, k, minAgreement)) return;
  await runGenreInference(opts, log, k, minAgreement);
}
