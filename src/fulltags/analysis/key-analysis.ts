/**
 * key-analysis.ts — the OpenKeyScan key probe (analysis stage 3 of 3).
 * Split from analysis.ts (#42 stage split); the surface is unchanged —
 * exports.ts re-exports `analyzeKeys`/`analyzeKey` from here.
 *
 * OFFLINE and file-first: reads the audio file itself, never the DB.
 * Idempotent-friendly: callers check the existing TXXX:CAMELOT/TKEY stamp
 * before spending compute.
 */
import { existsSync } from "node:fs";
import { parseJsonObject } from "../utils/parse-json";
import { lineReader } from "../utils/stdio";
import { readUntilLine } from "./analysis-worker";
import { keyscanDir } from "./fingerprint";

export interface KeyResult {
  /** Camelot notation, e.g. "9A" — what TXXX:CAMELOT carries. */
  camelot: string;
  /** Open Key notation, e.g. "2m" (Traktor-style). */
  openkey: string;
  /** Human-readable, e.g. "E min". */
  key: string;
}

/**
 * One-shot key analysis via the OpenKeyScan analyzer server protocol
 * (JSON over stdin/stdout; device auto-select CUDA > MPS > CPU).
 *
 * Spawns the server per batch — for library-wide runs prefer
 * `analyzeKeys(paths)` which amortizes the ~1.3 s model load. Null when
 * the analyzer repo is missing (clone to KEYSCAN_DIR) or inference fails.
 *
 * GAUNTLET (roadmap #3, required or RB erases the work):
 * 1. rekordbox Preferences → Analysis → disable Key analysis
 * 2. after batch writes: Reload Tags in RB
 * 3. ≥80% agreement on 20 known-key tracks before full-library run
 *    (run `fulltags verify-key` — the #185 gate verb).
 */
export async function analyzeKeys(
  paths: string[],
): Promise<Map<string, KeyResult>> {
  // Values are `KeyResult | null` WHILE the protocol loop runs: null marks
  // a definitive per-path error so the loop can terminate instead of
  // waiting for responses that will never come. Placeholders are dropped
  // before return — the wire type stays honest (Map<string, KeyResult>).
  const out = new Map<string, KeyResult | null>();
  const server = `${keyscanDir()}/openkeyscan_analyzer_server.py`;
  if (!existsSync(server) || !paths.length)
    return out as Map<string, KeyResult>;
  // COMPRESSED-CONTAINER DECODE lives INSIDE the server: its PyAV fast
  // path (load_audio_pyav_optimized — upstream's own macOS build path,
  // previously gated to win32) demuxes mp3/m4a/aac in-process, so no
  // temp WAVs are ever written beside the originals. Requests pass the
  // ORIGINAL paths; ids map 1:1. (The old ffmpeg-decode-then-map dance
  // here died Sep 15 2026 with the same fix in analyzeBeats.)
  try {
    const results = await runKeyServer(server, paths);
    for (const [k, v] of results) if (v === null) results.delete(k);
    return results as Map<string, KeyResult>;
  } finally {
    // Temp decode files are gone as a concept — nothing to clean up.
  }
}

/** Does this analyzer stdout line announce readiness? Tolerant of partial
 *  lines (JSON.parse guarded — sanctioned resilience, returns false).
 *  The one implementation lives in analysis-worker.ts (#189). */
const lineIsReady = (l: string): boolean =>
  parseJsonObject(l)?.type === "ready";

/** Does this analyzer stdout line carry a response id? Tolerant of partial
 *  lines (JSON.parse guarded — sanctioned resilience, returns false).
 *  (The generic id-shape predicate lives in analysis-worker.ts; this one
 *  goes through the key-server's own guarded line parser.) */
const lineHasId = (l: string): boolean => parseKeyServerLine(l) !== null;

export interface KeyServerLine {
  id: string;
  status: string | null;
  camelot: string | null;
  openkey: string | null;
  key: string | null;
}

/** Guard the key-analyzer protocol boundary. Log/noise lines and malformed
 *  replies become an explicit null and are ignored by the line reader. */
export function parseKeyServerLine(line: string): KeyServerLine | null {
  const value = parseJsonObject(line);
  if (!value || typeof value.id !== "string" || value.id.length === 0)
    return null;
  return {
    id: value.id,
    status: optionalString(value.status),
    camelot: optionalString(value.camelot),
    openkey: optionalString(value.openkey),
    key: optionalString(value.key),
  };
}

function optionalString(field: unknown): string | null {
  return typeof field === "string" ? field : null;
}

async function runKeyServer(
  server: string,
  paths: string[],
): Promise<Map<string, KeyResult | null>> {
  // Same in-flight null-placeholder protocol as analyzeKeys: null = the
  // analyzer reported a definitive error for that path. Placeholders are
  // stripped by the caller before results reach any consumer.
  const out = new Map<string, KeyResult | null>();
  if (!paths.length) return out;
  const proc = Bun.spawn({
    cmd: [
      "uv",
      "run",
      // Requirements-file form hits the warm uv env (the per-package
      // `--with torch>=2.0` form resolves differently and can hang).
      "--with-requirements",
      `${keyscanDir()}/requirements.txt`,
      "--python",
      "3.12",
      "python",
      server,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const enc = new TextEncoder();
  const lr = lineReader(proc.stdout as ReadableStream);
  /** Read lines until pred matches (or timeout/EOF). Deterministic: each
   * iteration either consumes a buffered line or awaits exactly one read()
   * — no polling race between a pump task and the caller. readUntilLine
   * itself is the ONE shared implementation (analysis-worker.ts, #189). */
  const readUntil = (pred: (line: string) => boolean, timeoutMs: number) =>
    readUntilLine(lr, pred, timeoutMs);
  const isReady = lineIsReady;
  const hasId = lineHasId;
  try {
    if (!(await readUntil(isReady, 90_000))) return out;
    for (const p of paths) {
      proc.stdin.write(enc.encode(`${JSON.stringify({ id: p, path: p })}\n`));
    }
    // Do NOT end stdin here — the analyzer treats stdin EOF as shutdown
    // ("cannot schedule new futures after shutdown") and dies before the
    // responses are computed. Keep it open; kill() in finally reaps.
    const t0 = Date.now();
    while (out.size < paths.length && Date.now() - t0 < 120_000) {
      const line = await readUntil(hasId, 120_000);
      if (line === null) break;
      const msg = parseKeyServerLine(line);
      if (!msg) continue;
      if (msg.status === "success" && msg.camelot) {
        out.set(msg.id, {
          camelot: msg.camelot,
          openkey: msg.openkey ?? "",
          key: msg.key ?? "",
        });
      } else {
        // Definitive error for this path — record absence so the outer
        // loop can terminate instead of waiting for responses that will
        // never come.
        out.set(msg.id, null);
      }
    }
  } finally {
    try {
      proc.kill();
    } catch (error) {
      // Process exit can race cleanup; there is no recovery work to do.
      void error;
    }
  }
  // Drop error placeholders — callers key on success only. The early-return
  // above hands back the same empty map typed through the promise.
  for (const [k, v] of out) if (v === null) out.delete(k);
  return out as Map<string, KeyResult>;
}

/** Convenience single-file wrapper over analyzeKeys. */
export async function analyzeKey(path: string): Promise<KeyResult | null> {
  const m = await analyzeKeys([path]);
  return m.get(path) ?? null;
}
