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
import { fingerprintFile } from "./analysis";

export interface FpVerdict {
  /** acoustic fingerprint, or null when fpcalc failed/missing */
  fp: string | null;
  /** same fp as `other` AND names similar enough to call it a dupe */
  dupe: boolean;
  /** same fp but name-dissimilar → possible collision, keep both */
  suspicious: boolean;
}

/** Token-set normalizer for name similarity: lowercase, strip extension,
 *  collapse separators to single spaces. Pure — module-level. */
const normTokens = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Cheap name similarity (0..1): shared-token ratio over token sets.
 * "Back To Friends (X Remix) [Radio Edit]" vs a mislabeled twin still
 * shares most tokens; an unrelated track shares few. */
export function nameSimilarityTokens(a: string, b: string): number {
  const at = new Set(normTokens(a).split(" ").filter(Boolean));
  const bt = new Set(normTokens(b).split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.max(at.size, bt.size);
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
