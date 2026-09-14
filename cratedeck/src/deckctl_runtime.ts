import { apiGet } from "./deckapi";
import { createDeckctlOutput } from "./deckctl_output";

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
