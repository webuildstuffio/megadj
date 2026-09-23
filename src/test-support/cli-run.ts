/**
 * cli-run.ts — run the real `megadj` CLI end-to-end in a throwaway
 * environment (issue #146 builder 3).
 *
 * Replaces the runCli/runDrop `run()` re-rolls in:
 *  - src/json-summary.test.ts
 *  - src/numeric-options.test.ts
 *  - src/shared/drop.test.ts
 *  - src/shared/maintenance-flags.test.ts
 *  - src/fulltags/analysis/gold-report.test.ts
 *  - src/getdat/commands/upgrade.test.ts
 *
 * Every variant captured argv, a MEGADJ_DB/MEGADJ_MUSIC_DIR/MEGADJ_COOKIES
 * env triple, and decoded stdout/stderr slightly differently — and the
 * byte-identical spawn line was jscpd's most-repeated non-fixture clone.
 * `process.execPath` (not the `bun` PATH name — shell shims choke on
 * empty-string args) runs the repo's src/cli.ts.
 */
import { $ } from "bun";
import { join } from "node:path";

export interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CliEnv {
  MEGADJ_DB: string;
  MEGADJ_MUSIC_DIR: string;
  MEGADJ_COOKIES: string;
  [key: string]: string;
}

/** The throwaway-env triple every CLI test needs. Give it a directory
 *  (typically a mkdtemp) and the CLI sees a private DB + music dir and
 *  never touches a real browser (MEGADJ_COOKIES=""). */
export function cliEnv(dir: string): CliEnv {
  return {
    MEGADJ_DB: join(dir, "archive.db"),
    MEGADJ_MUSIC_DIR: join(dir, "music"),
    MEGADJ_COOKIES: "",
  };
}

const CLI = join(import.meta.dir, "../cli.ts");

/** Run `megadj <args...>` with extra env; never throws on non-zero exit. */
export async function runCli(
  args: string[],
  env: Record<string, string> = {},
  preCommand: string[] = [],
): Promise<CliRun> {
  const proc = await $`${process.execPath} run ${CLI} ${preCommand} ${args}`
    .env({ ...process.env, ...env })
    .quiet()
    .nothrow();
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

/** The last stdout line parsed as JSON — the P1 one-summary-object read. */
export function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1] ?? "") as Record<string, unknown>;
}
