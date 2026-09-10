// hygiene_jobs.ts — the hygiene-scan / hygiene-apply job legs (§5 P2),
// extracted from jobs.ts (file-length guard — the file was already over
// the 800-line cap before hygiene). Same shape as the ingest leg: spawn
// megadj's CLI (the engine SSOT — cratedeck never re-implements checks),
// drain both streams (the human log lands on stderr in --json mode),
// split the trailing summary object off stdout.
import { megadjCliPath, splitIntakeStdout } from "./intake_run";

/** Minimal structural view of what the legs need from the JobEngine —
 *  keeps this module decoupled from the class (the seam rule). */
export interface HygieneJobDeps {
  cfg: { root: string };
  jobTimeoutMin: number;
  cancelled(): boolean;
  killProc(proc: Bun.Subprocess): void;
  log(line: string): void;
  tick(
    done: number,
    total: number,
    message: string,
    phase: string,
    force?: boolean,
  ): void;
  /** drain() re-exported from jobs.ts — injected to avoid an import cycle */
  drain(
    stream: ReadableStream<Uint8Array>,
    onLine: (l: string) => void,
    handle: { cancelled: boolean; proc?: Bun.Subprocess },
    timeoutMs: number,
  ): Promise<{ out: string }>;
  drainText(stream: ReadableStream<Uint8Array> | undefined): Promise<string>;
}

/** Shared runner for both legs. Returns the CLI's trailing JSON summary. */
async function runShelfHygiene(
  deps: HygieneJobDeps,
  shelfVolume: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  tick(
    apply ? "applying confirmed findings…" : "walking the shelf…",
    apply ? "apply" : "walk",
  );
  const proc = Bun.spawn(
    [
      "bun",
      megadjCliPath(deps.cfg.root),
      "shelf-hygiene",
      ...(apply ? ["--apply", "--yes"] : []),
      "--json",
      "--shelf",
      shelfVolume,
    ],
    { stdout: "pipe", stderr: "pipe", cwd: deps.cfg.root },
  );
  handle.proc = proc;
  const [res, errRes] = await Promise.all([
    deps.drain(
      proc.stdout,
      (l) => deps.log(l),
      handle,
      deps.jobTimeoutMin * 60_000,
    ),
    deps.drainText(proc.stderr),
  ]);
  await proc.exited;
  if (handle.cancelled || deps.cancelled()) throw new Error("cancelled");
  if (proc.exitCode !== 0)
    throw new Error(
      `megadj shelf-hygiene${apply ? " --apply" : ""} exited ${proc.exitCode}${
        errRes.trim() ? `: ${errRes.trim().slice(-400)}` : ""
      }`,
    );
  const { summary } = splitIntakeStdout(res.out);
  const detected = Number(summary?.detected ?? 0);
  const applied = Number(summary?.applied ?? 0);
  const failed = Number(summary?.failed ?? 0);
  tick(
    apply ? `applied ${applied}, failed ${failed}` : `${detected} findings`,
    "done",
  );
  return summary ?? {};
}

/** hygiene-scan: detect + upsert findings; census → result_json. */
export function runHygieneScan(
  deps: HygieneJobDeps,
  shelfVolume: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runShelfHygiene(deps, shelfVolume, false, handle);
}

/** hygiene-apply: executes CONFIRMED findings only (the confirm step IS
 *  the human gate). Quarantine-only, never deletes; receipts land on rows. */
export function runHygieneApply(
  deps: HygieneJobDeps,
  shelfVolume: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runShelfHygiene(deps, shelfVolume, true, handle);
}
