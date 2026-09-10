// cli_job_leg.ts — the ONE "spawn megadj's CLI + drain both streams +
// split the trailing summary object" job leg. fixes_jobs.ts (booth-fix)
// and hygiene_jobs.ts (shelf-hygiene) were byte-identical twins of this
// runner until jscpd flagged them; both now delegate here with their
// command line + summary-reading differences as parameters. megadj's CLI
// stays the engine SSOT — cratedeck never re-implements its checks.
import { megadjCliPath, splitIntakeStdout } from "./intake_run";

/** Minimal structural view of what the legs need from the JobEngine —
 *  keeps this module decoupled from the class (the seam rule). */
export interface CliJobDeps {
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

/** Extra argv after the subcommand (e.g. --apply --yes, --shelf V). */
export interface CliJobSpec {
  /** CLI subcommand, e.g. "booth-fix" or "shelf-hygiene". */
  command: string;
  /** Name used in error messages, e.g. "megadj booth-fix --apply". */
  label: string;
  argv: string[];
  /** Extra env for the child (booth-fix rides MEGADJ_MUSIC_DIR). */
  env?: Record<string, string>;
}

/** Shared runner: spawn, drain stdout (logged) + stderr, exit-check
 *  against the label, split off the trailing JSON summary. */
export async function runCliJob(
  deps: CliJobDeps,
  spec: CliJobSpec,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(
    ["bun", megadjCliPath(deps.cfg.root), spec.command, ...spec.argv],
    {
      stdout: "pipe",
      stderr: "pipe",
      cwd: deps.cfg.root,
      env: spec.env ? { ...process.env, ...spec.env } : { ...process.env },
    },
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
      `${spec.label}${apply ? " --apply" : ""} exited ${proc.exitCode}${
        errRes.trim() ? `: ${errRes.trim().slice(-400)}` : ""
      }`,
    );
  const { summary } = splitIntakeStdout(res.out);
  return summary ?? {};
}
