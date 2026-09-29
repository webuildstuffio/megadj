/**
 * ak5-modes.ts — AK5 CrateDeck answer key modes (B6.5).
 *
 * Three modes for building answer keys through CrateDeck UI:
 *
 * 1. **Dispute mode**: Show genre-why v2 + review queue item → user
 *    confirms or overrides the elected genre → verified answer key
 *
 * 2. **Triplet mode**: Show 3 tracks, user ranks by similarity →
 *    builds relative similarity ground truth for the bench
 *
 * 3. **Energy pair mode**: Show 2 tracks, user picks the more energetic →
 *    pairwise energy judgment for the Bradley-Terry model (B7.2)
 */

/** A dispute verdict from the user. */
export interface DisputeVerdict {
  readonly trackId: string;
  readonly proposedFamily: string;
  /** User's chosen family (same as proposed = confirm, different = override). */
  readonly chosenFamily: string;
  readonly confirmed: boolean;
  readonly timestamp: string;
}

/** A triplet similarity judgment. */
export interface TripletJudgment {
  readonly anchorId: string;
  readonly moreSimId: string;
  readonly lessSimId: string;
  readonly timestamp: string;
}

/** An energy pair judgment. */
export interface EnergyPairJudgment {
  readonly winnerId: string;
  readonly loserId: string;
  readonly timestamp: string;
}

/** Session state for a CrateDeck AK5 session. */
export interface AK5Session {
  readonly mode: "dispute" | "triplet" | "energy-pair";
  readonly disputes: readonly DisputeVerdict[];
  readonly triplets: readonly TripletJudgment[];
  readonly energyPairs: readonly EnergyPairJudgment[];
  readonly startedAt: string;
}

/**
 * Create a new AK5 session.
 */
export function createAK5Session(
  mode: "dispute" | "triplet" | "energy-pair",
): AK5Session {
  return {
    mode,
    disputes: [],
    triplets: [],
    energyPairs: [],
    startedAt: new Date().toISOString(),
  };
}

/**
 * Add a dispute verdict to the session.
 */
export function addDispute(
  session: AK5Session,
  verdict: DisputeVerdict,
): AK5Session {
  return {
    ...session,
    disputes: [...session.disputes, verdict],
  };
}

/**
 * Add a triplet judgment to the session.
 */
export function addTriplet(
  session: AK5Session,
  judgment: TripletJudgment,
): AK5Session {
  return {
    ...session,
    triplets: [...session.triplets, judgment],
  };
}

/**
 * Add an energy pair judgment to the session.
 */
export function addEnergyPair(
  session: AK5Session,
  judgment: EnergyPairJudgment,
): AK5Session {
  return {
    ...session,
    energyPairs: [...session.energyPairs, judgment],
  };
}

/**
 * Compute session statistics.
 */
export function sessionStats(session: AK5Session): {
  total: number;
  overrides: number;
  confirmRate: number;
} {
  const total =
    session.disputes.length +
    session.triplets.length +
    session.energyPairs.length;
  const overrides = session.disputes.filter((d) => !d.confirmed).length;
  const disputeConfirmRate =
    session.disputes.length > 0
      ? (session.disputes.length - overrides) / session.disputes.length
      : 0;
  return { total, overrides, confirmRate: disputeConfirmRate };
}
