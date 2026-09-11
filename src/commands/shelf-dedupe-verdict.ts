// shelf-dedupe-verdict.ts — the per-pair verdict + apply steps for
// `shelf-dedupe`, extracted so the command reads as report/apply
// orchestration and the three-stage ladder (md5 → fingerprint → keep-both)
// is one named unit per concern.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { DedupePair } from "./shelf-dedupe-types";
import { md5, fingerprint, qualityRank } from "./shelf-dedupe-probe";

/** Verdict inputs for one twin pair. */
export interface TwinPair {
  original: string;
  twin: string;
  bytesOriginal: number;
  bytesTwin: number;
}

/** Running tally the verdict pass feeds. */
export interface VerdictTally {
  byteDupes: number;
  fingerprintDupes: number;
  keepBoth: number;
}

/** The three-stage ladder for one pair: byte-MD5 first, then the acoustic
 *  fingerprint; fingerprint-identical pairs upgrade to the higher-quality
 *  side, different fingerprints are genuinely different audio (keep both).
 *  `skipFingerprint` (test seam) stops after the byte stage. */
export function judgePair(
  p: TwinPair,
  skipFingerprint: boolean,
  tally: VerdictTally,
): DedupePair {
  let verdict: DedupePair["verdict"];
  let method: string;
  let reason: string;

  const hO = md5(p.original);
  const hT = hO ? md5(p.twin) : null;
  if (hO && hO === hT) {
    tally.byteDupes++;
    verdict = "keep-original";
    method = "md5";
    reason = "byte-identical (MD5) — twin is a pure duplicate";
  } else if (skipFingerprint) {
    tally.keepBoth++;
    verdict = "keep-both";
    method = "skipped";
    reason = "bytes differ; fingerprint stage skipped";
  } else {
    const fO = fingerprint(p.original);
    const fT = fO ? fingerprint(p.twin) : null;
    if (fO && fO === fT) {
      tally.fingerprintDupes++;
      // same recording: higher quality wins
      const qO = qualityRank(p.original);
      const qT = qualityRank(p.twin);
      if (qT > qO) {
        verdict = "keep-twin";
        reason = `same fingerprint; twin is higher quality (${p.bytesTwin} vs ${p.bytesOriginal} bytes)`;
      } else {
        verdict = "keep-original";
        reason = `same fingerprint; original already >= twin quality (${p.bytesOriginal} vs ${p.bytesTwin} bytes)`;
      }
      method = "fingerprint";
    } else {
      tally.keepBoth++;
      verdict = "keep-both";
      method = "fingerprint";
      reason = "different fingerprints — genuinely different audio, keep both";
    }
  }

  const loser: string | null =
    verdict === "keep-original"
      ? p.twin
      : verdict === "keep-twin"
        ? p.original
        : null;
  return {
    original: p.original,
    twin: p.twin,
    bytesOriginal: p.bytesOriginal,
    bytesTwin: p.bytesTwin,
    method,
    verdict,
    reason,
    loser,
  };
}

/** UPGRADE apply path (keep-twin): the rekordbox DB references the
 *  ORIGINAL path, so the twin's (higher-quality) content must end up AT
 *  that path. Step 1: move the lower-quality original into quarantine
 *  under a non-colliding `.superseded-` name. Step 2: twin takes over the
 *  canonical path. Two renames = two "moved" counts. */
function applyUpgrade(
  pair: DedupePair,
  quarantine: string,
  errors: string[],
): number {
  const qName = `.superseded-${basename(pair.original)}`;
  const qDest = join(quarantine, qName);
  if (existsSync(qDest)) {
    errors.push(`${pair.original}: quarantine already has ${qName}`);
    return 0;
  }
  renameSync(pair.original, qDest);
  renameSync(pair.twin, pair.original);
  return 2;
}

/** Plain quarantine move for the loser of a keep-original verdict. */
function applyMove(
  pair: DedupePair,
  quarantine: string,
  errors: string[],
): number {
  const loser = pair.loser;
  if (!loser) return 0;
  const dest = join(quarantine, basename(loser));
  if (existsSync(dest)) {
    errors.push(`${loser}: quarantine already has ${basename(loser)}`);
    return 0;
  }
  renameSync(loser, dest);
  return 1;
}

/** Apply every decided pair (callers gate on --apply --yes BEFORE this).
 *  Returns { moved, upgraded } and collects per-pair errors — one failed
 *  rename must not stop the remaining pairs. */
export function applyPairs(
  pairs: DedupePair[],
  quarantine: string,
  errors: string[],
): { moved: number; upgraded: number } {
  mkdirSync(quarantine, { recursive: true });
  let moved = 0;
  let upgraded = 0;
  for (const pair of pairs) {
    if (!pair.loser) continue;
    try {
      if (pair.verdict === "keep-twin") {
        moved += applyUpgrade(pair, quarantine, errors);
        upgraded++;
      } else {
        moved += applyMove(pair, quarantine, errors);
      }
    } catch (e) {
      errors.push(`${pair.loser}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { moved, upgraded };
}
