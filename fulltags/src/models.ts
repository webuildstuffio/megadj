/**
 * ONNX model inference for mood / danceability / valence-arousal — roadmap #4.
 *
 * Two embedding towers (both ONNX, onnxruntime CPU/CoreML):
 *   - discogs-effnet (1280-d): danceability + mood_* heads (effnet-variant)
 *   - audioset-vggish (128-d): emomusic valence-arousal head
 *
 * Models live in ~/.local/share/fulltags-models (downloaded on first run via
 * `modelsEnsure()`; MTG UPF model server, CC BY-NC-SA — personal use).
 *
 * I/O contracts (empirically probed, 2026-09-05):
 *   effnet:  essentia TensorflowInputMusiCNN melspec — FrameGenerator(512, 256)
 *            → (N, 96) bands → chunks of 128 frames → (c, 128, 96) →
 *            output "embeddings" (c, 1280) → time-mean
 *   vggish:  TensorflowInputVGGish — FrameGenerator(400, 200) → (N, 64) bands
 *            → patches of 96 frames → (c, 64, 96) via transpose → output
 *            "embeddings" (c, 128) → time-mean
 *   heads:   dance/mood = softmax — label order from the .json (positive
 *            FIRST for every head except mood_party; see analyze()),
 *            emomusic = (valence, arousal) on a 1–9 scale (DEAM convention)
 *
 * Idempotency: TXXX:MOOD / TXXX:DANCE stamps (same pattern as ENERGY).
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { lineReader } from "./stdio";

// Fail fast on a missing HOME: `?? ""` produced "/.local/share/…" which
// failed much later with a confusing EACCES/ENOENT far from the cause.
const HOME = process.env.HOME ?? process.env.HOMEDIR;
if (!HOME)
  throw new Error(
    "fulltags mood: HOME is not set — cannot resolve the model directory (~/.local/share/fulltags-models). Export HOME and retry.",
  );
const MODEL_DIR = `${HOME}/.local/share/fulltags-models`;
const MODEL_BASE = "https://essentia.upf.edu/models";

export interface MoodResult {
  /** Probability 0–1 (head's "positive" class). */
  danceability: number;
  moodAggressive: number;
  moodHappy: number;
  moodElectronic: number;
  moodParty: number;
  /** 1–9 DEAM scale — 5 is neutral. */
  valence: number;
  arousal: number;
  /** I49 "sounds like": the effnet tower's 1280-d mean embedding. Only
   * present when the caller asked (analyzeMoods withEmbedding: true) —
   * round-tripped as plain numbers, 4dp-rounded (cosine noise floor). */
  embedding?: number[];
}

const MODEL_FILES = {
  effnet: {
    onnx: "discogs-effnet-bsdynamic-1.onnx",
    url: "feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx",
  },
  dance: {
    onnx: "danceability-discogs-effnet-1.onnx",
    url: "classification-heads/danceability/danceability-discogs-effnet-1.onnx",
  },
  aggressive: {
    onnx: "mood_aggressive-discogs-effnet-1.onnx",
    url: "classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1.onnx",
  },
  happy: {
    onnx: "mood_happy-discogs-effnet-1.onnx",
    url: "classification-heads/mood_happy/mood_happy-discogs-effnet-1.onnx",
  },
  electronic: {
    onnx: "mood_electronic-discogs-effnet-1.onnx",
    url: "classification-heads/mood_electronic/mood_electronic-discogs-effnet-1.onnx",
  },
  party: {
    onnx: "mood_party-discogs-effnet-1.onnx",
    url: "classification-heads/mood_party/mood_party-discogs-effnet-1.onnx",
  },
  vggish: {
    onnx: "audioset-vggish-3.onnx",
    url: "feature-extractors/vggish/audioset-vggish-3.onnx",
  },
  emomusic: {
    onnx: "emomusic-audioset-vggish-2.onnx",
    url: "classification-heads/emomusic/emomusic-audioset-vggish-2.onnx",
  },
} as const;

/** True when every model file needed by the mood stage exists. */
export function moodModelsPresent(): boolean {
  return Object.values(MODEL_FILES).every((m) =>
    existsSync(`${MODEL_DIR}/${m.onnx}`),
  );
}

