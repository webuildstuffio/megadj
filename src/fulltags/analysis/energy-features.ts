/**
 * energy-features.ts — Energy v3.1 feature extraction (Tier A DSP + Tier B heads).
 *
 * DB schema: `energy_features` (per-track) + `energy_reference` (frozen library).
 * Python script: inline ENERGY_SCRIPT extracts all features in one spawn per batch
 * (essentia DSP + onnxruntime effnet heads on the drop section).
 *
 * Follows the mood pipeline pattern: one inline Python script, one process
 * per worker, JSON-lines I/O.
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { nonEmptyEnv } from "../../shared/leaf/guards";

const HOME = nonEmptyEnv("HOME");
if (HOME === undefined) throw new Error("energy-features: HOME is unset or empty");
const MODEL_DIR = `${HOME}/.local/share/fulltags-models`;

/** All Tier A + Tier B feature columns for one track. */
export interface EnergyFeatureRow {
  readonly videoId: string;
  readonly onsetsPerBeat: number | null;
  readonly bpm: number | null;
  readonly hfEnergyReLufs: number | null;
  readonly lowEnergyReLufs: number | null;
  readonly crestFactor: number | null;
  readonly spectralFlux: number | null;
  readonly lufsDrop: number | null;
  readonly spectralCentroid: number | null;
  readonly aggressive: number | null;
  readonly engagement: number | null;
  readonly approachability: number | null;
  readonly arousalDrop: number | null;
  readonly dropStartS: number | null;
  readonly dropEndS: number | null;
  readonly dropContrastDb: number | null;
  readonly lowDropContrast: boolean;
}

/** Result from the Python extractor for one track. */
export interface EnergyExtractResult {
  readonly path: string;
  readonly error?: string | undefined;
  readonly features?: {
    onsets_per_beat: number;
    bpm: number;
    hf_energy_re_lufs: number;
    low_energy_re_lufs: number;
    crest_factor: number;
    spectral_flux: number;
    lufs_drop: number;
    spectral_centroid: number;
    aggressive: number;
    engagement: number;
    approachability: number;
    arousal_drop: number;
    drop_start_s: number;
    drop_end_s: number;
    drop_contrast_db: number;
    low_drop_contrast: boolean;
  };
}

// --------------- DB schema ---------------

export function migrateEnergyTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_features (
      video_id             TEXT PRIMARY KEY,
      onsets_per_beat       REAL,
      bpm                  REAL,
      hf_energy_re_lufs    REAL,
      low_energy_re_lufs   REAL,
      crest_factor         REAL,
      spectral_flux        REAL,
      lufs_drop            REAL,
      spectral_centroid    REAL,
      aggressive           REAL,
      engagement           REAL,
      approachability      REAL,
      arousal_drop         REAL,
      composite_rank       REAL,
      energy_band          INTEGER,
      energy_confidence    TEXT,
      drop_start_s         REAL,
      drop_end_s           REAL,
      drop_contrast_db     REAL,
      low_drop_contrast    INTEGER DEFAULT 0,
      weight_preset        TEXT,
      model_version        TEXT NOT NULL DEFAULT 'energy-v3.1',
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS energy_reference (
      id                   INTEGER PRIMARY KEY DEFAULT 1,
      signals_json         TEXT NOT NULL,
      blocs_json           TEXT NOT NULL,
      frozen_composites    TEXT NOT NULL,
      dead_signals         TEXT,
      correlation_matrix   TEXT,
      pc1_loadings         TEXT,
      pc1_variance_pct     REAL,
      track_count          INTEGER NOT NULL,
      weight_preset        TEXT NOT NULL,
      frozen_at            TEXT NOT NULL,
      model_version        TEXT NOT NULL DEFAULT 'energy-v3.1'
    );
  `);
}

// --------------- DB read/write ---------------

export function upsertEnergyFeatures(db: Database, row: EnergyFeatureRow): void {
  db.run(
    `INSERT OR REPLACE INTO energy_features
       (video_id, onsets_per_beat, bpm, hf_energy_re_lufs, low_energy_re_lufs,
        crest_factor, spectral_flux, lufs_drop, spectral_centroid,
        aggressive, engagement, approachability, arousal_drop,
        drop_start_s, drop_end_s, drop_contrast_db, low_drop_contrast)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.videoId,
      row.onsetsPerBeat,
      row.bpm,
      row.hfEnergyReLufs,
      row.lowEnergyReLufs,
      row.crestFactor,
      row.spectralFlux,
      row.lufsDrop,
      row.spectralCentroid,
      row.aggressive,
      row.engagement,
      row.approachability,
      row.arousalDrop,
      row.dropStartS,
      row.dropEndS,
      row.dropContrastDb,
      row.lowDropContrast ? 1 : 0,
    ],
  );
}

