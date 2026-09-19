// deckctl_runtime.ts — the deckctl client runtime seam: JSON/tty mode,
// the awaited output boundary, the typed-JSON GET helper, and the hook
// bundle the verb arms share (#221: deckctl_prep.ts, 15L, merged into
// this file — its single cmdPrep rides the same runtime imports).
import { apiGet } from "./deckapi";
import { createDeckctlOutput } from "./deckctl-output";

export const JSON_MODE = process.argv.includes("--json");
export const IS_TTY = process.stderr.isTTY ?? false;

export const { emitJson, flushStdout, log, errOut } = createDeckctlOutput({
  jsonMode: JSON_MODE,
});

export async function getJson<T>(path: string, timeoutMs?: number): Promise<T> {
  const response = await apiGet(path, timeoutMs);
  return (await response.json()) as T;
}

export function baseHooks() {
  return {
    jsonMode: JSON_MODE,
    log,
    errOut,
    argv: process.argv,
    exit: process.exit,
  };
}

/** `deckctl prep` — the weekly-prep digest, markdown to stdout or a file. */
export async function cmdPrep(outPath: string | undefined): Promise<void> {
  const { fetchWeeklyPrepInput, renderWeeklyPrep } =
    await import("./weekly-prep");
  const input = await fetchWeeklyPrepInput(getJson);
  const markdown = renderWeeklyPrep(input);
  if (outPath) await Bun.write(outPath, `${markdown}\n`);
  if (JSON_MODE) {
    await emitJson({ ...input, markdown, written: outPath });
    return;
  }
  log(markdown);
  if (outPath) log(`\nwritten: ${outPath}`);
}
