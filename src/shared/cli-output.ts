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