export function loadAllEnergyFeatures(db: Database): EnergyFeatureRow[] {
  const rows = db
    .query(
      `SELECT video_id, onsets_per_beat, bpm, hf_energy_re_lufs,
              low_energy_re_lufs, crest_factor, spectral_flux, lufs_drop,
              spectral_centroid, aggressive, engagement, approachability,
              arousal_drop, drop_start_s, drop_end_s, drop_contrast_db,
              low_drop_contrast
       FROM energy_features`,
    )
    .all() as DbEnergyRow[];
  return rows.map(dbRowToFeatureRow);
}

export function energyFeatureCount(db: Database): number {
  const r = db.query("SELECT count(*) AS n FROM energy_features").get() as { n: number } | null;
  return r?.n ?? 0;
}

interface DbEnergyRow {
  video_id: string;
  onsets_per_beat: number | null;
  bpm: number | null;
  hf_energy_re_lufs: number | null;
  low_energy_re_lufs: number | null;
  crest_factor: number | null;
  spectral_flux: number | null;
  lufs_drop: number | null;
  spectral_centroid: number | null;
  aggressive: number | null;
  engagement: number | null;
  approachability: number | null;
  arousal_drop: number | null;
  drop_start_s: number | null;
  drop_end_s: number | null;
  drop_contrast_db: number | null;
  low_drop_contrast: number | null;
}

function dbRowToFeatureRow(r: DbEnergyRow): EnergyFeatureRow {
  return {
    videoId: r.video_id,
    onsetsPerBeat: r.onsets_per_beat,
    bpm: r.bpm,
    hfEnergyReLufs: r.hf_energy_re_lufs,
    lowEnergyReLufs: r.low_energy_re_lufs,
    crestFactor: r.crest_factor,
    spectralFlux: r.spectral_flux,
    lufsDrop: r.lufs_drop,
    spectralCentroid: r.spectral_centroid,
    aggressive: r.aggressive,
    engagement: r.engagement,
    approachability: r.approachability,
    arousalDrop: r.arousal_drop,
    dropStartS: r.drop_start_s,
    dropEndS: r.drop_end_s,
    dropContrastDb: r.drop_contrast_db,
    lowDropContrast: (r.low_drop_contrast ?? 0) !== 0,
  };
}

// --------------- Python DSP + ONNX script ---------------

/** Inline Python: one-process feature extractor.
 *  Input: JSON lines `{"path": ..., "drop_start": ..., "drop_end": ..., "bpm": ...}`
 *  Output: JSON lines `{"path": ..., "features": {...}}` or `{"path": ..., "error": ...}` */
