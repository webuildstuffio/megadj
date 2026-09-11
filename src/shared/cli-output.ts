/** Reliable machine-readable CLI output. Library tests replace console.log to
 * capture reports; preserve that injected sink while real CLI exits use the
 * awaited stream write. */
const nativeConsoleLog = console.log;
export async function writeJson(payload: unknown): Promise<void> {
  if (console.log !== nativeConsoleLog) {
    console.log(JSON.stringify(payload));
    return;
  }
  await Bun.write(Bun.stdout, `${JSON.stringify(payload)}\n`);
}

export async function writeJsonText(payload: string): Promise<void> {
  await Bun.write(Bun.stdout, `${payload}\n`);
}

/** Flush pending stdout writes before process exit. */
export async function drainStdout(): Promise<void> {
  await Bun.write(Bun.stdout, "");
}
