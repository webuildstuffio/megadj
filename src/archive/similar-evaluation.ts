/**
 * Pure support for the embedding leave-one-out evaluators.  The evaluators
 * keep their public API in similar.ts; this leaf owns shared result shaping,
 * duration eligibility, and deterministic vote-tally ordering.
 */
export interface LoORowOutcome {
  videoId: string;
  family: string;
  /** Gated vote result (null = the gate refused). */
  predicted: string | null;
  agreement: number;
  /** Best-two families by vote tally. */
  top2: string[];
}

/** The numeric outcome of one leave-one-out evaluation pass. */
export interface EvalSummary {
  evaluated: number;
  agree: number;
  disagree: number;
  refused: number;
  agreement: number;
  refusal: number;
  ungatedAgreement: number;
  rows: LoORowOutcome[];
}

/** Absent or null durations are unknown and remain eligible. */
export function evalDurationBand(
  durationGuard: { videoId: string; durationS: number | null }[],
): (id: string) => boolean {
  const guard = new Map(durationGuard.map((d) => [d.videoId, d.durationS]));
  return (id: string): boolean => {
    const sec = guard.get(id);
    return sec === undefined || sec === null || (sec >= 90 && sec <= 480);
  };
}

export function newEvalSummary(evaluated: number): EvalSummary {
  return {
    evaluated,
    agree: 0,
    disagree: 0,
    refused: 0,
    agreement: 0,
    refusal: 0,
    ungatedAgreement: 0,
    rows: [],
  };
}

export function closeEvalSummary(
  summary: EvalSummary,
  popLen: number,
  ungatedAgree: number,
): EvalSummary {
  const gated = summary.agree + summary.disagree;
  summary.agreement = gated > 0 ? summary.agree / gated : 0;
  summary.refusal = popLen > 0 ? summary.refused / popLen : 0;
  summary.ungatedAgreement = popLen > 0 ? ungatedAgree / popLen : 0;
  return summary;
}

/** Count descending, then alphabetical, so tied votes are reproducible. */
export function tallySorted(tally: Map<string, number>): [string, number][] {
  return [...tally.entries()].toSorted(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}