const ENERGY_SCRIPT = `
import json, sys, os, math
import numpy as np
import onnxruntime as ort

MODEL_DIR = ${JSON.stringify(MODEL_DIR)}

from essentia.standard import (
    MonoLoader, AudioLoader, FrameGenerator, Windowing, Spectrum,
    EnergyBand, DynamicComplexity, OnsetRate, Centroid,
    Flux, LoudnessEBUR128, TensorflowInputMusiCNN
)

PROV = ["CPUExecutionProvider"]

# Load models once (session reuse across all files)
effnet_path = os.path.join(MODEL_DIR, "discogs-effnet-bsdynamic-1.onnx")
vggish_path = os.path.join(MODEL_DIR, "audioset-vggish-3.onnx")
aggressive_path = os.path.join(MODEL_DIR, "mood_aggressive-discogs-effnet-1.onnx")
engagement_path = os.path.join(MODEL_DIR, "engagement_regression-discogs-effnet-1.onnx")
approachability_path = os.path.join(MODEL_DIR, "approachability_regression-discogs-effnet-1.onnx")
emo_path = os.path.join(MODEL_DIR, "emomusic-audioset-vggish-2.onnx")

effnet = ort.InferenceSession(effnet_path, providers=PROV) if os.path.exists(effnet_path) else None
vggish_sess = ort.InferenceSession(vggish_path, providers=PROV) if os.path.exists(vggish_path) else None
aggr_sess = ort.InferenceSession(aggressive_path, providers=PROV) if os.path.exists(aggressive_path) else None
eng_sess = ort.InferenceSession(engagement_path, providers=PROV) if os.path.exists(engagement_path) else None
appr_sess = ort.InferenceSession(approachability_path, providers=PROV) if os.path.exists(approachability_path) else None
emo_sess = ort.InferenceSession(emo_path, providers=PROV) if os.path.exists(emo_path) else None

def chunks_of(frames, size):
    n = (frames.shape[0] // size) * size
    return frames[:n].reshape(-1, size, frames.shape[1])

def extract_features(path, drop_start, drop_end, bpm):
    sr = 44100
    # Load full file ONCE at 44.1kHz for DSP features + contrast
    audio = MonoLoader(filename=path, sampleRate=sr, resampleQuality=1)()
    s = max(0, int(drop_start * sr))
    e = min(len(audio), int(drop_end * sr))
    if e - s < sr * 2:
        raise ValueError("drop section too short (< 2s)")
    drop_audio = audio[s:e]

    # --- EBU R128 LUFS on drop (mono pseudo-stereo) ---
    try:
        loudness = LoudnessEBUR128(sampleRate=sr)
        stereo = np.stack([drop_audio, drop_audio])
        integrated, _, _, _ = loudness(stereo.T)
        lufs_drop = float(integrated)
    except Exception:
        rms = np.sqrt(np.mean(drop_audio ** 2))
        lufs_drop = float(20 * np.log10(rms + 1e-10))

    target_lufs = -14.0
    gain_db = target_lufs - lufs_drop
    gain_linear = 10 ** (gain_db / 20.0)
    norm_audio = drop_audio * gain_linear

    # --- Spectral features ---
    frame_size = 2048
    hop_size = 1024
    windowing = Windowing(type="hann", size=frame_size)
    spectrum_algo = Spectrum(size=frame_size)
    hf_band = EnergyBand(startCutoffFrequency=4000, stopCutoffFrequency=12000, sampleRate=sr)
    low_band = EnergyBand(startCutoffFrequency=20, stopCutoffFrequency=150, sampleRate=sr)
    centroid_algo = Centroid(range=sr / 2)
    flux_algo = Flux()

    hf_energies = []
    low_energies = []
    centroids = []
    fluxes = []
    for frame in FrameGenerator(norm_audio, frameSize=frame_size, hopSize=hop_size):
        windowed = windowing(frame)
        spec = spectrum_algo(windowed)
        hf_energies.append(float(hf_band(spec)))
        low_energies.append(float(low_band(spec)))
        centroids.append(float(centroid_algo(spec)))
        fluxes.append(float(flux_algo(spec)))

    mean_hf = np.mean(hf_energies) if hf_energies else 0
    mean_low = np.mean(low_energies) if low_energies else 0
    hf_energy_re_lufs = float(10 * np.log10(mean_hf + 1e-10) - target_lufs)
    low_energy_re_lufs = float(10 * np.log10(mean_low + 1e-10) - target_lufs)
    spectral_centroid = float(np.mean(centroids)) if centroids else 0
    spectral_flux = float(np.mean(fluxes)) if fluxes else 0

    # --- Dynamic complexity ---
    dc, _ = DynamicComplexity(sampleRate=sr)(drop_audio)
    crest_factor = float(-dc)

    # --- Onset density ---
    _, onset_rate = OnsetRate()(drop_audio)
    onsets_per_beat = float(onset_rate / (bpm / 60.0)) if bpm > 0 else 0

    # --- Drop contrast vs pre-drop section ---
    rest_audio = np.concatenate([audio[:s], audio[e:]]) if s > 0 or e < len(audio) else np.array([])
    if len(rest_audio) > sr:
        rest_rms = np.sqrt(np.mean(rest_audio ** 2))
        drop_rms = np.sqrt(np.mean(drop_audio ** 2))
        drop_contrast_db = float(20 * np.log10((drop_rms + 1e-10) / (rest_rms + 1e-10)))
    else:
        drop_contrast_db = 0.0
    low_drop_contrast = drop_contrast_db < 3.0

    # Free full-size 44.1k array early
    del audio, norm_audio

    # --- Tier B: load 16kHz ONCE for both ONNX towers ---
    aggressive_score = 0.0
    engagement_score = 0.0
    approachability_score = 0.0
    arousal_drop_score = 5.0

    audio_16k = MonoLoader(filename=path, sampleRate=16000, resampleQuality=0)()
    s16 = max(0, int(drop_start * 16000))
    e16 = min(len(audio_16k), int(drop_end * 16000))
    drop_16k = audio_16k[s16:e16]
    del audio_16k

    if effnet is not None and len(drop_16k) >= 16000 * 2:
        mel = TensorflowInputMusiCNN()
        frames_16k = np.asarray(
            [mel(f) for f in FrameGenerator(drop_16k, frameSize=512, hopSize=256)],
            dtype=np.float32
        )
        batch = chunks_of(frames_16k, 128)
        if batch.shape[0] > 0:
            emb = effnet.run(["embeddings"], {"melspectrogram": batch})[0]
            emb1280 = emb.mean(axis=0).astype(np.float32)[np.newaxis, :]
            if aggr_sess is not None:
                act = aggr_sess.run(["activations"], {"embeddings": emb1280})[0].flatten()
                aggressive_score = float(act[0])
            if eng_sess is not None:
                act = eng_sess.run(["activations"], {"embeddings": emb1280})[0].flatten()
                engagement_score = float(act[0])
            if appr_sess is not None:
                act = appr_sess.run(["activations"], {"embeddings": emb1280})[0].flatten()
                approachability_score = float(act[0])

    # Arousal on drop (vggish tower — reuses drop_16k)
    if vggish_sess is not None and emo_sess is not None and len(drop_16k) >= 16000 * 2:
        from essentia.standard import TensorflowInputVGGish
        melv = TensorflowInputVGGish()
        fsv = np.asarray(
            [melv(f) for f in FrameGenerator(drop_16k, frameSize=400, hopSize=200)],
            dtype=np.float32
        )
        pv = chunks_of(fsv, 96)
        if pv.shape[0] > 0:
            pv = pv.transpose(0, 2, 1)
            vemb = vggish_sess.run(["embeddings"], {"melspectrogram": pv})[0]
            v128 = vemb.mean(axis=0).astype(np.float32)[np.newaxis, :]
            va = emo_sess.run(["activations"], {"embeddings": v128})[0].flatten()
            arousal_drop_score = float(va[1])

    return {
        "onsets_per_beat": round(onsets_per_beat, 3),
        "bpm": round(bpm, 1),
        "hf_energy_re_lufs": round(hf_energy_re_lufs, 3),
        "low_energy_re_lufs": round(low_energy_re_lufs, 3),
        "crest_factor": round(crest_factor, 3),
        "spectral_flux": round(spectral_flux, 3),
        "lufs_drop": round(lufs_drop, 1),
        "spectral_centroid": round(spectral_centroid, 1),
        "aggressive": round(aggressive_score, 4),
        "engagement": round(engagement_score, 4),
        "approachability": round(approachability_score, 4),
        "arousal_drop": round(arousal_drop_score, 2),
        "drop_start_s": round(drop_start, 2),
        "drop_end_s": round(drop_end, 2),
        "drop_contrast_db": round(drop_contrast_db, 1),
        "low_drop_contrast": low_drop_contrast,
    }

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    path = "?"
    try:
        inp = json.loads(line)
        path = inp.get("path", "?")
        features = extract_features(
            path, inp["drop_start"], inp["drop_end"], inp["bpm"]
        )
        print(json.dumps({"path": path, "features": features}), flush=True)
    except Exception as ex:
        print(json.dumps({"path": path, "error": str(ex)[:200]}), flush=True)
`;

