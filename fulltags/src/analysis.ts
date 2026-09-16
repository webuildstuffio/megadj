/**
 * FullTags analysis probes — acoustic fingerprint (chromaprint/fpcalc),
 * beat/downbeat tempo (beat_this), and harmonic key (OpenKeyScan
 * analyzer, JSON over stdin/stdout, MPS auto-selected). Roadmap #1–#3.
 *
 * All three are OFFLINE and file-first: they read the audio file itself,
 * never the DB. Every probe is idempotent-friendly: callers check the
 * existing tag stamp (TXXX:ACOUSTID / TBPM / TKEY) before spending
 * compute.
 */
import { existsSync } from "node:fs";
import { isFiniteNumberArray, isRecord } from "../../cratedeck/shared/guards";
import { lineReader } from "./stdio";
import type { AnlzBeat } from "./anlz";

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch (error) {
    // Parser callers expose corruption through their explicit null result.
    void error;
    return null;
  }
}

function finiteNumberArray(raw: unknown): number[] | null {
  return isFiniteNumberArray(raw) ? raw : null;
}

function optionalString(field: unknown): string | null {
  return typeof field === "string" ? field : null;
}

/** Parse fpcalc's JSON boundary. Null is an explicit malformed/schema-failed
 * result; callers preserve their documented degrade-to-null contract. */
export function parseFpcalcJson(raw: string): {
  fingerprint: string | null;
  durationS: number | null;
} | null {
  const value = parseJsonObject(raw);
  if (!value) return null;
  const fingerprint =
    typeof value.fingerprint === "string" ? value.fingerprint : null;
  const duration = value.duration;
  return {
    fingerprint,
    durationS:
      typeof duration === "number" && Number.isFinite(duration)
        ? Math.round(duration)
        : null,
  };
}

/** Where the OpenKeyScan analyzer repo is cloned (stdin/stdout JSON mode).
 * Override with FULLTAGS_KEYSCAN_DIR. Resolved lazily so tests/env can
 * set the variable at runtime. */
export function keyscanDir(): string {
  return (
    process.env.FULLTAGS_KEYSCAN_DIR ??
    `${process.env.HOME}/.local/share/openkeyscan-analyzer`
  );
}

/** The shared fpcalc spawn + degrade contract (#99): run `fpcalc` with
 *  `args` and parse its stdout; null on unreadable file, missing binary
 *  (spawn throws ENOENT), or non-zero exit — degrade-to-null, never
 *  abort the caller's pass. All three fpcalc call sites (json
 *  fingerprint, `-length` dedupe fingerprint, duration companion) ride
 *  this frame; only the arg vector and parser differ. */
