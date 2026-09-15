// shelf-dedupe-probe.ts — the measurement primitives behind the dedupe
// ladder (md5, fpcalc fingerprint, quality rank). Split from shelf-dedupe.ts
// so the verdict logic and the probes read (and test) separately.
import { md5FileChunked } from "../shared/hash";
import { fingerprintFileLength, probeMediaSync } from "../../fulltags/src/exports";

/** MD5 in-process via the shared chunked seam (src/shared/hash.ts, issue
 *  #70): 300 MB WAV sets never enter memory whole, and under bun
 *  test --parallel=16 we do NOT shell out to the macOS `md5` CLI — a
 *  spawnSync failure under process pressure silently reclassified
 *  byte-identical twins as keep-both (flake reproduced twice). Identical
 *  bytes still mean the same thing — we compute the digest ourselves. */
export function md5(path: string): string | null {
  return md5FileChunked(path);
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
 *  ranks; ffprobe bitrate as tiebreak inside lossy formats. The probe is
 *  THE media seam (fulltags probeMediaSync): one spawn style, guarded
 *  JSON boundary, null-degrade keeps the ext rank untouched on failure. */
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
  const probe = probeMediaSync(path);
  const kbps = probe?.bitrateKbps ?? null;
  if (kbps !== null) rank += (kbps * 1000) / 10_000_000; // 320k ≈ +0.032
  return rank;
}
