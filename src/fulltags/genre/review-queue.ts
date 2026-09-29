/**
 * review-queue.ts — Genre review queue, cleanlab-style (B5.7).
 *
 * Ranks tracks by how "surprising" their genre assignment is given the
 * evidence — low-confidence or high-disagreement tracks surface first.
 *
 * The queue feeds CrateDeck's dispute mode (B6.5) where the user can
 * confirm or override genre assignments.
 *
 * Ranking signals:
 * 1. Posterior confidence (lower = more suspicious)
 * 2. Agreement ratio (fraction of evidence that agrees with the elected family)
 * 3. DB-posterior drift (elected family ≠ DB genre)
 */
import { round3 } from "../../shared/leaf/fmt";

/** A track in the review queue. */
export interface ReviewQueueItem {
  readonly trackId: string;
  readonly title: string;
  readonly artist: string;
  /** Current DB genre. */
  readonly dbGenre: string | null;
  /** Posterior-elected family. */
  readonly posteriorFamily: string;
  /** Posterior confidence (0–1). */
  readonly confidence: number;
  /** Agreement: fraction of evidence rows agreeing with the elected family. */
  readonly agreementRatio: number;
  /** Whether DB disagrees with posterior. */
  readonly isDrift: boolean;
  /** Composite suspicion score (higher = more suspicious, 0–1). */
  readonly suspicion: number;
}

/** Evidence summary for computing agreement. */
export interface EvidenceSummary {
  readonly trackId: string;
  readonly title: string;
  readonly artist: string;
  readonly dbGenre: string | null;
  readonly posteriorFamily: string;
  readonly posteriorConfidence: number;
  /** All evidence family labels (including nulls for unmapped). */
  readonly evidenceFamilies: readonly (string | null)[];
}

/**
 * Build the review queue from evidence summaries.
 *
 * Ranks by suspicion score: a weighted combination of low confidence,
 * low agreement, and drift.
 *
 * @param summaries - Per-track evidence summaries
 * @param maxItems - Maximum queue size (default: 100)
 * @returns Ranked review queue (most suspicious first)
 */
export function buildReviewQueue(
  summaries: readonly EvidenceSummary[],
  maxItems = 100,
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = summaries.map((s) => {
    const agreeing = s.evidenceFamilies.filter(
      (f) => f === s.posteriorFamily,
    ).length;
    const total = s.evidenceFamilies.filter((f) => f !== null).length;
    const agreementRatio = total > 0 ? agreeing / total : 0;
    const isDrift = s.dbGenre !== null && s.dbGenre !== s.posteriorFamily;

    // Suspicion: low confidence + low agreement + drift penalty
    const confidenceTerm = 1 - s.posteriorConfidence;
    const agreementTerm = 1 - agreementRatio;
    const driftPenalty = isDrift ? 0.3 : 0;
    const suspicion = round3(
      Math.min(1, 0.4 * confidenceTerm + 0.3 * agreementTerm + driftPenalty),
    );

    return {
      trackId: s.trackId,
      title: s.title,
      artist: s.artist,
      dbGenre: s.dbGenre,
      posteriorFamily: s.posteriorFamily,
      confidence: round3(s.posteriorConfidence),
      agreementRatio: round3(agreementRatio),
      isDrift,
      suspicion,
    };
  });

  return items.toSorted((a, b) => b.suspicion - a.suspicion).slice(0, maxItems);
}
