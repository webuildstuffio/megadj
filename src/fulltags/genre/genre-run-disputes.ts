import { finishCommandError, writeJson } from "../../shared/cli-output";
import { collectDisputes, resolveDispute } from "./genre-disputes";
import type { GenreOptions } from "./genre-run-types";

type CommandLog = (message: string) => void;
type ResolutionVerb = "agree" | "keep";

function disputesRequested(opts: GenreOptions): boolean {
  return (
    opts.disputes === true ||
    opts.note !== undefined ||
    opts.agree !== undefined ||
    opts.keep !== undefined
  );
}

async function reportUsageError(opts: GenreOptions): Promise<boolean> {
  const resolutionCount =
    (opts.agree !== undefined ? 1 : 0) + (opts.keep !== undefined ? 1 : 0);
  const error =
    resolutionCount > 1
      ? "--agree and --keep resolve one row each — pass one, not both"
      : opts.note !== undefined && resolutionCount === 0
        ? "--note rides with --agree or --keep — nothing to note on its own"
        : undefined;
  if (error === undefined) return false;
  await finishCommandError({
    command: "genre",
    json: opts.json === true,
    error,
    exitCode: 2,
  });
  return true;
}

async function resolveRequestedDispute(
  opts: GenreOptions,
  log: CommandLog,
): Promise<boolean> {
  if (opts.agree === undefined && opts.keep === undefined) return false;
  const verb: ResolutionVerb = opts.agree !== undefined ? "agree" : "keep";
  const videoId = (opts.agree ?? opts.keep)!;
  const result = resolveDispute(opts.state, { videoId, verb, note: opts.note });
  if (!result.ok) {
    await finishCommandError({
      command: "genre",
      json: opts.json === true,
      error: result.message,
      exitCode: 1,
    });
    return true;
  }
  log(result.message);
  await writeJson({
    command: "genre",
    mode: "dispute-resolve",
    video_id: videoId,
    verb,
    applied: true,
    message: result.message,
  });
  return true;
}

async function reviewDisputes(
  opts: GenreOptions,
  log: CommandLog,
  k: number,
): Promise<void> {
  const review = collectDisputes(opts.state, k);
  log(
    `genre disputes: ${review.flagged} flagged (${review.alreadyAgree} already agree with live consensus — --keep resolves those)`,
  );
  for (const row of review.rows.slice(0, 30)) {
    const evidence = row.consensus
      ? `consensus ${row.consensus} @ ${Math.round((row.agreement ?? 0) * 100)}% · embed ${row.embedAgeDays ?? "?"}d`
      : "no live consensus (re-run --flag)";
    log(`  ${row.videoId}  "${row.genre}"  — ${evidence}`);
    log(`    ${row.artist ?? "?"} — ${row.title ?? "?"}`);
  }
  await writeJson({
    command: "genre",
    mode: "disputes",
    flagged: review.flagged,
    alreadyAgree: review.alreadyAgree,
    rows: review.rows,
  });
}

export async function runGenreDisputes(
  opts: GenreOptions,
  log: CommandLog,
  k: number,
): Promise<boolean> {
  if (!disputesRequested(opts)) return false;
  if (await reportUsageError(opts)) return true;
  if (await resolveRequestedDispute(opts, log)) return true;
  await reviewDisputes(opts, log, k);
  return true;
}