/** Parse one JSON line from the energy extractor. */
export function parseExtractLine(line: string): EnergyExtractResult | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj.path !== "string") return null;
    if (typeof obj.error === "string") {
      return { path: obj.path, error: obj.error };
    }
    if (obj.features && typeof obj.features === "object") {
      const result: EnergyExtractResult = {
        path: obj.path,
        features: obj.features as NonNullable<EnergyExtractResult["features"]>,
      };
      return result;
    }
    return { path: obj.path, error: "missing features" };
  } catch {
    return null;
  }
}

/** Convert an extraction result to a DB row. */
export function extractResultToRow(
  videoId: string,
  r: NonNullable<EnergyExtractResult["features"]>,
): EnergyFeatureRow {
  return {
    videoId,
    onsetsPerBeat: r.onsets_per_beat,
    bpm: r.bpm,
    hfEnergyReLufs: r.hf_energy_re_lufs,
    lowEnergyReLufs: r.low_energy_re_lufs,
    crestFactor: r.crest_factor,
    spectralFlux: r.spectral_flux,
    lufsDrop: r.lufs_drop,
    spectralCentroid: r.spectral_centroid,
    aggressive: r.aggressive,
    engagement: r.engagement,
    approachability: r.approachability,
    arousalDrop: r.arousal_drop,
    dropStartS: r.drop_start_s,
    dropEndS: r.drop_end_s,
    dropContrastDb: r.drop_contrast_db,
    lowDropContrast: r.low_drop_contrast,
  };
}

