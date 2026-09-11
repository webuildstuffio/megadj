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
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { lineReader } from "./stdio";
import type { AnlzBeat } from "./anlz";

/** Where the OpenKeyScan analyzer repo is cloned (stdin/stdout JSON mode).
 * Override with FULLTAGS_KEYSCAN_DIR. Resolved lazily so tests/env can
 * set the variable at runtime. */
export function keyscanDir(): string {
  return (
    process.env.FULLTAGS_KEYSCAN_DIR ??
    `${process.env.HOME}/.local/share/openkeyscan-analyzer`
  );
}

/** Chromaprint fingerprint (raw fpcalc output, base64). Null when the
 * file is unreadable or fpcalc is missing (brew install chromaprint).
 * Throws are caught — Bun.spawnSync throws ENOENT when the binary is
 * absent from PATH, and the stage contract is degrade-to-null, never
 * abort the caller's pass. */
export function fingerprintFile(path: string): string | null {
  if (!existsSync(path)) return null;
  let pr: Bun.SyncSubprocess;
  try {
    pr = Bun.spawnSync({
      cmd: ["fpcalc", "-json", path],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return null; // fpcalc not installed
  }
  if (pr.exitCode !== 0) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(pr.stdout)) as {
      fingerprint?: string;
    };
    return j.fingerprint ?? null;
  } catch {
    return null;
  }
}

/** Duration (s, rounded) as reported by fpcalc — cheap sanity companion
 * to the fingerprint. */
