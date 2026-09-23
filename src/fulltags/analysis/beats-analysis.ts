/**
 * beats-analysis.ts — the beat_this probe (analysis stage 2 of 3): real
 * BPM + downbeats via the beat_this package in a uv-managed env.
 * Split from analysis.ts (#42 stage split).
 *
 * OFFLINE and file-first: reads the audio file itself, never the DB.
 * Idempotent-friendly: callers check the existing TBPM stamp before
 * spending compute.
 */
import { existsSync } from "node:fs";
import { isFiniteNumberArray } from "../../shared/leaf/guards";
import { parseJsonObject } from "../utils/parse-json";
import {
  lineHasRequestId,
  lineIsReady,
  openWorkerSession,
  writeNdjsonRequest,
} from "./analysis-worker";
import { fitConstantTempo } from "./grid-audit";

function finiteNumberArray(raw: unknown): number[] | null {
  return isFiniteNumberArray(raw) ? raw : null;
}

export interface BeatResult {
  /** Track-level tempo estimate (float BPM). */
  bpm: number;
  /** beat arrays (seconds) — downbeats are the bar anchors. */
  beats: number[];
  downbeats: number[];
  /** GA-01 constant-tempo fit over `beats` (null when the grid is too
   * short/degenerate to fit). Residual is in BEATS (1σ); multiply by
   * 60/bpm for ms. */
  bpmFitted: number | null;
  residualStd: number | null;
}

/** Longest common tempo-support helper: beat_this sometimes reports the
 * double/half tempo. Fold into a 70–180 DJ window by doubling/halving. */
export function foldTempo(bpm: number, lo = 70, hi = 180): number {
  let b = bpm;
  while (b < lo) b *= 2;
  while (b > hi) b /= 2;
  return b;
}

/**
 * Run beat_this on a file. Returns null when the env is missing — the
 * caller decides whether that's fatal (stage explicitly requested) or a
 * skip (idempotent re-run). Spawns `uv run --with beat-this` so the
 * ~2 GB torch env lives in the uv cache, never the repo.
 *
 * beat_this v1.1 API: `Audio2Beats.__call__(signal, sr)` returns
 * `(beats, downbeats)` — arrays of timestamps in SECONDS. Track tempo is
 * derived from the median inter-beat interval (the package exposes no
 * tempo field on this path).
 *
 * COMPRESSED-CONTAINER DECODE (in-process, no temp files): beat_this's
 * `load_audio` tries torchaudio → soundfile → madmom, and neither
 * torchaudio (needs torchcodec, which requires FFmpeg ≤ 8 — brew is on 9)
 * nor libsndfile can demux mp3/m4a/aac in this env. But `Audio2Beats`
 * takes a raw sample ARRAY (`File2Beats` is just `load_audio` +
 * `__call__`), so the script decodes any container itself via PyAV
 * (bundled FFmpeg, mono downmix, native rate — soxr resamples to 22050
 * inside beat_this). Replaces the old ffmpeg-to-temp-WAV bridge
 * byte-for-byte on BPM/beats (A/B'd Sep 15 2026) with zero disk I/O.
 *
 * SESSIONS: a one-shot spawn pays uv resolve + torch import + model load
 * every call (~1.5–1.9 s measured). Batch callers pass a persistent
 * `BeatSession` (openBeatSession) so that cost is paid once per worker;
 * `session === undefined` keeps the session-of-one fallback, so every
 * caller rides the same worker script either way.
 *
 * VERIFY GATE (roadmap #2): compare against rekordbox's re-analyzed
 * grids before any batch run; flag disagreements > 2%. */
export async function analyzeBeats(
  path: string,
  session: BeatSession | null = null,
): Promise<BeatResult | null> {
  if (!existsSync(path)) return null;
  if (session) return session.analyze(path);
  const s = await openBeatSession();
  if (!s) return null;
  try {
    return await s.analyze(path);
  } finally {
    s.close();
  }
}

/** uv package set for the beat worker — one source of truth for the
 * one-shot and persistent spawns (the DBN fork only when the flag is on). */
function beatWorkerArgs(useDbn: boolean): string[] {
  return [
    "--with",
    "beat-this",
    // madmom must be CPJKU's git fork (PyPI 0.16.1 supports only
    // Python<3.10 / numpy<1.20) — required only when the DBN flag is on.
    ...(useDbn ? ["--with", "git+https://github.com/CPJKU/madmom.git"] : []),
    "--with",
    "soundfile", // beat_this's torchaudio fallback needs it for mp3/m4a
    "--with",
    "av", // PyAV — in-process decode of compressed containers
  ];
}

/** The beat worker: decodes ANY container in-process (PyAV) and feeds
 * sample arrays to `Audio2Beats`. Session mode — NDJSON over stdin/stdout
 * ({"id",path} requests, {"id",bpm,beats,downbeats} or {"id",error}
 * responses, {"type":"ready"} once the model is loaded). stdin EOF exits
 * the loop, so closing our end reaps the worker naturally; the TS side
 * kills() as a backstop. Single-threaded by design: each session is
 * single-flight, batches parallelize by opening one session per worker. */
