import { fetchFeedPush, fetchFeedReset } from "../tools/fetch-feed";
import {
  fetchArgs,
  finiteOf,
  isRecord,
  parseFetchJobMount,
  parseFetchStart,
  parseFetchTask,
  safeJsonParse,
} from "./job-legs-fetch-protocol";
import { megadjCliPath, splitIntakeStdout } from "./intake-run";
import { drain, type JobLog, type JobTick } from "./job-runtime";
import type { LegArgs } from "./job-legs-types";
import { awaitLegExit } from "./job-legs-shared";

interface FetchProgress {
  tasksTotal: number;
  lastDone: number;
}

function recordFetchStart(
  payload: unknown,
  progress: FetchProgress,
  log: JobLog,
): void {
  const start = parseFetchStart(payload);
  if (!start) return;
  progress.tasksTotal = start.tasks;
  fetchFeedPush({ at: Date.now(), type: "start", start });
  log(
    `ladder: ${start.tasks} tasks (${start.total} tracks)${start.dry ? " DRY" : ""}`,
  );
}

function recordFetchTask(
  payload: unknown,
  progress: FetchProgress,
  tick: JobTick,
): void {
  const task = parseFetchTask(payload);
  if (!task) return;
  fetchFeedPush({ at: Date.now(), type: "task", task });
  if (progress.tasksTotal <= 0) return;
  progress.lastDone = Math.max(progress.lastDone, task.done);
  tick(
    progress.lastDone,
    progress.tasksTotal,
    `${task.done}/${progress.tasksTotal} — ${task.name}`,
    "enrich",
  );
}

function recordFetchDone(payload: unknown): void {
  if (!isRecord(payload) || !isRecord(payload.stats)) return;
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload.stats)) {
    const number = finiteOf(value);
    if (number !== null) stats[key] = number;
  }
  fetchFeedPush({ at: Date.now(), type: "done", stats });
}

function fetchEventHandler(
  progress: FetchProgress,
  tick: JobTick,
  log: JobLog,
): (line: string) => void {
  return (line) => {
    log(line);
    const text = line.trim();
    if (!text.startsWith("@")) return;
    const separator = text.indexOf(" ");
    if (separator === -1) return;
    const tag = text.slice(0, separator);
    const payload = safeJsonParse(text.slice(separator + 1));
    if (tag === "@fetch-start") recordFetchStart(payload, progress, log);
    else if (tag === "@task-done") recordFetchTask(payload, progress, tick);
    else if (tag === "@fetch-done") recordFetchDone(payload);
  };
}

/** Run megadj fetch and stream its vote-ladder events into the web feed. */
export async function runFetchJob({
  deps,
  mountPoint,
  handle,
  tick,
  log,
}: LegArgs): Promise<unknown> {
  const opts = parseFetchJobMount(mountPoint);
  tick(0, 1, "starting the fetch pipeline…", "probe", true);
  fetchFeedReset();
  const proc = Bun.spawn(
    ["bun", megadjCliPath(deps.cfg.root), ...fetchArgs(opts)],
    { stdout: "pipe", stderr: "pipe", cwd: deps.cfg.root },
  );
  handle.proc = proc;
  const progress: FetchProgress = { tasksTotal: 0, lastDone: 0 };
  const [result, errResult] = await Promise.all([
    drain(proc, (line) => log(line), handle, deps.cfg.jobTimeoutMin * 60_000),
    drain(proc.stderr, fetchEventHandler(progress, tick, log), handle),
  ]);
  await awaitLegExit(proc, handle, "megadj fetch", errResult.out);
  const { summary } = splitIntakeStdout(result.out);
  tick(1, 1, "fetch finished", "done", true);
  deps.db.event("local-archive", "fetch", {
    votes:
      summary && typeof summary.votesCast === "number"
        ? summary.votesCast
        : null,
    elected:
      summary && typeof summary.genreElected === "number"
        ? summary.genreElected
        : null,
  });
  return summary ?? { feed: "summary unparsable — see the feed" };
}
