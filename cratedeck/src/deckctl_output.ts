/**
 * Output boundary for deckctl. Keeping writes awaited here means every JSON
 * payload reaches a piped consumer before the CLI can exit, while the injected
 * sinks make that contract testable without replacing process-wide globals.
 */
export interface DeckctlOutputOptions {
  jsonMode: boolean;
  /** Async stdout writer; defaults to Bun's stdout stream. */
  write?: (text: string) => Promise<unknown>;
  /** Human stdout sink; suppressed in JSON mode. */
  logLine?: (line: string) => void;
  /** Human stderr sink. */
  errorLine?: (line: string) => void;
}

export interface DeckctlOutput {
  emitJson(payload: unknown): Promise<void>;
  flushStdout(): Promise<void>;
  log(message: string): void;
  errOut(message: string): Promise<void>;
}

export function createDeckctlOutput(
  options: DeckctlOutputOptions,
): DeckctlOutput {
  const write =
    options.write ??
    ((text: string): Promise<unknown> => Bun.write(Bun.stdout, text));
  const logLine = options.logLine ?? console.log;
  const errorLine = options.errorLine ?? console.error;
  const emitJson = async (payload: unknown): Promise<void> => {
    await write(`${JSON.stringify(payload, null, 2)}\n`);
  };
  const flushStdout = (): Promise<void> => write("").then(() => undefined);
  const log = (message: string): void => {
    if (!options.jsonMode) logLine(message);
  };
  const errOut = async (message: string): Promise<void> => {
    if (options.jsonMode) await emitJson({ error: message });
    else errorLine(message);
  };

  return {
    emitJson,
    flushStdout,
    log,
    errOut,
  };
}
