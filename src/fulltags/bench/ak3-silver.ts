/**
 * ak3-silver.ts — AK3 verified-store silver builder (B6.3).
 *
 * Builds a "silver" answer key set from store-sourced genre labels:
 * for each track, hold out one source and check if the remaining sources
 * agree with the held-out source's label. Tracks where leave-source-out
 * agreement is high (≥ 2 concordant sources) become silver keys.
 *
 * The silver set is weaker than gold (human-verified) but stronger than
 * raw evidence — it's used for calibration and bench evaluation when
 * gold keys are unavailable.
 */
import { round3 } from "../../shared/leaf/fmt";

/** A store-sourced genre label for one track. */
export interface StoreLabel {
  readonly trackId: string;
  readonly source: string;
  readonly family: string;
}

/** A silver answer key produced by leave-source-out agreement. */
export interface SilverKey {
  readonly trackId: string;
  /** The agreed-upon family. */
  readonly family: string;
  /** Number of concordant sources. */
  readonly concordantSources: number;
  /** Total sources for this track. */
  readonly totalSources: number;
  /** Agreement ratio (concordant / total). */
  readonly agreement: number;
  /** Sources that agreed. */
  readonly agreeSources: readonly string[];
}

/** Result from building the silver set. */
export interface SilverBuildResult {
  /** Silver keys that passed the agreement threshold. */
  readonly keys: readonly SilverKey[];
  /** Tracks with insufficient agreement (dropped). */
  readonly dropped: number;
  /** Total tracks considered. */
  readonly total: number;
}

/**
 * Build silver answer keys from store labels using leave-source-out.
 *
 * @param labels - All store-sourced genre labels
 * @param minSources - Minimum concordant sources (default: 2)
 * @param minAgreement - Minimum agreement ratio (default: 0.6)
 * @returns Silver keys and build statistics
 */
export function buildSilverKeys(
  labels: readonly StoreLabel[],
  minSources = 2,
  minAgreement = 0.6,
): SilverBuildResult {
  // Group labels by track
  const byTrack = new Map<string, StoreLabel[]>();
  for (const l of labels) {
    const arr = byTrack.get(l.trackId) ?? [];
    arr.push(l);
    byTrack.set(l.trackId, arr);
  }

  const keys: SilverKey[] = [];
  let dropped = 0;

  for (const [trackId, trackLabels] of byTrack) {
    if (trackLabels.length < 2) {
      dropped++;
      continue;
    }

    // Count votes per family
    const familyCounts = new Map<string, string[]>();
    for (const l of trackLabels) {
      const arr = familyCounts.get(l.family) ?? [];
      arr.push(l.source);
      familyCounts.set(l.family, arr);
    }

    // Find the majority family
    let bestFamily = "";
    let bestSources: string[] = [];
    for (const [family, sources] of familyCounts) {
      if (sources.length > bestSources.length) {
        bestFamily = family;
        bestSources = sources;
      }
    }

    const agreement = round3(bestSources.length / trackLabels.length);
    if (bestSources.length >= minSources && agreement >= minAgreement) {
      keys.push({
        trackId,
        family: bestFamily,
        concordantSources: bestSources.length,
        totalSources: trackLabels.length,
        agreement,
        agreeSources: bestSources,
      });
    } else {
      dropped++;
    }
  }

  return { keys, dropped, total: byTrack.size };
}
