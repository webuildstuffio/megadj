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

/** Flush pending stdout writes before process exit. */
export async function drainStdout(): Promise<void> {
  await Bun.write(Bun.stdout, "");
}
