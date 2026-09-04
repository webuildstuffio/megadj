/** DJ energy rating derived from RMS loudness (ingest-time, stored once). */
import { $ } from "bun";

/**
 * Crude DJ "energy" rating (1–10) from integrated loudness — same idea as
 * Mixed In Key's energy column: how hard a track hits, for set planning.
 * RMS dBFS typical range -25 (chill) .. -8 (banger) mapped linearly.
 * rekordbox/MatchMySound do fancier analysis; this is a sortable baseline.
 */
export function energyFromLufs(rmsDb: number | null): number | null {
  if (rmsDb === null || Number.isNaN(rmsDb)) return null;
  const clamped = Math.min(-8, Math.max(-25, rmsDb));
  return Math.round((1 + ((clamped + 25) / 17) * 9) * 10) / 10;
}

/** Integrated RMS level (dBFS) via ffmpeg astats; null on failure. */
export async function measureRms(file: string): Promise<number | null> {
  const proc =
    await $`ffmpeg -hide_banner -nostats -i ${file} -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) return null;
  const out = proc.stderr.toString();
  const m = /RMS level dB:\s*(-?[\d.]+)/.exec(out);
  return m?.[1] ? Number(m[1]) : null;
}