/** The inline Python extractor script. */
export function getEnergyScript(): string {
  return ENERGY_SCRIPT;
}

/** All ONNX models the energy extractor needs. */
const ENERGY_MODELS = [
  "discogs-effnet-bsdynamic-1.onnx",
  "audioset-vggish-3.onnx",
  "mood_aggressive-discogs-effnet-1.onnx",
  "engagement_regression-discogs-effnet-1.onnx",
  "approachability_regression-discogs-effnet-1.onnx",
  "emomusic-audioset-vggish-2.onnx",
] as const;

/** Check that all energy ONNX models are present. */
export function energyModelsPresent(): boolean {
  return ENERGY_MODELS.every((f) => existsSync(`${MODEL_DIR}/${f}`));
}

/** Download any missing energy-specific models. Returns filenames fetched. */
export async function energyModelsEnsure(): Promise<string[]> {
  const MODEL_BASE = "https://essentia.upf.edu/models";
  const heads: Record<string, string> = {
    "discogs-effnet-bsdynamic-1.onnx":
      "feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx",
    "audioset-vggish-3.onnx": "feature-extractors/vggish/audioset-vggish-3.onnx",
    "mood_aggressive-discogs-effnet-1.onnx":
      "classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1.onnx",
    "engagement_regression-discogs-effnet-1.onnx":
      "classification-heads/engagement/engagement_regression-discogs-effnet-1.onnx",
    "approachability_regression-discogs-effnet-1.onnx":
      "classification-heads/approachability/approachability_regression-discogs-effnet-1.onnx",
    "emomusic-audioset-vggish-2.onnx":
      "classification-heads/emomusic/emomusic-audioset-vggish-2.onnx",
  };
  const { mkdirSync } = await import("node:fs");
  mkdirSync(MODEL_DIR, { recursive: true });
  const fetched: string[] = [];
  for (const [filename, urlPath] of Object.entries(heads)) {
    const dest = `${MODEL_DIR}/${filename}`;
    if (existsSync(dest)) continue;
    const url = `${MODEL_BASE}/${urlPath}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    await Bun.write(dest, buf);
    fetched.push(filename);
  }
  return fetched;
}
