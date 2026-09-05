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
 * file is unreadable or fpcalc is missing (brew install chromaprint). */
export function fingerprintFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const pr = Bun.spawnSync({
    cmd: ["fpcalc", "-json", path],
    stdout: "pipe",
    stderr: "pipe",
  });
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
  const pr = Bun.spawnSync({
    cmd: ["fpcalc", "-json", path],
    stdout: "pipe",
    stderr: "pipe",
  });
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
 * VERIFY GATE (roadmap #2): compare against rekordbox's re-analyzed
 * grids before any batch run; flag disagreements > 2%. */
export async function analyzeBeats(path: string): Promise<BeatResult | null> {
  if (!existsSync(path)) return null;
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
      proc.stdin.write(
        enc.encode(`${JSON.stringify({ id: p, path: p })}\n`),
      );
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
