/**
 * Shared NDJSON line reader for Bun.spawn subprocesses with piped stdout
 * (the mood and key analyzers, and the #189 worker-session kit). Both
 * callers used to hand-roll the same buffered decoder loop — one
 * deterministic implementation here.
 *
 * Deadline semantics (root-caused Sep 16, #180 family): a bare
 * `await reader.read()` suspends until data OR EOF arrives, so a timeout
 * checked between reads never fired while a read was pending — a silent
 * worker hung the caller forever, violating the "null on timeout"
 * contract. `next()` now races the read against the remaining budget and
 * RETURNS NULL AT THE DEADLINE even with a read still pending. The
 * pending read is kept as `inflight` and reused by the next call (a
 * ReadableStream reader allows exactly one read at a time), so a chunk
 * that arrives late is decoded on the next call — nothing is lost and
 * the reader is never double-read.
 */
export interface LineReader {
  /** Resolve the next complete line, or null on timeout/EOF. */
  next: (timeoutMs: number) => Promise<string | null>;
  /** True once the stream reported EOF. */
  done: () => boolean;
}

export function lineReader(stdout: ReadableStream): LineReader {
  const reader = stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const dec = new TextDecoder();
  let buf = "";
  let eof = false;
  // The single allowed in-progress read. A deadline that fires while this
  // is pending leaves it here; the next next() call consumes it instead
  // of issuing a second overlapping read.
  let inflight: ReturnType<typeof reader.read> | null = null;

  return {
    async next(timeoutMs: number): Promise<string | null> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          return line;
        }
        // Snapshot (non-null via ??) — TS cannot keep narrowing of the
        // captured `let` across the loop + awaited race below.
        const pending = inflight ?? reader.read();
        inflight = pending;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const winner = await Promise.race([
          pending.then((r) => ({ kind: "read", r }) as const),
          new Promise<{ kind: "timeout" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "timeout" }), remaining);
          }),
        ]);
        clearTimeout(timer);
        if (winner.kind === "timeout") return null;
        inflight = null;
        if (winner.r.done) {
          eof = true;
          return null;
        }
        buf += dec.decode(winner.r.value, { stream: true });
      }
    },
    done: () => eof,
  };
}
