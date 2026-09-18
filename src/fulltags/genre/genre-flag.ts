// genre-flag.ts — the demote-and-flag pass (genre-audit §5b.3 step 2).
//
// A label that contradicts a UNANIMOUS kNN consensus is probably wrong:
// every audio neighbour says the same family and the stored label says
// something else. The pass does NOT rewrite the column (labels come from
// real sources; rewriting is a human decision) — it writes
// `genre_flag='disputed'` so the bad label (a) stops seeding inference
// votes (state_tracks.genreSeeds excludes it) and (b) surfaces in the
// census for human review. Rows whose neighbourhood agrees with them,
// or whose vote is split (no quorum), stay untouched — disagreement
// without unanimity is not evidence of a bad label.
//
// The LOO harness (`evalLeaveOneOut`) is the vote engine: each row is
// held out in turn and the rest vote. A row is DISPUTED when the gate
// returned a prediction (quorum existed), that prediction differs from
// the row's family, AND the ungated vote was unanimous (agreement 1.0 —
// every one of the k neighbours said the same thing).
//
// Pure — no DB, no IO; genre.ts wires it into `--flag`.

import type { EvalSummary } from "../../archive/similar";

/** One disputed row: identity + the evidence (what the audio said, how
 *  hard it said it). JSON-serializable for the summary output. */
export interface DisputedRow {
  videoId: string;
  /** The row's scoring family (what the label claims). */
  family: string;
  /** The unanimous consensus family (what the audio says). */
  consensus: string;
  /** Number of seeded rows in this pass. */
  evaluated: number;
  /** sanity: always 1.0 for disputed rows. */
  agreement: number;
}

export interface FlagPassResult {
  /** Rows assessed (the eval population). */
  evaluated: number;
  /** Rows flagged 'disputed'. */
  disputed: number;
  /** Rows whose label survived a unanimous consensus (healthy). */
  upheld: number;
  /** Rows with a split vote or refusal — no evidence either way. */
  noQuorum: number;
  rows: DisputedRow[];
}

/** Classify the LOO outcome rows into disputed / upheld / no-quorum.
 *  Disputed = gated prediction exists, differs from the family, and the
 *  vote was unanimous. `summary.rows` carries agreement per row. */
export function classifyDisputes(summary: EvalSummary): FlagPassResult {
  const rows: DisputedRow[] = [];
  let disputed = 0;
  let upheld = 0;
  let noQuorum = 0;
  for (const row of summary.rows) {
    if (row.predicted === null || row.agreement < 1) {
      noQuorum++;
      continue;
    }
    if (row.predicted !== row.family) {
      disputed++;
      rows.push({
        videoId: row.videoId,
        family: row.family,
        consensus: row.predicted,
        evaluated: summary.evaluated,
        agreement: row.agreement,
      });
      continue;
    }
    upheld++;
  }
  return { evaluated: summary.evaluated, disputed, upheld, noQuorum, rows };
}
