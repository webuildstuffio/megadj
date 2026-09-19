/** Reliable machine-readable CLI output. Test callers may replace console.log
 * to capture reports; real CLI exits use the awaited stdout stream. */
const nativeConsoleLog = console.log;
export async function writeJson(payload: unknown): Promise<void> {
  const serialized = JSON.stringify(payload);
  if (console.log !== nativeConsoleLog) {
    console.log(serialized);
    return;
  }
  await Bun.write(Bun.stdout, `${serialized}\n`);
}

export async function writeJsonText(payload: string): Promise<void> {
  await Bun.write(Bun.stdout, `${payload}\n`);
}

/** Flush pending stdout writes before process exit. MUST NOT be
 *  Bun.write(Bun.stdout, "") — an empty Bun.write to a piped/file stdout
 *  TRUNCATES it (verified Bun 1.3.14: `write(fd,"")` discards everything
 *  already buffered, which silently deleted --json output for every piped
 *  run). process.stdout.write("") with a callback is the harmless flush. */
export function drainStdout(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write("", () => resolve());
  });
}

/** The command failure epilogue (issue #160): emit the error in the right
 * channel, set the exit code — ONE home for the three-part contract
 * ("--json: one summary object on stdout, meaningful exit code").
 * `json` mode writes `{ command, error }` to stdout; human mode logs via
 * commandLog-style stderr-safe console.error. Exit code defaults to 1. */
export async function finishCommandError(opts: {
  command: string;
  json?: boolean;
  error: string;
  exitCode?: number;
}): Promise<void> {
  if (opts.json) {
    await writeJson({ command: opts.command, error: opts.error });
  } else {
    console.error(`${opts.command}: ${opts.error}`);
  }
  await drainStdout();
  process.exitCode = opts.exitCode ?? 1;
}

/** Synchronous twin of finishCommandError for sync closures (e.g. an
 * inline numeric-option validator). Same channel/exit contract. */
export function finishCommandErrorSync(opts: {
  command: string;
  json?: boolean;
  error: string;
  exitCode?: number;
}): void {
  if (opts.json) {
    void writeJson({ command: opts.command, error: opts.error });
  } else {
    console.error(`${opts.command}: ${opts.error}`);
  }
  process.exitCode = opts.exitCode ?? 1;
}

/** Set the process exit code for the current command run — the one
 * mutation point (issue #160 ring 2). Exit codes: 0 success · 1 command
 * reported failure · 2 bad usage/numeric input (zero work). */
export function setExit(code: number): void {
  process.exitCode = code;
}
/** The common `--json` flag read shared by command arms. #235: rehomed
 *  from maintenance-cmds — output-channel concerns belong beside the
 *  output seams. */
export function jsonFlag(flags: { bools: Set<string> }): boolean {
  return flags.bools.has("json");
}

/** Option-object fragment: `json` + the matching quiet progress log.
 *  Pairs with emitResult so an arm's json/quiet plumbing is one spread. */
export function jsonOpts(json: boolean): {
  json: boolean;
  log: (message: string) => void;
} {
  return { json, log: progressLog(json) };
}

/** Keep progress messages off stdout when --json owns that channel. */
export function progressLog(json: boolean): (message: string) => void {
  return (message) => {
    if (!json) console.log(message);
  };
}

/** Emit a command result (the #88 shared seam): `--json` writes exactly
 *  one stdout object through the awaited `writeJson` seam; otherwise
 *  render the human report. The old 10× hand-written if/else was where
 *  report/json parity drifted. #235: rehomed from maintenance-cmds. */
export async function emitResult<T>(
  json: boolean,
  result: T,
  printReport: (result: T, log: (message: string) => void) => void,
): Promise<void> {
  if (json) await writeJson(result);
  else printReport(result, console.log);
}