/** Download any missing models (~320 MB total, once). Returns the list of
 * files fetched (empty = nothing to do). Throws on download failure. */
export function modelsEnsure(): string[] {
  const got: string[] = [];
  mkdirSync(MODEL_DIR, { recursive: true });
  for (const m of Object.values(MODEL_FILES)) {
    const dest = `${MODEL_DIR}/${m.onnx}`;
    if (existsSync(dest)) continue;
    const tmp = `${dest}.part`;
    const pr = Bun.spawnSync({
      cmd: [
        "curl",
        "-sfL",
        "--retry",
        "2",
        "-o",
        tmp,
        `${MODEL_BASE}/${m.url}`,
      ],
      stdout: "ignore",
      stderr: "pipe",
    });
    if (pr.exitCode !== 0 || !existsSync(tmp)) {
      if (existsSync(tmp)) rmSync(tmp);
      throw new Error(`model download failed: ${m.url}`);
    }
    rmSync(dest, { force: true });
    Bun.spawnSync({ cmd: ["mv", tmp, dest] });
    got.push(m.onnx);
  }
  return got;
}

export function modelDir(): string {
  return MODEL_DIR;
}

/** Compact "k=v; …" stamp from a MoodResult (TXXX:MOOD payload). */
export function moodStamp(m: MoodResult): string {
  return [
    `dance=${m.danceability.toFixed(3)}`,
    `aggressive=${m.moodAggressive.toFixed(3)}`,
    `happy=${m.moodHappy.toFixed(3)}`,
    `electronic=${m.moodElectronic.toFixed(3)}`,
    `party=${m.moodParty.toFixed(3)}`,
    `valence=${m.valence.toFixed(2)}`,
    `arousal=${m.arousal.toFixed(2)}`,
  ].join("; ");
}

/** Python script: decode (any format — ffmpeg), melspec via essentia, both
 * towers on ort, all heads. One spawn per BATCH of files (torch-free env:
 * essentia + onnxruntime + numpy only, ~100 MB uv cache, no model reload
 * cost — ort session init is per-file but tiny). Prints one JSON line per
 * input path: {"path": ..., "mood": {...}} or {"path": ..., "error": ...}. */
