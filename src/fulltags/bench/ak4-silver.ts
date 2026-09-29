/**
 * ak4-silver.ts — AK4 agent-researched silver (B6.4).
 *
 * The AK4 dataset is a curated set of ~300 "hard cases" — tracks where
 * the genre vote ladder disagrees with at least one source, or where
 * the confidence is low.
 *
 * An agent researches each case (store pages, artist bios, label catalogs,
 * release context) and produces a silver-standard label with provenance.
 * These serve as the tiebreaker evaluation set for the Dawid-Skene
 * estimator.
 */
import { round3 } from "../../shared/leaf/fmt";
import type { GenreFamily } from "../genre/taxonomy-v3";

/** Evidence gathered for one hard case. */
export interface AK4Evidence {
  readonly trackId: string;
  /** Sources consulted (e.g. "beatport", "bandcamp", "discogs"). */
  readonly sources: readonly string[];
  /** Reasoning for the label. */
  readonly reasoning: string;
  /** Confidence in the silver label (0–1). */
  readonly confidence: number;
  /** The silver-standard L2 family. */
  readonly silverFamily: GenreFamily;
  /** Optional L3 subgenre. */
  readonly silverSubgenre: string | null;
}

/** AK4 evaluation result. */
export interface AK4EvalResult {
  readonly totalCases: number;
  /** Agreement between estimator and silver labels. */
  readonly agreement: number;
  /** Cases where estimator is more specific (L3 match). */
  readonly l3Enrichment: number;
  /** Cases where estimator disagrees (potential errors). */
  readonly disputes: number;
  /** Mean confidence of silver labels. */
  readonly meanSilverConfidence: number;
}

/**
 * Evaluate estimator outputs against AK4 silver labels.
 */
export function evaluateAK4(
  silverLabels: readonly AK4Evidence[],
  estimatorResults: ReadonlyMap<
    string,
    { family: GenreFamily; subgenre: string | null }
  >,
): AK4EvalResult {
  if (silverLabels.length === 0) {
    return {
      totalCases: 0,
      agreement: 0,
      l3Enrichment: 0,
      disputes: 0,
      meanSilverConfidence: 0,
    };
  }

  let familyMatch = 0;
  let l3Match = 0;
  let disputes = 0;
  let confSum = 0;
  let matched = 0;

  for (const s of silverLabels) {
    confSum += s.confidence;
    const est = estimatorResults.get(s.trackId);
    if (est === undefined) continue;
    matched++;

    if (est.family === s.silverFamily) {
      familyMatch++;
      if (
        s.silverSubgenre !== null &&
        est.subgenre !== null &&
        est.subgenre === s.silverSubgenre
      ) {
        l3Match++;
      }
    } else {
      disputes++;
    }
  }

  return {
    totalCases: silverLabels.length,
    agreement: matched > 0 ? round3(familyMatch / matched) : 0,
    l3Enrichment: matched > 0 ? round3(l3Match / matched) : 0,
    disputes,
    meanSilverConfidence: round3(confSum / silverLabels.length),
  };
}

/**
 * Identify which tracks need AK4 silver labeling.
 * Criteria: low confidence + source disagreement.
 */
export function identifyHardCases(
  tracks: readonly {
    trackId: string;
    confidence: number;
    sourceAgreement: number;
  }[],
  maxCases = 300,
  confidenceThreshold = 0.6,
  agreementThreshold = 0.5,
): string[] {
  return tracks
    .filter(
      (t) =>
        t.confidence < confidenceThreshold ||
        t.sourceAgreement < agreementThreshold,
    )
    .toSorted((a, b) => a.confidence - b.confidence)
    .slice(0, maxCases)
    .map((t) => t.trackId);
}
