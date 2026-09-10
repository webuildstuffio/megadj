// fixes_jobs.ts — the fixes-scan / fixes-apply job legs. Same seam shape
// as hygiene_jobs.ts: spawn megadj's CLI (the engine SSOT — cratedeck
// never re-implements compat checks), drain both streams, split the
// trailing summary object off stdout. Scope: booth-fix runs against the
// shelf Contents when mountPoint is a shelf volume (MEGADJ_MUSIC_DIR).
import { megadjCliPath, splitIntakeStdout } from "./intake_run";

/** Minimal structural view of what the legs need from the JobEngine —
 *  keeps this module decoupled from the class (the seam rule). */
export interface FixesJobDeps {
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
  drain(
    stream: ReadableStream<Uint8Array>,
    onLine: (l: string) => void,
    handle: { cancelled: boolean; proc?: Bun.Subprocess },
    timeoutMs: number,
  ): Promise<{ out: string }>;
  drainText(stream: ReadableStream<Uint8Array> | undefined): Promise<string>;
}

/** Shared runner. apply=false is the dry-run (plan only); apply=true is
 *  booth-fix --apply --yes (the safe subset: renames + tag sanitization). */
async function runBoothFix(
  deps: FixesJobDeps,
  musicDir: string,
  apply: boolean,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  const tick = (m: string, phase: string): void =>
    deps.tick(0, 1, m, phase, true);
  tick(
    apply ? "applying safe fixes…" : "auditing booth compatibility…",
    apply ? "apply" : "scan",
  );
  const proc = Bun.spawn(
    [
      "bun",
      megadjCliPath(deps.cfg.root),
      "booth-fix",
      ...(apply ? ["--apply", "--yes"] : []),
      "--json",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      cwd: deps.cfg.root,
      env: { ...process.env, MEGADJ_MUSIC_DIR: musicDir },
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
      `megadj booth-fix${apply ? " --apply" : ""} exited ${proc.exitCode}${
        errRes.trim() ? `: ${errRes.trim().slice(-400)}` : ""
      }`,
    );
  const { summary } = splitIntakeStdout(res.out);
  const fixable = Number(summary?.fixable ?? 0);
  const applied = Number(summary?.applied ?? 0);
  tick(apply ? `applied ${applied} fix(es)` : `${fixable} fixable`, "done");
  return summary ?? {};
}

/** fixes-scan: dry-run booth-fix over the drive's Contents → plan rows. */
export function runFixesScan(
  deps: FixesJobDeps,
  musicDir: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runBoothFix(deps, musicDir, false, handle);
}

/** fixes-apply: executes the SAFE subset (renames + tag rewrites; the
 *  "none" action rows are proposals, never auto-executed). */
export function runFixesApply(
  deps: FixesJobDeps,
  musicDir: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
): Promise<Record<string, unknown>> {
  return runBoothFix(deps, musicDir, true, handle);
}