export function fingerprintWithDuration(path: string): {
  fingerprint: string | null;
  durationS: number | null;
} {
  if (!existsSync(path)) return { fingerprint: null, durationS: null };
  let pr: Bun.SyncSubprocess;
  try {
    pr = Bun.spawnSync({
      cmd: ["fpcalc", "-json", path],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return { fingerprint: null, durationS: null }; // fpcalc not installed
  }
  if (pr.exitCode !== 0) return { fingerprint: null, durationS: null };
  try {
    const j = JSON.parse(new TextDecoder().decode(pr.stdout)) as {
      fingerprint?: string;
      duration?: number;
    };
    return {
      fingerprint: j.fingerprint ?? null,
      durationS: j.duration != null ? Math.round(j.duration) : null,
    };
  } catch {
    return { fingerprint: null, durationS: null };
  }
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
 * beat_this v1.1 API: `File2Beats.__call__(path)` returns
 * `(beats, downbeats)` — arrays of timestamps in SECONDS. Track tempo is
 * derived from the median inter-beat interval (the package exposes no
 * tempo field on this path).
 *
 * COMPRESSED-CONTAINER GOTCHA: beat_this's `load_audio` tries torchaudio →
 * soundfile → madmom. torchaudio ≥2.1 needs torchcodec for mp3/m4a/aac
 * (not in this env) and libsndfile can't demux them — so m4a/mp3/aac
 * inputs fail with "Could not load audio". Fix: decode via ffmpeg to a
 * temp WAV first (the archive always has ffmpeg); lossless containers
 * (wav/aiff/flac) go straight to beat_this.
 *
 * VERIFY GATE (roadmap #2): compare against rekordbox's re-analyzed
 * grids before any batch run; flag disagreements > 2%. */
export async function analyzeBeats(path: string): Promise<BeatResult | null> {
  if (!existsSync(path)) return null;
  // m4a/mp3/aac/ogg: ffmpeg-decode to a temp wav (same dir, cleaned up
  // below) so beat_this's loader never sees a compressed container.
  const ext = extname(path).toLowerCase();
  const needsDecode = [
    ".m4a",
    ".m4b",
    ".mp3",
    ".aac",
    ".ogg",
    ".opus",
  ].includes(ext);
  let decodedTmp: string | null = null;
  let analyzePath = path;
  if (needsDecode) {
    decodedTmp = `${dirname(path)}/.${basename(path)}.beats-${process.pid}.wav`;
    const dec = Bun.spawnSync({
      cmd: [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        decodedTmp,
      ],
      stdout: "ignore",
      stderr: "pipe",
    });
    if (dec.exitCode !== 0 || !existsSync(decodedTmp)) {
      if (decodedTmp && existsSync(decodedTmp)) rmSync(decodedTmp);
      decodedTmp = null;
    } else {
      analyzePath = decodedTmp;
    }
  }
  try {
    return await runBeatThis(analyzePath);
  } finally {
    if (decodedTmp && existsSync(decodedTmp)) rmSync(decodedTmp);
  }
}

async function runBeatThis(path: string): Promise<BeatResult | null> {
  // GA-02: the DBN is opt-in (MADJ_DBN=1) and non-commercial (madmom's
  // models are CC BY-NC-SA — the plan's licensing posture). beat_this's
  // `dbn=True` exposes NO tempo-range knob (verified: madmom defaults
  // 55–215 BPM), so per-genre priors will wire Audio2Frames → our own
  // DBNBeatTrackingProcessor later; for now the flag just flips the
  // postprocessor. Peak-picking (MIT, no madmom) stays the default.
  const useDbn = process.env.MEGADJ_DBN === "1";
  const script = `import json
import numpy as np
from beat_this.inference import File2Beats
f = File2Beats(device="cpu", dbn=${useDbn ? "True" : "False"})
beats, downbeats = f(${JSON.stringify(path)})
beats = np.asarray(beats, dtype=float)
downbeats = np.asarray(downbeats, dtype=float)
tempo = float(60.0 / np.median(np.diff(beats))) if len(beats) >= 4 else 0.0
print(json.dumps({
    "bpm": tempo,
    "beats": beats.tolist(),
    "downbeats": downbeats.tolist(),
}))`;
  const proc = Bun.spawnSync({
    cmd: [
      "uv",
      "run",
      "--with",
      "beat-this",
      // madmom must be CPJKU's git fork (PyPI 0.16.1 supports only
      // Python<3.10 / numpy<1.20) — required only when the DBN flag is on.
      ...(useDbn ? ["--with", "git+https://github.com/CPJKU/madmom.git"] : []),
      "--with",
      "soundfile", // beat_this's torchaudio fallback needs it for mp3/m4a
      "python",
      "-c",
      script,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  try {
    const last = new TextDecoder()
      .decode(proc.stdout)
      .trim()
      .split("\n")
      .at(-1);
    if (!last) return null;
    const j = JSON.parse(last) as {
      bpm?: number;
      beats?: number[];
      downbeats?: number[];
    };
    if (typeof j.bpm !== "number" || !Number.isFinite(j.bpm)) return null;
    const beats = j.beats ?? [];
    const fit = fitConstantTempo(beats);
    return {
      bpm: j.bpm,
      beats,
      downbeats: j.downbeats ?? [],
      bpmFitted: fit?.bpmFitted ?? null,
      residualStd: fit?.residualStd ?? null,
    };
  } catch {
    return null;
  }
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
  // COMPRESSED-CONTAINER GOTCHA (same as analyzeBeats): the analyzer's
  // librosa/libsndfile loader can't demux m4a/mp3/aac. ffmpeg-decode any
  // compressed input to temp WAVs (beside the originals, cleaned up in
  // finally) and analyze those; id stays the ORIGINAL path so callers map
  // results back correctly.
  const decodeMap = new Map<string, string>(); // tmp wav -> original path
  const tmps: string[] = [];
  const prepared = paths.map((p) => {
    const ext = extname(p).toLowerCase();
    if (
      ![".m4a", ".m4b", ".mp3", ".aac", ".ogg", ".opus"].includes(ext) ||
      !existsSync(p)
    ) {
      return p;
    }
    const tmp = `${dirname(p)}/.${basename(p)}.key-${process.pid}.wav`;
    const dec = Bun.spawnSync({
      cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", p, tmp],
      stdout: "ignore",
      stderr: "pipe",
    });
    if (dec.exitCode === 0 && existsSync(tmp)) {
      tmps.push(tmp);
      decodeMap.set(tmp, p);
      return tmp; // request references the tmp; response id maps back
    }
    return p; // decode failed — let the analyzer report the real error
  });
  try {
    const results = await runKeyServer(server, prepared);
    // Map tmp ids back to original paths; null placeholders drop here so
    // the returned map is the honest Map<string, KeyResult> wire type.
    for (const [tmp, orig] of decodeMap) {
      const r = results.get(tmp);
      results.delete(tmp);
      if (r) results.set(orig, r);
    }
    for (const [k, v] of results) if (v === null) results.delete(k);
    return results as Map<string, KeyResult>;
  } finally {
    for (const t of tmps) if (existsSync(t)) rmSync(t);
  }
}

/** Does this analyzer stdout line announce readiness? Tolerant of partial
 *  lines (JSON.parse guarded — sanctioned resilience, returns false). */
const lineIsReady = (l: string): boolean => {
  try {
    return (JSON.parse(l) as { type?: unknown }).type === "ready";
  } catch {
    return false;
  }
};

/** Does this analyzer stdout line carry a response id? Tolerant of partial
 *  lines (JSON.parse guarded — sanctioned resilience, returns false). */
const lineHasId = (l: string): boolean => {
  try {
    return !!(JSON.parse(l) as { id?: unknown }).id;
  } catch {
    return false;
  }
};

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
  const readUntil = async (
    pred: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const line = await lr.next(remaining);
      if (line == null) return null;
      if (pred(line)) return line;
    }
  };
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
      const msg = JSON.parse(line) as {
        id?: string;
        status?: string;
        camelot?: string;
        openkey?: string;
        key?: string;
      };
      if (msg.status === "success" && msg.camelot) {
        out.set(String(msg.id), {
          camelot: msg.camelot,
          openkey: msg.openkey ?? "",
          key: msg.key ?? "",
        });
      } else {
        // Definitive error for this path — record absence so the outer
        // loop can terminate instead of waiting for responses that will
        // never come.
        out.set(String(msg.id), null);
      }
    }
  } finally {
    try {
      proc.kill();
    } catch {
      /* already dead */
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
