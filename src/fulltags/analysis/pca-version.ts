/**
 * pca-version.ts — PCA basis versioning for per-bar embeddings (B2.4).
 *
 * Tracks the PCA projection basis used to reduce per-bar embeddings
 * from full dimension (e.g. 768) to compact dimension (256).
 * When the basis changes (new training data, different model), all
 * bar_features need re-projection.
 *
 * Version string format: "pca-v{N}-{model}-{dim}"
 * Example: "pca-v1-discogs-256"
 */
import { round3 } from "../../shared/leaf/fmt";

/** PCA basis metadata. */
export interface PcaBasis {
  /** Version string (e.g. "pca-v1-discogs-256"). */
  readonly version: string;
  /** Source model name (e.g. "discogs"). */
  readonly sourceModel: string;
  /** Original embedding dimension. */
  readonly inputDim: number;
  /** Output (reduced) dimension. */
  readonly outputDim: number;
  /** Explained variance ratio (0–1). */
  readonly explainedVariance: number;
  /** Number of training samples used. */
  readonly trainingSamples: number;
  /** Date the basis was computed. */
  readonly computedAt: string;
}

/**
 * Build a PCA version string.
 */
export function pcaVersionString(version: number, model: string, dim: number): string {
  return `pca-v${version}-${model}-${dim}`;
}

/**
 * Parse a PCA version string.
 * Returns null if the string doesn't match the expected format.
 */
export function parsePcaVersion(
  versionStr: string,
): { version: number; model: string; dim: number } | null {
  const match = versionStr.match(/^pca-v(\d+)-(.+)-(\d+)$/);
  if (!match) return null;
  const version = Number(match[1]);
  const model = match[2]!;
  const dim = Number(match[3]);
  if (!Number.isFinite(version) || !Number.isFinite(dim)) return null;
  return { version, model, dim };
}

/**
 * Check if a bar_features row's PCA version matches the current basis.
 */
export function pcaVersionMatches(rowVersion: string | null, currentBasis: PcaBasis): boolean {
  if (rowVersion === null) return false;
  return rowVersion === currentBasis.version;
}

/**
 * Compute the fraction of bar_features rows that need re-projection.
 */
export function reprojectionNeeded(
  versions: readonly (string | null)[],
  currentBasis: PcaBasis,
): { stale: number; current: number; ratio: number } {
  let stale = 0;
  let current = 0;
  for (const v of versions) {
    if (pcaVersionMatches(v, currentBasis)) {
      current++;
    } else {
      stale++;
    }
  }
  const total = stale + current;
  return { stale, current, ratio: total > 0 ? round3(stale / total) : 0 };
}
