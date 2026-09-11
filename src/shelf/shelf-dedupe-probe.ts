// shelf-dedupe-probe.ts — the measurement primitives behind the dedupe
// ladder (md5, fpcalc fingerprint, quality rank). Split from shelf-dedupe.ts
// so the verdict logic and the probes read (and test) separately.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fingerprintFileLength } from "../../fulltags/src/exports";

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

/** Chromaprint acoustic fingerprint — the ONE spawn+parse lives in
 *  FullTags (fingerprintFileLength, `fpcalc -length 120`). Its base64url
 *  parse keeps `-`/`_`: a char class without them truncated at the first
 *  hyphen and unrelated files sharing the prefix collided into fake
 *  duplicate groups (the Sep 11 mass-collision; now regression-pinned in
 *  shelf-dupescan.test.ts against the single implementation). */
export function fingerprint(path: string): string | null {
  return fingerprintFileLength(path);
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
