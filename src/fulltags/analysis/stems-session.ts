/**
 * stems-session.ts — persistent Demucs worker session.
 *
 * Same contract as openBeatSession (analysis-worker.ts): one NDJSON
 * worker process, one request in flight, timeout kills the session.
 * The model loads once; each analyze() call sends a track and waits
 * for the result.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lineHasRequestId,
  lineIsReady,
  openWorkerSession,
  writeNdjsonRequest,
  type WorkerSession,
} from "./analysis-worker";
import { parseJsonOrNull } from "../../shared/leaf/guards";

/** The ready handshake payload from the Python worker. */
export interface StemWorkerInfo {
  model: string;
  device: string;
  sources: string[];
  samplerate: number;
}

export interface StemRequest {
  path: string;
  outputDir: string;
}

export interface StemSuccess {
  ok: true;
  stems: Record<string, string>;
  elapsedS: number;
  durationS: number;
  outputBytes: number;
  trackNumber: number;
}

export interface StemError {
  ok: false;
  error: string;
  errorType: string;
  traceback: string;
}

export type StemResult = StemSuccess | StemError;

export interface StemSession {
  info: StemWorkerInfo;
  analyze: (req: StemRequest) => Promise<StemResult | null>;
  close: () => void;
}

/** Per-request timeout: htdemucs_ft takes ~30s on MPS, ~2min on CPU.
 *  5 minutes covers very long tracks on CPU. */
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
/** Model load + handshake: htdemucs_ft download + torch init can take
 *  a while on first run (model checkpoint ~300MB). */
const READY_TIMEOUT_MS = 10 * 60 * 1000;

const DEMUCS_MODEL = "htdemucs_ft";
const DEMUCS_DEPS = ["demucs==4.1.0", "soundfile"] as const;

export async function openStemSession(): Promise<StemSession | null> {
  let workerInfo: StemWorkerInfo | null = null;
  const scriptPath = join(import.meta.dir, "stems-worker.py");
  const scriptContent = readFileSync(scriptPath, "utf8");

  const inner: WorkerSession<StemRequest, StemResult> | null = await openWorkerSession<
    StemRequest,
    StemResult
  >({
    spawn: () =>
      Bun.spawn({
        cmd: [
          "uv",
          "run",
          ...DEMUCS_DEPS.flatMap((dep) => ["--with", dep]),
          "python",
          "-c",
          scriptContent,
        ],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        env: {
          ...process.env,
          DEMUCS_MODEL,
          // MPS graph capture: reuse compiled kernels across inference calls
          PYTORCH_MPS_HIGH_WATERMARK_RATIO: "0.0",
        },
      }),
    isReady(line) {
      const parsed = parseJsonOrNull(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        (parsed as Record<string, unknown>)["type"] === "ready"
      ) {
        const obj = parsed as Record<string, unknown>;
        workerInfo = {
          model: String(obj["model"] ?? DEMUCS_MODEL),
          device: String(obj["device"] ?? "cpu"),
          sources: Array.isArray(obj["sources"]) ? (obj["sources"] as unknown[]).map(String) : [],
          samplerate: (() => {
            const sr = Number(obj["samplerate"]);
            return Number.isFinite(sr) ? sr : 44100;
          })(),
        };
        return true;
      }
      return lineIsReady(line);
    },
    readyTimeoutMs: READY_TIMEOUT_MS,
    encodeRequest: (req, enc, proc) =>
      writeNdjsonRequest(proc, enc, { id: req.path, path: req.path, output_dir: req.outputDir }),
    isResponse: lineHasRequestId,
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
    parse(line, req) {
      const obj = parseJsonOrNull(line) as Record<string, unknown> | null;
      if (obj === null || obj["id"] !== req.path) return null;

      if (obj["status"] !== "ok") {
        return {
          ok: false as const,
          error: String(obj["error"] ?? "unknown error"),
          errorType: String(obj["error_type"] ?? "Unknown"),
          traceback: String(obj["traceback"] ?? ""),
        };
      }

      const stems = obj["stems"];
      if (stems === null || typeof stems !== "object") return null;
      const elapsedRaw = Number(obj["elapsed_s"]);
      const durationRaw = Number(obj["duration_s"]);
      const bytesRaw = Number(obj["output_bytes"]);
      const trackRaw = Number(obj["track_number"]);
      return {
        ok: true as const,
        stems: stems as Record<string, string>,
        elapsedS: Number.isFinite(elapsedRaw) ? elapsedRaw : 0,
        durationS: Number.isFinite(durationRaw) ? durationRaw : 0,
        outputBytes: Number.isFinite(bytesRaw) ? bytesRaw : 0,
        trackNumber: Number.isFinite(trackRaw) ? trackRaw : 0,
      };
    },
  });

  if (inner === null) return null;

  return {
    info: workerInfo ?? {
      model: DEMUCS_MODEL,
      device: "cpu",
      sources: ["drums", "bass", "other", "vocals"],
      samplerate: 44100,
    },
    analyze: inner.analyze,
    close: inner.close,
  };
}