function beatWorkerScript(useDbn: boolean): string {
  return `import json, sys, warnings
warnings.filterwarnings("ignore")
import numpy as np
import av
from beat_this.inference import Audio2Beats

def load_mono(path, sr=22050):
    c = av.open(path)
    res = av.AudioResampler(format="fltp", layout="mono", rate=sr)
    frames = []
    for chunk in c.decode(audio=0):
        frames.extend(res.resample(chunk))
    c.close()
    arrs = [f.to_ndarray().reshape(-1) for f in frames]
    if not arrs:
        raise ValueError("no audio frames in %r" % path)
    return np.concatenate(arrs).astype("float64"), sr

f = Audio2Beats(device="cpu", dbn=${useDbn ? "True" : "False"})
print(json.dumps({"type": "ready"}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    rid = None
    try:
        req = json.loads(line)
        if isinstance(req, dict):
            rid = req.get("id")
        signal, sr = load_mono(req["path"])
        beats, downbeats = f(signal, sr)
        beats = np.asarray(beats, dtype=float)
        downbeats = np.asarray(downbeats, dtype=float)
        tempo = float(60.0 / np.median(np.diff(beats))) if len(beats) >= 4 else 0.0
        print(json.dumps({"id": rid, "bpm": tempo, "beats": beats.tolist(), "downbeats": downbeats.tolist()}), flush=True)
    except Exception as exc:
        print(json.dumps({"id": rid, "error": str(exc)[:200]}), flush=True)
`;
}

/** The worker-session kit lives in analysis-worker.ts (#189); beats
 * rides it as a thin adapter. (A readUntilLine re-export used to sit
 * here "for the session tests" — nothing imports it from this file and
 * knip rightly flagged it; the tests import from the kit directly.) */

export interface BeatSession {
  /** Analyze one file. Null on missing file, analyzer error, or a dead
   * session (a timed-out request kills the session — a late response
   * could otherwise be misattributed to the next request). */
  analyze: (path: string) => Promise<BeatResult | null>;
  /** Kill the worker. Idempotent; also safe after natural EOF exit. */
  close: () => void;
}

const BEAT_READY_TIMEOUT_MS = 90_000;
const BEAT_RESPONSE_TIMEOUT_MS = 180_000;

/** Persistent beat_this worker (NDJSON protocol above). Null when the
 * env is missing/fails the ready handshake — callers keep their
 * degrade-to-null contract. Single-flight: one request in flight per
 * session; batches open one session per parallel worker. Thin adapter
 * over the shared session kit (analysis-worker.ts, #189): this file owns
 * only the uv argv + worker script + response parsing. */
export async function openBeatSession(): Promise<BeatSession | null> {
  // GA-02: the DBN is opt-in (MEGADJ_DBN=1) and non-commercial (madmom's
  // models are CC BY-NC-SA — the plan's licensing posture).
  const useDbn = process.env.MEGADJ_DBN === "1";
  return openWorkerSession<string, BeatResult>({
    spawn: () =>
      Bun.spawn({
        cmd: [
          "uv",
          "run",
          ...beatWorkerArgs(useDbn),
          "python",
          "-c",
          beatWorkerScript(useDbn),
        ],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      }),
    isReady: lineIsReady,
    readyTimeoutMs: BEAT_READY_TIMEOUT_MS,
    encodeRequest: (path, enc, proc) =>
      writeNdjsonRequest(proc, enc, { id: path, path }),
    isResponse: lineHasRequestId,
    responseTimeoutMs: BEAT_RESPONSE_TIMEOUT_MS,
    parse: (line, path) => {
      const v = parseJsonObject(line);
      if (!v || v.id !== path) return null;
      // Error lines ({"id","error"}) fail the BeatResult schema → null.
      return parseBeatThisJson(line);
    },
  });
}

/** Parse the last JSON line emitted by beat_this. Invalid JSON, non-finite
 * numbers, and wrong-shaped arrays all return the explicit failed result. */
export function parseBeatThisJson(stdout: string): BeatResult | null {
  const last = stdout.trim().split("\n").at(-1);
  if (!last) return null;
  const value = parseJsonObject(last);
  if (
    !value ||
    typeof value.bpm !== "number" ||
    !Number.isFinite(value.bpm) ||
    value.bpm <= 0
  )
    return null;
  const beats = finiteNumberArray(value.beats);
  const downbeats = finiteNumberArray(value.downbeats);
  if (!beats || beats.length < 4 || !downbeats || downbeats.length === 0)
    return null;
  const fit = fitConstantTempo(beats);
  return {
    bpm: value.bpm,
    beats,
    downbeats,
    bpmFitted: fit?.bpmFitted ?? null,
    residualStd: fit?.residualStd ?? null,
  };
}
