/**
 * Shared NDJSON line reader for Bun.spawn subprocesses with piped stdout
 * (the mood and key analyzers). Both callers used to hand-roll the same
 * buffered decoder loop — one deterministic implementation here: each
 * iteration consumes a buffered line or awaits exactly one read(), so
 * there is no polling race between a pump task and the caller.
 */
export interface LineReader {
  /** Resolve the next complete line, or null on timeout/EOF. */
  next(timeoutMs: number): Promise<string | null>;
  /** True once the stream reported EOF. */
  done(): boolean;
}

export function lineReader(stdout: ReadableStream): LineReader {
  const reader = stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const dec = new TextDecoder();
  let buf = "";
  let eof = false;
  return {
    async next(timeoutMs: number): Promise<string | null> {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          return line;
        }
        const { done, value } = await reader.read();
        if (done) {
          eof = true;
          return null;
        }
        buf += dec.decode(value, { stream: true });
      }
      return null;
    },
    done: () => eof,
  };
}
