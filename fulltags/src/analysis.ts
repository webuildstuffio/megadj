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
 * Periodicity readout over the beat ARRAY: autocorrelation of the
 * inter-beat interval series at lag 1 bar (4 intervals). The rev 5 BPM
 * gate found the median-interval tempo phase-locking 2.2–2.6% off
 * rekordbox on half the pilot — a median over local intervals inherits
 * every local drift. The bar-lag autocorrelation instead measures how
 * long the beat GRID takes to repeat over the whole track, which is
 * what a DJ means by the tempo.
 *
 * Returns null when the array is too short for a bar-lag estimate.
 */
export function tempoFromBeatGrid(beats: number[]): number | null {
  if (beats.length < 9) return null; // need ≥2 independent bar-lag samples
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i]! - beats[i - 1]!;
    if (d > 0.05 && d < 2) intervals.push(d); // sanity window: 30–1200 BPM
  }
  if (intervals.length < 9) return null;
  const n = intervals.length;
  const bar = 4;
  // mean interval over lag-4 pairs: sum of 4 consecutive intervals vs 4×
  // the mean of those same 4-window sums — this is the grid's own bar
  // period, robust to per-interval jitter.
  const sums: number[] = [];
  for (let i = 0; i + bar <= n; i++) {
    let s = 0;
    for (let k = 0; k < bar; k++) s += intervals[i + k]!;
    sums.push(s);
  }
  if (!sums.length) return null;
  const meanBar = sums.reduce((a, b) => a + b, 0) / sums.length;
  if (meanBar <= 0) return null;
  return 240 / meanBar; // 4 beats per bar → 60*(4/barSeconds)
}

/** Run beat_this on a file. Returns null when the env is missing — the
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
  const script = `import json
import numpy as np
from beat_this.inference import File2Beats
f = File2Beats(device="cpu")
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
    return {
      bpm: j.bpm,
      beats: j.beats ?? [],
      downbeats: j.downbeats ?? [],
    };
  } catch {
    return null;
  }
}

// ---------- OpenKeyScan analyzer (harmonic key) ----------

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
  const out = new Map<string, KeyResult>();
  const server = `${keyscanDir()}/openkeyscan_analyzer_server.py`;
  if (!existsSync(server) || !paths.length) return out;
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
    // Map tmp ids back to original paths.
    for (const [tmp, orig] of decodeMap) {
      const r = results.get(tmp);
      results.delete(tmp);
      if (r) results.set(orig, r);
    }
    return results;
  } finally {
    for (const t of tmps) if (existsSync(t)) rmSync(t);
  }
}

async function runKeyServer(
  server: string,
  paths: string[],
): Promise<Map<string, KeyResult>> {
  const out = new Map<string, KeyResult>();
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
  let buf = "";
  const dec = new TextDecoder();
  const stdoutReader = (proc.stdout as ReadableStream).getReader();
  /** Read lines until pred matches (or timeout/EOF). Deterministic: each
   * iteration either consumes a buffered line or awaits exactly one read()
   * — no polling race between a pump task and the caller. */
  const readUntil = async (
    pred: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string | null> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (pred(line)) return line;
        continue;
      }
      const { done, value } = await stdoutReader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
    }
    return null;
  };
  const isReady = (l: string) => {
    try {
      return JSON.parse(l).type === "ready";
    } catch {
      return false;
    }
  };
  const hasId = (l: string) => {
    try {
      return !!JSON.parse(l).id;
    } catch {
      return false;
    }
  };
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
        out.set(String(msg.id), null as unknown as KeyResult);
      }
    }
  } finally {
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
    void enc;
  }
  // Drop error placeholders — callers key on success only.
  for (const [k, v] of out) if (!v) out.delete(k);
  return out;
}

/** Convenience single-file wrapper over analyzeKeys. */
export async function analyzeKey(path: string): Promise<KeyResult | null> {
  const m = await analyzeKeys([path]);
  return m.get(path) ?? null;
}