const MOOD_SCRIPT = `
import json, sys
import numpy as np
import onnxruntime as ort

MODEL_DIR = ${JSON.stringify(MODEL_DIR)}

from essentia.standard import MonoLoader, FrameGenerator, TensorflowInputMusiCNN, TensorflowInputVGGish

PROV = ["CPUExecutionProvider"]
effnet = ort.InferenceSession(f"{MODEL_DIR}/discogs-effnet-bsdynamic-1.onnx", providers=PROV)
vggish = ort.InferenceSession(f"{MODEL_DIR}/audioset-vggish-3.onnx", providers=PROV)
heads = {
    name: ort.InferenceSession(f"{MODEL_DIR}/{name}-discogs-effnet-1.onnx", providers=PROV)
    for name in ("danceability", "mood_aggressive", "mood_happy", "mood_electronic", "mood_party")
}
emo = ort.InferenceSession(f"{MODEL_DIR}/emomusic-audioset-vggish-2.onnx", providers=PROV)

def chunks_of(frames, size):
    n = (frames.shape[0] // size) * size
    return frames[:n].reshape(-1, size, frames.shape[1])

def analyze(path, want_embedding):
    audio = MonoLoader(filename=path, sampleRate=16000, resampleQuality=4)()
    # effnet tower: musiCNN melspec (512/256), 128-frame chunks
    mel = TensorflowInputMusiCNN()
    frames = np.asarray([mel(f) for f in FrameGenerator(audio, frameSize=512, hopSize=256)], dtype=np.float32)
    batch = chunks_of(frames, 128)
    if batch.shape[0] == 0: raise ValueError("audio too short")
    emb = effnet.run(["embeddings"], {"melspectrogram": batch})[0]
    emb1280 = emb.mean(axis=0).astype(np.float32)[np.newaxis, :]
    out = {}
    if want_embedding:
        # I49 "sounds like": the tower's own 1280-d mean embedding — one
        # probe run already computes it; emitting it costs a JSON field.
        # Rounded to 4dp (1e-4 in a unit-ish vector ~ noise floor for
        # cosine ranking) to keep the wire/ledger rows compact.
        out["embedding"] = [round(float(x), 4) for x in emb1280[0]]
    for name, sess in heads.items():
        act = sess.run(["activations"], {"embeddings": emb1280})[0].flatten()
        # label order from the model .json — POSITIVE FIRST for every head
        # except mood_party which is ['non_party', 'party']:
        #   danceability: ['danceable', 'not_danceable']
        #   mood_aggressive: ['aggressive', 'not_aggressive']
        #   mood_happy: ['happy', 'non_happy']
        #   mood_electronic: ['electronic', 'non_electronic']
        #   mood_party: ['non_party', 'party']
        idx = 0 if name != "mood_party" else 1
        suffix = name[len("mood_"):]
        key = "danceability" if name == "danceability" else "mood" + suffix[0].upper() + suffix[1:]
        out[key] = float(act[idx])
    # vggish tower: vggish melspec (400/200), 96-frame patches transposed to (64, 96)
    melv = TensorflowInputVGGish()
    fsv = np.asarray([melv(f) for f in FrameGenerator(audio, frameSize=400, hopSize=200)], dtype=np.float32)
    pv = chunks_of(fsv, 96).transpose(0, 2, 1)
    if pv.shape[0] == 0: raise ValueError("audio too short (vggish)")
    vemb = vggish.run(["embeddings"], {"melspectrogram": pv})[0]
    v128 = vemb.mean(axis=0).astype(np.float32)[np.newaxis, :]
    va = emo.run(["activations"], {"embeddings": v128})[0].flatten()
    out["valence"], out["arousal"] = float(va[0]), float(va[1])
    return out

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    path = json.loads(line)
    want_embedding = False
    if isinstance(path, dict):
        want_embedding = bool(path.get("embedding", False))
        path = path["path"]
    try:
        print(json.dumps({"path": path, "mood": analyze(path, want_embedding)}), flush=True)
    except Exception as e:
        print(json.dumps({"path": path, "error": str(e)[:200]}), flush=True)
`;

/** Analyze a batch of files for mood/dance/valence. Returns a Map keyed by
 * the ORIGINAL path. Missing models → modelsEnsure first, or this returns
 * an empty map. Errors per-file are dropped (caller sees a short map).
 * withEmbedding: also emit the effnet 1280-d mean embedding per file
 * (I49 "sounds like") — same single probe run, no extra model cost. */
export async function analyzeMoods(
  paths: string[],
  opts: { withEmbedding?: boolean } = {},
): Promise<Map<string, MoodResult>> {
  const out = new Map<string, MoodResult>();
  if (!paths.length || !moodModelsPresent()) return out;
  const proc = Bun.spawn({
    cmd: [
      "uv",
      "run",
      "--with",
      "essentia",
      "--with",
      "onnxruntime",
      "--with",
      "numpy",
      "python",
      "-c",
      MOOD_SCRIPT,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const enc = new TextEncoder();
  const lr = lineReader(proc.stdout as ReadableStream);
  const readLine = (timeoutMs: number) => lr.next(timeoutMs);
  try {
    for (const p of paths)
      proc.stdin.write(
        enc.encode(
          `${JSON.stringify({ path: p, embedding: opts.withEmbedding === true })}\n`,
        ),
      );
    // EOF the python worker's stdin — without this the worker never exits
    // when files FAIL (error replies don't count toward `expected`, and the
    // readLine below would block the full 180s timeout per missing result).
    // Sep 10 2026: found while regression-testing the mood queue fix.
    proc.stdin.end();
    const expected = paths.length;
    while (out.size < expected) {
      const line = await readLine(180_000);
      if (line == null) break;
      try {
        const msg = JSON.parse(line) as {
          path?: string;
          mood?: MoodResult;
        };
        if (msg.path && msg.mood) out.set(msg.path, msg.mood);
      } catch {
        // malformed line — skip
      }
    }
  } finally {
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
  }
  return out;
}
