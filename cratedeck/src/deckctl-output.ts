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
  emitJson: (payload: unknown) => Promise<void>;
  flushStdout: () => Promise<void>;
  log: (message: string) => void;
  errOut: (message: string) => Promise<void>;
}

/** Flush via process.stdout.write("") — NEVER write(fd, ""). An empty
 *  Bun.write to a file-redirected stdout TRUNCATES everything already
 *  buffered (verified Bun 1.3.14: `deckctl help --json > f` produced a
 *  0-byte file); process.stdout's no-op write is the harmless drain.
 *  Same contract as src/shared/cli-output.ts drainStdout (megadj side).
 *  Module-level so oxlint's consistent-function-scoping is honest: the
 *  drain touches only process.stdout, by design. */
const flushStdout = (): Promise<void> =>
  new Promise((resolve) => {
    process.stdout.write("", () => resolve());
  });

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