function runFpcalc<T>(
  args: string[],
  parse: (stdout: string) => T | null,
): T | null {
  let pr: Bun.SyncSubprocess;
  try {
    pr = Bun.spawnSync({
      cmd: ["fpcalc", ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    void error;
    return null; // fpcalc not installed
  }
  if (pr.exitCode !== 0) return null;
  return parse(new TextDecoder().decode(pr.stdout));
}

/** Chromaprint fingerprint (raw fpcalc output, base64). Null when the
 * file is unreadable or fpcalc is missing (brew install chromaprint).
 * Throws are caught — Bun.spawnSync throws ENOENT when the binary is
 * absent from PATH, and the stage contract is degrade-to-null, never
 * abort the caller's pass. */
export function fingerprintFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return runFpcalc(["-json", path], parseFpcalcJson)?.fingerprint ?? null;
}

/**
 * fingerprintFileLength — the dedupe-grade fingerprint (`fpcalc -length
 * 120`, raw text output parsed here). THE one spawn+parse for every
 * fingerprint pass in the repo (shelf-dupescan, shelf-dedupe,
 * shelf-hygiene) — previously three hand-copies whose base64url parse
 * regex omitted `-`/`_` and truncated at the first hyphen, colliding
 * unrelated files into fake duplicate groups (the Sep 11 mass-collision,
 * fixed in three places at once — this function exists so it can only be
 * fixed in one). Returns null when fpcalc is missing/fails or the file is
 * unreadable — degrade-to-null, never abort the caller's pass.
 */
export function fingerprintFileLength(path: string): string | null {
  if (!existsSync(path)) return null;
  return runFpcalc(["-length", "120", path], parseFpcalcOutput);
}

/** Parse fpcalc's raw `-length` stdout into a fingerprint. Base64url
 *  alphabet includes `-` and `_` — a char class without them truncates at
 *  the first hyphen and every file whose fingerprint shares the prefix
 *  collides into fake duplicate groups (the Sep 11 mass-collision;
 *  regression-tested in shelf-dupescan.test.ts). */
export function parseFpcalcOutput(stdout: string): string | null {
  const m = stdout.match(/FINGERPRINT=([A-Za-z0-9+=/_-]+)/);
  return m?.[1] ?? null;
}

/** Duration (s, rounded) as reported by fpcalc — cheap sanity companion
 * to the fingerprint. */
export function fingerprintWithDuration(path: string): {
  fingerprint: string | null;
  durationS: number | null;
} {
  if (!existsSync(path)) return { fingerprint: null, durationS: null };
  return (
    runFpcalc(["-json", path], parseFpcalcJson) ?? {
      fingerprint: null,
      durationS: null,
    }
  );
}

// ---------- beat_this (real BPM + downbeats) ----------

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

/** Resolve the next stdout line matching `pred`, or null on timeout/EOF.
 * Deterministic: consumes a buffered line or awaits exactly one read(). */
async function readUntilLine(
  lr: ReturnType<typeof lineReader>,
  pred: (line: string) => boolean,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const line = await lr.next(remaining);
    if (line == null) return null;
    if (pred(line)) return line;
  }
}

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
 * session; batches open one session per parallel worker. */
export async function openBeatSession(): Promise<BeatSession | null> {
  // GA-02: the DBN is opt-in (MADJ_DBN=1) and non-commercial (madmom's
  // models are CC BY-NC-SA — the plan's licensing posture).
  const useDbn = process.env.MEGADJ_DBN === "1";
  const proc = Bun.spawn({
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
  });
  const lr = lineReader(proc.stdout as ReadableStream);
  const enc = new TextEncoder();
  const readyLine = await readUntilLine(
    lr,
    (l) => parseJsonObject(l)?.type === "ready",
    BEAT_READY_TIMEOUT_MS,
  );
  let alive = readyLine !== null;
  if (!alive) {
    try {
      proc.kill();
    } catch (error) {
      // Process exit can race cleanup; there is no recovery work to do.
      void error;
    }
    return null;
  }
  const kill = () => {
    if (!alive) return;
    alive = false;
    try {
      proc.kill();
    } catch (error) {
      void error;
    }
  };
  return {
    async analyze(path: string): Promise<BeatResult | null> {
      if (!alive || !existsSync(path)) return null;
      proc.stdin.write(enc.encode(`${JSON.stringify({ id: path, path })}\n`));
      const line = await readUntilLine(
        lr,
        (l) => {
          const v = parseJsonObject(l);
          return typeof v?.id === "string" && v.id.length > 0;
        },
        BEAT_RESPONSE_TIMEOUT_MS,
      );
      if (line == null) {
        // Timeout/EOF desyncs the protocol — kill so a late response can
        // never be misattributed to the next request.
        kill();
        return null;
      }
      const v = parseJsonObject(line);
      if (!v || v.id !== path) return null;
      // Error lines ({"id","error"}) fail the BeatResult schema → null.
      return parseBeatThisJson(line);
    },
    close: kill,
  };
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

// ---------- constant-tempo fit + grid audit (plan.md GA-01/GA-04) ----------

/**
 * Least-squares constant-tempo fit over a beat array (plan GA-01): beat
 * index regressed on beat time. House is grid-locked by construction —
 * machine-sequenced 4/4 — so the fitted slope is a better tempo than any
 * per-beat interval, and `bpm_residual_std` says whether the
 * constant-tempo assumption held (small residual = grid-locked; large =
 * genuinely variable tempo, multi-point grid territory).
 *
 * Returns null when the array is too short to fit meaningfully (<4 beats,
 * non-finite, or zero time span — a degenerate grid must not produce a
 * confident tempo).
 */
export function fitConstantTempo(
  beats: number[],
): { bpmFitted: number; residualStd: number } | null {
  const n = beats.length;
  if (n < 4) return null;
  const times = beats.map(Number);
  if (times.some((t) => !Number.isFinite(t))) return null;
  const t0 = times[0]!;
  const span = times[n - 1]! - t0;
  if (!(span > 0)) return null;
  // Least squares over x = t - t0 (centering keeps the fit stable).
  const xs = times.map((t) => t - t0);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = (n - 1) / 2; // beat index mean
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxx += dx * dx;
    sxy += dx * (i - meanY);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx; // BEATS per SECOND (y = beat index, x = seconds)
  if (!(slope > 0)) return null;
  const bpmFitted = slope * 60;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (i - meanY - slope * (xs[i]! - meanX)) ** 2;
  const residualStd = Math.sqrt(ss / n); // beats of drift (1σ)
  return { bpmFitted, residualStd };
}

/** The grid-audit math (plan GA-04) for one track, given the ledger's beat
 * array and rekordbox's stored BPM (folded, same window as ours). All
 * thresholds are the plan's starting points; calibration is GA-05b's job.
 * Null verdict when there's no usable grid.
 *
 * Scope note: the plan's full anchor delta compares against the grid
 * decoded from rekordbox's ANLZ sidecar (GA-03/GA-07) — that decode
 * doesn't exist yet, so `anchorDeltaMs` is null and the SHIFT/PHASE
 * buckets (which need a real anchor) stay unassigned; every other metric
 * is computable from the ledger alone. `driftMs` is measured against RB's
 * BPM clock — the slide a CDJ locked to the stored BPM would accumulate,
 * which is exactly what Beat Sync does on hardware. */
export interface GridAuditVerdict {
  /** Rekordbox BPM − fitted BPM, 1dp BPM units. */
  bpmDelta: number;
  /** fitted / rb — 2.0/0.5 expose octave locks instantly. */
  bpmRatio: number;
  /** rb-ANLZ first downbeat − fitted-grid first downbeat, ms. Null until
   * the ANLZ decode exists (plan GA-03); the ledger-only pass can't see
   * rekordbox's own anchor. */
  anchorDeltaMs: number | null;
  /** Positional slide of the grid against RB's stored BPM over the whole
   * track, ms: how far the real beats and a CDJ locked to RB's tempo
   * drift apart by the outro. Signed (negative = grid finishes early =
   * true tempo is higher). */
  driftMs: number;
  /** True when the slide is deterministic (grid internally clean) rather
   * than jitter — with the ledger-only view this is `|drift| > 15 ms`
   * AND small internal wobble; a wobbly grid is CHAOS instead. */
  driftMonotonic: boolean;
  /** Internal wobble of the grid around its own fitted line, ms (1σ) —
   * the grid's self-consistency, independent of RB. */
  residualMs: number;
  /** The GA-05 bucket (ledger-only subset: SHIFT/PHASE need the ANLZ
   * anchor and are assigned by the GA-03 pass, never here). */
  bucket: "A-OK" | "SHIFT" | "PHASE" | "TEMPO" | "DRIFT" | "CHAOS";
  /** Human reason string for the surface. */
  reason: string;
}

export function gridAudit(
  beats: number[],
  rbBpm: number,
): GridAuditVerdict | null {
  if (beats.length < 8 || !(rbBpm > 0)) return null;
  const fit = fitConstantTempo(beats);
  if (!fit) return null;
  // Internal wobble: grid vs its OWN best-fit line (self-consistency).
  const residualMs = fit.residualStd * (60 / fit.bpmFitted) * 1000;
  // Positional slide vs RB's BPM clock: last-beat offset minus first-beat
  // offset under the RB hypothesis (the span gap the CDJ would accumulate).
  const n = beats.length;
  const spanActual = beats[n - 1]! - beats[0]!;
  const driftMs = (spanActual - ((n - 1) * 60) / rbBpm) * 1000;
  const bpmRatio = fit.bpmFitted / rbBpm;
  let bucket: GridAuditVerdict["bucket"];
  let reason: string;
  if (Math.abs(bpmRatio - 2) < 0.06 || Math.abs(bpmRatio - 0.5) < 0.03) {
    bucket = "TEMPO";
    reason = "fitted BPM is an octave off rekordbox";
  } else if (residualMs > 40) {
    bucket = "CHAOS";
    reason = `grid wobbles ±${Math.round(residualMs)} ms around its own tempo — manual territory`;
  } else if (Math.abs(driftMs) > 15) {
    bucket = "DRIFT";
    reason = `grid slides ${Math.round(Math.abs(driftMs))} ms against RB's ${rbBpm} BPM (clean grid at ${fit.bpmFitted.toFixed(2)})`;
  } else {
    // Any ≥8-beat grid with >2 BPM delta already exceeds 15 ms of slide,
    // so everything reaching here is genuinely within tolerance. The
    // plan's SHIFT (anchor offset, tempo right) needs the ANLZ anchor —
    // GA-03's pass fills that bucket; PHASE likewise.
    bucket = "A-OK";
    reason = "grid within tolerance";
  }
  return {
    bpmDelta: Math.round((rbBpm - fit.bpmFitted) * 10) / 10,
    bpmRatio: Math.round(bpmRatio * 1000) / 1000,
    anchorDeltaMs: null,
    driftMs: Math.round(driftMs * 10) / 10,
    driftMonotonic: Math.abs(driftMs) > 15 && residualMs <= 40,
    residualMs: Math.round(residualMs * 10) / 10,
    bucket,
    reason,
  };
}

// ---------- GA-03/GA-04 full audit: ANLZ anchor + phase ----------

/** Anchor tolerance (ms): |offset| under this is "the same grid" (the
 * plan A3 A-OK signature). */
export const ANCHOR_TOLERANCE_MS = 10;

/** Extend the ledger-only verdict with the ANLZ-decoded truth: anchor
 * delta (fixed offset), phase (wrong beat of the bar), and the SHIFT and
 * PHASE buckets the ledger pass cannot assign. Pure. */
export interface FullGridAudit extends GridAuditVerdict {
  /** rb-ANLZ first downbeat − fitted-grid first downbeat, ms. */
  anchorDeltaMs: number;
  /** Anchor delta reduced mod 1 beat (ms, in [-halfBeat, halfBeat]) —
   * sub-beat jitter after whole-beat removal. */
  phaseMs: number;
  /** Whole-beat count the phase shift represents (anchor mod beat). */
  phaseBeats: number;
}

/**
 * The GA-04 full audit: our fitted grid vs the ANLZ grid rekordbox
 * actually wrote. Buckets per the plan A3 table — SHIFT (fixed offset),
 * PHASE (whole-beat offset), TEMPO, DRIFT, CHAOS, A-OK — now ALL
 * reachable. `ledgerAudit` supplies the ledger-only half (pass the
 * `gridAudit` result when you have one; computed here when not).
 */
export function gridAuditFull(
  ledgerBeats: number[],
  anlzBeats: AnlzBeat[],
  rbBpm: number,
  ledger: GridAuditVerdict | null = gridAudit(ledgerBeats, rbBpm),
): FullGridAudit | null {
  if (!ledger || ledgerBeats.length < 8 || anlzBeats.length < 2) return null;
  const fit = fitConstantTempo(ledgerBeats);
  if (!fit) return null;
  const beatMs = 60000 / fit.bpmFitted;

  // Anchor: ANLZ's first downbeat (num===1) vs our first beat.
  const anlzDown = anlzBeats.find((b) => b.num === 1) ?? anlzBeats[0]!;
  const anchorDeltaMs = anlzDown.timeMs - ledgerBeats[0]! * 1000;

  // Phase: remove whole beats from the anchor offset; what's left is
  // sub-beat jitter. Round to the NEAREST beat count — a 0.9-beat offset
  // is a 1-beat phase shift with -0.1 beat of jitter.
  const rawBeats = anchorDeltaMs / beatMs;
  const phaseBeats = Math.round(rawBeats);
  const phaseMs = anchorDeltaMs - phaseBeats * beatMs;

  let bucket: FullGridAudit["bucket"];
  let reason: string;
  if (ledger.bucket === "TEMPO" || ledger.bucket === "CHAOS") {
    // Tempo-class problems dominate — a shifted grid at the wrong tempo
    // is still a tempo repair first.
    bucket = ledger.bucket;
    reason = ledger.reason;
  } else if (phaseBeats !== 0) {
    // Whole-beat offset (plan A3 PHASE: "anchor ≈ ±1 or ±2 beats").
    // phaseMs carries the residual jitter for GA-05 calibration.
    bucket = "PHASE";
    reason =
      phaseBeats > 0
        ? `RB grid starts ${phaseBeats} beat(s) late (+${Math.round(anchorDeltaMs)} ms, ${Math.round(Math.abs(phaseMs))} ms off the bar line)`
        : `RB grid starts ${-phaseBeats} beat(s) early (${Math.round(anchorDeltaMs)} ms, ${Math.round(Math.abs(phaseMs))} ms off the bar line)`;
  } else if (Math.abs(anchorDeltaMs) > ANCHOR_TOLERANCE_MS) {
    // Sub-beat fixed offset with matched tempo (plan A3 SHIFT: "anchor
    // > 10 ms, drift small, ratio ≈ 1" → anchor rewrite).
    bucket = "SHIFT";
    reason = `grids match in tempo but RB's anchor sits ${Math.round(anchorDeltaMs)} ms off ours — anchor rewrite`;
  } else {
    bucket = ledger.bucket;
    reason = ledger.reason;
  }

  return {
    ...ledger,
    anchorDeltaMs: Math.round(anchorDeltaMs * 10) / 10,
    phaseMs: Math.round(phaseMs * 10) / 10,
    phaseBeats,
    bucket,
    reason,
  };
}

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
 *  lines (JSON.parse guarded — sanctioned resilience, returns false). */
const lineIsReady = (l: string): boolean =>
  parseJsonObject(l)?.type === "ready";

/** Does this analyzer stdout line carry a response id? Tolerant of partial
 *  lines (JSON.parse guarded — sanctioned resilience, returns false). */
const lineHasId = (l: string): boolean => parseKeyServerLine(l) !== null;

export interface KeyServerLine {
  id: string;
  status: string | null;
  camelot: string | null;
  openkey: string | null;
  key: string | null;
}

/** Guard the key-analyzer protocol boundary. Log/noise lines and malformed
 * replies become an explicit null and are ignored by the line reader. */
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
   * — no polling race between a pump task and the caller. */
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
      if (line == null) break;
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
