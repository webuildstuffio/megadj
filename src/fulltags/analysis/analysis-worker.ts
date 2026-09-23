/**
 * analysis-worker.ts — THE persistent-python-worker session kit (#189).
 *
 * beats-analysis.ts and key-analysis.ts independently converged on the
 * same shape: spawn a uv-managed python worker, handshake on a
 * `{"type":"ready"}` NDJSON line, send `{"id",...}` requests, match
 * responses by id, and kill the worker on timeout (a late response must
 * never be misattributed to the next request). The kit here is that
 * shape written ONCE — `readUntilLine` lives in exactly this file; the
 * analyzers become thin adapters over their python invokers.
 *
 * Session semantics (both call sites, pinned):
 *  - Single-flight: one request in flight per session.
 *  - Timeout/EOF desync kills the session (dead session → null, never a
 *    throw) so a late response can't poison the next request.
 *  - close() is idempotent and safe after natural stdin-EOF exit.
 *  - Handshake failure (env missing / slow load) returns null — callers
 *    keep their degrade-to-null contract.
 */
import { lineReader } from "../utils/stdio";
import { parseJsonObject } from "../utils/parse-json";

/** Resolve the next stdout line matching `pred`, or null on timeout/EOF.
 * Deterministic: consumes a buffered line or awaits exactly one read(). */
export async function readUntilLine(
  lr: ReturnType<typeof lineReader>,
  pred: (line: string) => boolean,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const line = await lr.next(remaining);
    if (line === null) return null;
    if (pred(line)) return line;
  }
}

/** The analyzer's response for one request (already parsed by the
 *  adapter's `parse` hook). */
export interface WorkerSession<Req, Res> {
  /** Analyze one unit of work. Null when the session is dead (a timed-out
   *  request kills it) or the adapter rejected the response. */
  analyze: (req: Req) => Promise<Res | null>;
  /** Kill the worker. Idempotent; also safe after natural EOF exit. */
  close: () => void;
}

/** Spawn options. `spawn` builds the process; the adapters own the
 *  python invocation (uv args, worker script / server path) and the
 *  wire parsing; the kit owns the lifecycle only. */
export interface WorkerSpec<Req, Res> {
  /** Spawn the worker process (pipes; stderr ignored). */
  spawn: () => Bun.Subprocess;
  /** Readiness predicate over NDJSON lines (`{"type":"ready"}`). */
  isReady: (line: string) => boolean;
  /** Deadline for the ready handshake. */
  readyTimeoutMs: number;
  /** Serialize one request onto stdin (id included by the caller). */
  encodeRequest: (req: Req, enc: TextEncoder, proc: Bun.Subprocess) => void;
  /** True when this NDJSON line is a response worth parsing. */
  isResponse: (line: string) => boolean;
  /** Parse a response line into the result — null = adapter-level
   *  failure (schema mismatch, error field, unknown id). */
  parse: (line: string, req: Req) => Res | null;
  /** Deadline per request. */
  responseTimeoutMs: number;
}

/** Kill helper: process exit can race cleanup; there is no recovery. */
function tryKill(proc: Bun.Subprocess): void {
  try {
    proc.kill();
  } catch (error) {
    void error;
  }
}

/** Open a persistent worker session (handshake included). Null when the
 *  worker never became ready inside `readyTimeoutMs`. */
export async function openWorkerSession<Req, Res>(
  spec: WorkerSpec<Req, Res>,
): Promise<WorkerSession<Req, Res> | null> {
  const proc = spec.spawn();
  const lr = lineReader(proc.stdout as ReadableStream);
  const enc = new TextEncoder();
  const readyLine = await readUntilLine(lr, spec.isReady, spec.readyTimeoutMs);
  let alive = readyLine !== null;
  if (!alive) {
    tryKill(proc);
    return null;
  }
  const kill = (): void => {
    if (!alive) return;
    alive = false;
    tryKill(proc);
  };
  return {
    async analyze(req: Req): Promise<Res | null> {
      if (!alive) return null;
      spec.encodeRequest(req, enc, proc);
      const line = await readUntilLine(
        lr,
        spec.isResponse,
        spec.responseTimeoutMs,
      );
      if (line === null) {
        // Timeout/EOF desyncs the protocol — kill so a late response can
        // never be misattributed to the next request.
        kill();
        return null;
      }
      return spec.parse(line, req);
    },
    close: kill,
  };
}

/** Shared readiness predicate: an NDJSON line announcing
 *  `{"type":"ready"}` (guarded parse — noise lines never throw). */
export function lineIsReady(line: string): boolean {
  return parseJsonObject(line)?.type === "ready";
}

/** Shared request writer: one NDJSON line onto the worker's stdin. */
export function writeNdjsonRequest(
  proc: Bun.Subprocess,
  enc: TextEncoder,
  payload: Record<string, unknown>,
): void {
  const sink = proc.stdin;
  if (!sink || typeof sink === "number") return;
  sink.write(enc.encode(`${JSON.stringify(payload)}\n`));
}

/** Shared response-id predicate: the line parses as JSON and carries a
 *  non-empty string id (guarded parse — noise lines never throw). */
export function lineHasRequestId(line: string): boolean {
  const v = parseJsonObject(line);
  return typeof v?.id === "string" && v.id.length > 0;
}
