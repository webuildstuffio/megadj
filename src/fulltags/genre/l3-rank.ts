/**
 * l3-rank.ts — L3 ranked subgenres with calibrated probabilities (B5.4).
 *
 * Given a Dawid-Skene posterior over L2 families, and raw evidence strings
 * that often carry L3 specificity (e.g. "deep house" within "house"),
 * this module ranks L3 subgenres by their posterior-weighted evidence mass.
 *
 * The L3 ranking is subordinate to the L2 result:
 * - Only L3 candidates within the elected L2 family are ranked
 * - Calibrated probabilities from the temperature-scaled posterior
 * - The top-1 L3 subgenre + confidence is what enters the booth comment
 */
import { FAMILY_SUBGENRES, type GenreFamily } from "./taxonomy-v3";
import { round3 } from "../../shared/leaf/fmt";

/** Evidence that carries L3 specificity. */
export interface L3Evidence {
  /** The raw genre string from the source (e.g. "deep house"). */
  readonly rawGenre: string;
  /** The L2 family it maps to (e.g. "house"). */
  readonly family: string;
  /** Evidence weight (from the vote system). */
  readonly weight: number;
}

/** A ranked L3 subgenre. */
export interface L3Ranked {
  /** Canonical L3 subgenre name. */
  readonly subgenre: string;
  /** Parent L2 family. */
  readonly family: string;
  /** Probability (calibrated, sums to ≤ 1 within family). */
  readonly probability: number;
  /** Number of evidence votes contributing. */
  readonly voteCount: number;
}

/**
 * Rank L3 subgenres within the elected L2 family.
 *
 * @param family - The elected L2 family
 * @param familyPosterior - Calibrated posterior probability for this family
 * @param evidence - All evidence rows (pre-filtered or not)
 * @param maxResults - Max L3 results to return (default: 5)
 * @returns Ranked L3 subgenres, descending by probability
 */
export function rankL3(
  family: GenreFamily,
  familyPosterior: number,
  evidence: readonly L3Evidence[],
  maxResults = 5,
): L3Ranked[] {
  const subgenres = FAMILY_SUBGENRES[family];
  if (!subgenres || subgenres.length === 0) return [];

  // Accumulate evidence per L3 subgenre
  const scores = new Map<string, { weight: number; count: number }>();

  for (const e of evidence) {
    if (e.family !== family) continue;
    const lower = e.rawGenre.toLowerCase().trim();

    // Find which L3 subgenre this raw string matches
    for (const sub of subgenres) {
      if (lower === sub || lower.includes(sub) || sub.includes(lower)) {
        const existing = scores.get(sub);
        if (existing) {
          existing.weight += e.weight;
          existing.count++;
        } else {
          scores.set(sub, { weight: e.weight, count: 1 });
        }
        break;
      }
    }
  }

  if (scores.size === 0) {
    // No L3 evidence — return the family-level subgenres with uniform priors
    return subgenres.slice(0, maxResults).map((sub) => ({
      subgenre: sub,
      family,
      probability: round3(familyPosterior / subgenres.length),
      voteCount: 0,
    }));
  }

  // Normalize weights to probabilities within the family posterior
  const totalWeight = [...scores.values()].reduce(
    (acc, s) => acc + s.weight,
    0,
  );

  const ranked: L3Ranked[] = [...scores.entries()]
    .map(([sub, s]) => ({
      subgenre: sub,
      family,
      probability: round3((s.weight / totalWeight) * familyPosterior),
      voteCount: s.count,
    }))
    .toSorted((a, b) => b.probability - a.probability);

  return ranked.slice(0, maxResults);
}
