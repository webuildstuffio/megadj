/**
 * vocal-zones.ts — VOX/HOOK vocal clash detection from Demucs stems.
 *
 * Reads the cached vocals stem, computes per-bar RMS energy,
 * and classifies:
 *   VOX  — vocals present in intro/outro mix zones (clash risk)
 *   HOOK — vocals present in body but clean mix zones
 *   (neither) — no significant vocal energy
 *
 * Depends on the stem_cache (vocals stem) and PSSI phrase data
 * (intro/outro bar boundaries).
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { ArchiveState } from "../../core/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";
import {
  lineHasRequestId,
  lineIsReady,
  openWorkerSession,
  writeNdjsonRequest,
} from "./analysis-worker";
import { parseJsonOrNull } from "../../shared/leaf/guards";

export interface VocalZonesOptions {
  state: ArchiveState;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
}

/** Per-bar vocal RMS result from the Python worker. */
interface VocalRmsResult {
  /** RMS energy per bar (normalized 0–1). */
  barRms: number[];
  /** Total duration in seconds. */
  durationS: number;
  /** BPM used for bar segmentation. */
  bpm: number;
}

interface VocalSession {
  analyze: (req: { vocalsPath: string; bpm: number }) => Promise<VocalRmsResult | null>;
  close: () => void;
}

const VOCAL_RMS_SCRIPT = `
import json, sys, soundfile as sf, numpy as np

def bar_rms(path, bpm):
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    bar_seconds = 4 * 60.0 / bpm
    bar_samples = int(bar_seconds * sr)
    total_bars = max(1, len(audio) // bar_samples)
    rms_vals = []
    for i in range(total_bars):
        start = i * bar_samples
        end = min(start + bar_samples, len(audio))
        chunk = audio[start:end]
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        rms_vals.append(round(rms, 6))
    peak = max(rms_vals) if rms_vals else 1.0
    if peak > 0:
        rms_vals = [round(r / peak, 6) for r in rms_vals]
    return rms_vals, len(audio) / sr

sys.stdout.write(json.dumps({"type": "ready"}) + "\\n")
sys.stdout.flush()
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        continue
    req_id = req.get("id")
    try:
        rms_vals, dur = bar_rms(req["path"], req["bpm"])
        resp = {"id": req_id, "status": "ok", "bar_rms": rms_vals, "duration_s": round(dur, 2), "bpm": req["bpm"]}
    except Exception as exc:
        resp = {"id": req_id, "status": "error", "error": str(exc)}
    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
`;

async function openVocalSession(): Promise<VocalSession | null> {
  const inner = await openWorkerSession<{ vocalsPath: string; bpm: number }, VocalRmsResult>({
    spawn: () =>
      Bun.spawn({
        cmd: [
          "uv",
          "run",
          "--with",
          "soundfile",
          "--with",
          "numpy",
          "python",
          "-c",
          VOCAL_RMS_SCRIPT,
        ],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      }),
    isReady(line) {
      const parsed = parseJsonOrNull(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        (parsed as Record<string, unknown>)["type"] === "ready"
      ) {
        return true;
      }
      return lineIsReady(line);
    },
    readyTimeoutMs: 60_000,
    encodeRequest: (req, enc, proc) =>
      writeNdjsonRequest(proc, enc, { id: req.vocalsPath, path: req.vocalsPath, bpm: req.bpm }),
    isResponse: lineHasRequestId,
    responseTimeoutMs: 60_000,
    parse(line, req) {
      const obj = parseJsonOrNull(line) as Record<string, unknown> | null;
      if (obj === null || obj["id"] !== req.vocalsPath) return null;
      if (obj["status"] !== "ok") return null;
      const barRms = obj["bar_rms"];
      if (!Array.isArray(barRms)) return null;
      const durRaw = Number(obj["duration_s"]);
      const bpmRaw = Number(obj["bpm"]);
      return {
        barRms: barRms as number[],
        durationS: Number.isFinite(durRaw) ? durRaw : 0,
        bpm: Number.isFinite(bpmRaw) ? bpmRaw : 0,
      };
    },
  });

  if (inner === null) return null;
  return { analyze: inner.analyze, close: inner.close };
}

/** Threshold for "vocals present" in a bar. */
const VOCAL_THRESHOLD = 0.15;

