// shelf-dedupe-probe.ts — the measurement primitives behind the dedupe
// ladder (md5, fpcalc fingerprint, quality rank). Split from shelf-dedupe.ts
// so the verdict logic and the probes read (and test) separately.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

/** MD5 in-process (node:crypto), NOT via the macOS `md5` CLI: under bun
 *  test --parallel=16 the spawnSync can fail under process pressure and a
 *  null hash silently reclassified byte-identical twins as keep-both
 *  (flaky suite, flake reproduced twice). Identical bytes still mean the
 *  same thing — we just compute the digest ourselves. */
export function md5(path: string): string | null {
  try {
    const h = createHash("md5");
    h.update(readFileSync(path));
    return h.digest("hex");
  } catch {
    // unreadable file: caller treats null as "cannot prove identical"
    return null;
  }
}

/** Chromaprint acoustic fingerprint (fpcalc -length 120). */
export function fingerprint(path: string): string | null {
  const r = spawnSync("fpcalc", ["-length", "120", path]);
  if (r.status !== 0) return null;
  const m = r.stdout.toString().match(/FINGERPRINT=([A-Za-z0-9=/]+)/);
  const fp = m?.[1];
  return fp ?? null;
}

/** Quality ladder for "which rip is the keeper" (higher wins). Extension
 *  ranks; ffprobe bitrate as tiebreak inside lossy formats. */
export function qualityRank(path: string): number {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const extRank: Record<string, number> = {
    ".aiff": 4,
    ".aif": 4,
    ".flac": 4,
    ".wav": 3,
    ".m4a": 1,
    ".mp3": 1,
  };
  let rank = extRank[ext] ?? 0;
  const probe = spawnSync("ffprobe", [
    "-v",
    "quiet",
    "-show_entries",
    "format=bit_rate",
    "-of",
    "csv=p=0",
    path,
  ]);
  if (probe.status === 0) {
    const br = Number(probe.stdout.toString().trim());
    if (Number.isFinite(br) && br > 0) rank += br / 10_000_000; // 320k ≈ +0.032
  }
  return rank;
}
