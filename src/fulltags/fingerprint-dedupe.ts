/**
 * ingest acoustic dedupe — chromaprint fingerprint matching in the intake
 * path (name-blind), the same guarantee `shelf-dupescan` gives the shelf:
 * the same recording under a different name/container/bitrate still
 * matches, because the fingerprint hashes the decoded audio.
 *
 * Verdict rules (never delete — quarantine only):
 *  - fp equal + names token-similar (≥0.5) → dupe, loser quarantines
 *  - fp equal + names dissimilar → possible long-mix fp collision —
 *    surfaced, kept (human review, mirrors shelf-dupescan's skip rule)
 *  - fpcalc missing/fails → degrade to null, pass is a no-op
 */
import { fingerprintFile } from "./fingerprint";
import { sharedTokenRatio } from "./name-match";

export interface FpVerdict {
  /** acoustic fingerprint, or null when fpcalc failed/missing */
  fp: string | null;
  /** same fp as `other` AND names similar enough to call it a dupe */
  dupe: boolean;
  /** same fp but name-dissimilar → possible collision, keep both */
  suspicious: boolean;
}

/** Cheap name similarity (0..1): shared-token ratio over token sets.
 * "Back To Friends (X Remix) [Radio Edit]" vs a mislabeled twin still
 * shares most tokens; an unrelated track shares few. Delegates to the
 * ONE implementation (sharedTokenRatio in name-match.ts, issue #85) —
 * the local body was its byte-equivalent twin. */
export function nameSimilarityTokens(a: string, b: string): number {
  return sharedTokenRatio(a, b);
}

export async function compareFingerprint(
  file: string,
  other: string,
): Promise<FpVerdict> {
  const fp = fingerprintFile(file);
  if (!fp) return { fp: null, dupe: false, suspicious: false };
  const otherFp = fingerprintFile(other);
  if (!otherFp) return { fp, dupe: false, suspicious: false };
  if (fp !== otherFp) return { fp, dupe: false, suspicious: false };
  const similar =
    nameSimilarityTokens(
      file.split("/").pop() ?? "",
      other.split("/").pop() ?? "",
    ) >= 0.5;
  return { fp, dupe: similar, suspicious: !similar };
}