/** Classify VOX/HOOK from per-bar vocal RMS and phrase boundaries. */
export function classifyVoxHook(
  barRms: readonly number[],
  introBars: number,
  outroBars: number,
): { vox: boolean; hook: boolean } {
  if (barRms.length === 0) return { vox: false, hook: false };

  const totalBars = barRms.length;
  const introEnd = Math.min(introBars, totalBars);
  const outroStart = Math.max(0, totalBars - outroBars);

  let introVocal = false;
  let outroVocal = false;
  let bodyVocal = false;

  for (let i = 0; i < totalBars; i++) {
    const rms = barRms[i] ?? 0;
    const hasVocal = rms >= VOCAL_THRESHOLD;
    if (i < introEnd) {
      if (hasVocal) introVocal = true;
    } else if (i >= outroStart) {
      if (hasVocal) outroVocal = true;
    } else {
      if (hasVocal) bodyVocal = true;
    }
  }

  const mixZoneVocal = introVocal || outroVocal;

  if (mixZoneVocal) return { vox: true, hook: false };
  if (bodyVocal) return { vox: false, hook: true };
  return { vox: false, hook: false };
}

/** Default mix-zone length in bars (8 bars ≈ 16 beats ≈ 15s at 128 BPM).
 *  Matches the most common DJ intro/outro structure. PSSI phrase-aware
 *  refinement can upgrade this later when ANLZ paths are indexed. */
const DEFAULT_MIX_ZONE_BARS = 8;

export async function vocalZones(opts: VocalZonesOptions): Promise<void> {
  const log = commandLog(opts);
  const { state } = opts;

  const stems = state.db
    .query(
      `SELECT sc.video_id, sc.vocals_path, sc.source_path,
              COALESCE(b.bpm_folded, b.bpm_raw) AS bpm
       FROM stem_cache sc
       JOIN beats b ON b.video_id = sc.video_id
       WHERE sc.vocals_path IS NOT NULL
         AND COALESCE(b.bpm_folded, b.bpm_raw) > 0`,
    )
    .all() as { video_id: string; vocals_path: string; source_path: string; bpm: number }[];

  const candidates = stems.filter((row) => {
    if (!existsSync(row.vocals_path)) return false;
    if (!opts.force) {
      const existing = state.db
        .query("SELECT vox_hook FROM stem_cache WHERE video_id = ?")
        .get(row.video_id) as { vox_hook: string | null } | null;
      if (existing?.vox_hook !== null && existing?.vox_hook !== undefined) return false;
    }
    return true;
  });

  log(`vocal-zones: ${candidates.length} tracks with stems + BPM`);

  const limit = opts.limit ?? candidates.length;
  const queue = candidates.slice(0, Math.max(0, limit));

  if (queue.length === 0) {
    if (opts.json)
      await writeJson({
        command: "vocal-zones",
        analyzed: 0,
        skipped: stems.length - candidates.length,
      });
    return;
  }

  if (opts.dryRun) {
    log(`dry run: would analyze ${queue.length} tracks`);
    if (opts.json)
      await writeJson({ command: "vocal-zones", dryRun: true, wouldAnalyze: queue.length });
    return;
  }

  let session: VocalSession | null = null;
  try {
    log("  starting vocal RMS worker…");
    session = await openVocalSession();
    if (session === null) {
      log("  ❌ failed to start vocal worker");
      if (opts.json)
        await writeJson({ command: "vocal-zones", error: "worker failed", analyzed: 0 });
      return;
    }
  } catch (error) {
    log(`  ❌ worker error: ${error}`);
    if (opts.json) await writeJson({ command: "vocal-zones", error: String(error), analyzed: 0 });
    return;
  }

  let analyzed = 0;
  let failed = 0;
  let voxCount = 0;
  let hookCount = 0;

  try {
    for (let i = 0; i < queue.length; i++) {
      const row = queue[i]!;
      const label = basename(row.source_path);
      log(`  [${i + 1}/${queue.length}] ${label}…`);

      const result = await session.analyze({ vocalsPath: row.vocals_path, bpm: row.bpm });
      if (result === null) {
        failed++;
        log(`  ❌ failed: ${label}`);
        session.close();
        session = await openVocalSession();
        if (session === null) {
          failed += queue.length - i - 1;
          break;
        }
        continue;
      }

      const { vox, hook } = classifyVoxHook(
        result.barRms,
        DEFAULT_MIX_ZONE_BARS,
        DEFAULT_MIX_ZONE_BARS,
      );

      const tag = vox ? "VOX" : hook ? "HOOK" : null;
      state.db
        .query("UPDATE stem_cache SET vox_hook = ? WHERE video_id = ?")
        .run(tag, row.video_id);

      if (vox) voxCount++;
      if (hook) hookCount++;
      analyzed++;

      const symbol = vox ? "🎤 VOX" : hook ? "🎵 HOOK" : "—";
      log(`  ✅ ${label} → ${symbol} (${result.barRms.length} bars)`);
    }
  } finally {
    session?.close();
  }

  log(`\nvocal-zones: ${analyzed} analyzed, ${failed} failed — ${voxCount} VOX, ${hookCount} HOOK`);

  if (opts.json) {
    await writeJson({ command: "vocal-zones", analyzed, failed, vox: voxCount, hook: hookCount });
  }
}
