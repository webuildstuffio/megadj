/** Reliable machine-readable CLI output. */
export async function writeJson(payload: unknown): Promise<void> {
  await Bun.write(Bun.stdout, `${JSON.stringify(payload)}\n`);
}

export async function writeJsonText(payload: string): Promise<void> {
  await Bun.write(Bun.stdout, `${payload}\n`);
}

/** Flush pending stdout writes before process exit. */
export async function drainStdout(): Promise<void> {
  await Bun.write(Bun.stdout, "");
}
