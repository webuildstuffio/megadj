/** Shared runtime primitives for JobEngine and its extracted execution legs. */

export interface RunHandle {
  proc?: Bun.Subprocess;
  cancelled: boolean;
  jobId?: string;
  resolve?: () => void;
}

export type JobTick = (
  done: number,
  total: number,
  message: string,
  phase: string,
  force?: boolean,
) => void;

export type JobLog = (line: string, isError?: boolean) => void;

/** Rolling ETA estimator over the most recent complete sample window. */
export function createEtaEstimator(): (
  done: number,
  total: number,
  now: number,
) => number | null {
  let lastCount = 0;
  let lastTime = -1;
  let etaS: number | null = null;
  return (done, total, now) => {
    if (lastTime < 0) {
      lastCount = done;
      lastTime = now;
      return null;
    }
    if (now - lastTime >= 1_000) {
      const rate = (done - lastCount) / ((now - lastTime) / 1000);
      etaS = rate > 0 ? Math.max(0, Math.round((total - done) / rate)) : null;
      lastCount = done;
      lastTime = now;
    }
    return etaS;
  };
}

/** Apply one wall-clock budget to the entire job, independent of leg kind. */
export async function withJobBudget<T>(
  work: Promise<T>,
  handle: RunHandle,
  timeoutMin: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      handle.cancelled = true;
      handle.proc?.kill();
      reject(
        new Error(
          `job exceeded its ${timeoutMin} min wall-clock budget — cancelled`,
        ),
      );
    }, timeoutMin * 60_000);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read a subprocess stream line-by-line while capturing every byte once. */
export async function drain(
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
  onLine: (line: string) => void,
  handle?: RunHandle,
  timeoutMs = 0,
): Promise<{ out: string }> {
  const stream =
    proc && typeof proc === "object" && "stdout" in proc
      ? proc.stdout
      : (proc as ReadableStream<Uint8Array> | number | undefined);
  return drainStream(stream, onLine, handle, timeoutMs, proc);
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | number | undefined,
  onLine: (line: string) => void,
  handle: RunHandle | undefined,
  timeoutMs: number,
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
): Promise<{ out: string }> {
  let out = "";
  if (!stream || typeof stream === "number") {
    if (proc && typeof proc === "object" && "exited" in proc) await proc.exited;
    return { out };
  }
  const reader = stream.getReader();
  const timer = timeoutMs
    ? setTimeout(() => {
        if (handle) handle.cancelled = true;
        if (proc && typeof proc === "object" && "kill" in proc) proc.kill();
      }, timeoutMs)
    : null;
  try {
    const decoder = new TextDecoder();
    let carry = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const lines = (carry + text).split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
      out += text;
      if (handle?.cancelled) {
        if (proc && typeof proc === "object" && "kill" in proc) proc.kill();
        break;
      }
    }
    out += decoder.decode();
    if (carry.trim()) onLine(carry);
  } finally {
    if (timer) clearTimeout(timer);
    if (proc && typeof proc === "object" && "exited" in proc) await proc.exited;
  }
  return { out };
}

/** Collect a subprocess stream (for example stderr) as text. */
export async function drainText(
  stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  try {
    return await new Response(stream).text();
  } catch {
    return "";
  }
}

/** Map usb_verify.py section lines to absolute progress. */
export function verifyPhase(
  line: string,
  phaseIdx: number,
): { progress: number; message: string; nextIdx: number } | null {
  const phases: [RegExp, number, string][] = [
    [/^### /, 0.15, "checking hardware DB view (export.pdb)…"],
    [/^  tracks:/, 0.35, "checking every track: files, grids, BPM…"],
    [/^  playlists:/, 0.8, "checking playlists + relations…"],
    [/=== cross-drive ===/, 0.85, "comparing master ↔ mirror…"],
    [/^  hashed \d+\//, 0.9, "hashing ANLZ files on both drives…"],
    [/audio hash spot-check/, 0.95, "spot-hashing audio files…"],
    [/^FINAL:/, 0.99, "writing verdict…"],
  ];
  for (let i = phaseIdx; i < phases.length; i++) {
    const [pattern, progress, message] = phases[i]!;
    if (pattern.test(line)) {
      return { progress, message, nextIdx: i + 1 };
    }
  }
  return null;
}
