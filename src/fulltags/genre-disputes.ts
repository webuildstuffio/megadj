// genre-disputes.ts — the human-review surface for disputed labels
// (issue #64, closing the §5b.3.2 flag loop).
//
// The demote-and-flag pass (genre-flag.ts) writes `genre_flag='disputed'`
// on rows whose stored label contradicts a UNANIMOUS kNN consensus, and
// excludes them from seeding. Until now the flags aged in the DB with no
// decision door: no way to SEE the disputed rows with their evidence, no
// way to resolve one. This module is that door.
//
// Resolution verbs (one seam — every write goes through state, per-row
// only, never bulk):
//   review        — list the disputed rows + evidence (read-only)
//   --agree <id>  — the human ratifies the AUDIO: label := consensus
//                   family (forced write — updateGenre's COALESCE would
//                   refuse an overwrite), flag cleared, row re-enters
//                   seeding (self-heal)
//   --keep <id>   — the human vouches for the SOURCE (SC/Beatport can
//                   outrank the kNN when they're right): flag cleared,
//                   label untouched
//   --note "..."  — audit-trail reasoning, rides with agree/keep; a bare
//                   --note without a verb is an error (exit 2)
//
// The consensus shown/used is recomputed LIVE over the current embeddings
// (evalVoteInputs → inferGenre with flagged rows excluded from seeds) —
// a stale flag's verdict is never trusted, only re-derived.
//
// Rekordbox is untouched: the archive ledger is the only surface. Pure
// decision logic here; state owns the writes; genre.ts wires the CLI.
import {
  genreFamily,
  inferGenre,
  parseEmbeddingVector,
} from "../archive/similar";
import type { ArchiveState } from "../archive/state";

/** One disputed row with the evidence a decision needs. */
export interface DisputeRow {
  videoId: string;
  title: string | null;
  artist: string | null;
  /** The stored label (source claim) under dispute. */
  genre: string;
  /** The scoring family the stored label maps to (null = the label has
   *  no family — often exactly WHY it disputes). */
  family: string | null;
  /** The unanimous consensus family (what the audio says), when the
   *  row's neighbourhood still agrees strongly enough to vote. */
  consensus: string | null;
  /** Vote strength behind the consensus (1.0 = unanimous), when known. */
  agreement: number | null;
  /** Days since the row's embedding was analyzed — stale evidence is
   *  weak evidence (re-run mood before trusting a 3-week-old vote). */
  embedAgeDays: number | null;
}

/** The review census: every flagged row + its current evidence. */
export interface DisputeReview {
  /** Rows currently flagged 'disputed'. */
  flagged: number;
  /** Rows where the stored label's family ALREADY agrees with the live
   *  consensus — resolvable by --keep alone (the flag is stale). */
  alreadyAgree: number;
  rows: DisputeRow[];
}

/** Day length in ms — embed-age math. */
const DAY_MS = 86_400_000;

/** k for the consensus vote (matches the flag pass default). */
const CONSENSUS_K = 5;
/** minAgreement for the consensus vote — the flag pass flags on
 *  UNANIMITY, but for review a 0.6-gated consensus is the human-useful
 *  evidence line (the harness's own gate). */
const CONSENSUS_MIN_AGREEMENT = 0.6;

/** The read half: every flagged row + live evidence. */
export function collectDisputes(state: ArchiveState): DisputeReview {
  const flagged = state.disputedRows();
  const { flagged: voteRows, seeds } = state.disputeVoteInputs();
  const seedVecs = seeds.map((s) => ({
    videoId: s.video_id,
    genre: s.genre,
    vec: parseEmbeddingVector(s.vec_json, `dispute seed ${s.video_id}`),
  }));
  const vecById = new Map(
    voteRows.map((r) => [r.video_id, r.vec_json] as const),
  );
  const ageById = new Map(
    voteRows.map((r) => [r.video_id, r.analyzed_at] as const),
  );

  const rows: DisputeRow[] = flagged.map((r) => {
    const vecJson = vecById.get(r.video_id);
    let consensus: string | null = null;
    let agreement: number | null = null;
    if (vecJson) {
      const vec = parseEmbeddingVector(vecJson, `dispute query ${r.video_id}`);
      const vote = inferGenre(
        seedVecs,
        vec,
        CONSENSUS_K,
        CONSENSUS_MIN_AGREEMENT,
      );
      if (vote.inferred !== null) {
        consensus = vote.inferred;
        agreement = vote.agreement;
      }
    }
    const analyzedAt = ageById.get(r.video_id);
    return {
      videoId: r.video_id,
      title: r.title,
      artist: r.artist,
      genre: r.genre,
      family: genreFamily(r.genre),
      consensus,
      agreement,
      embedAgeDays: analyzedAt
        ? Math.round((Date.now() - Date.parse(analyzedAt)) / DAY_MS)
        : null,
    };
  });
  const alreadyAgree = rows.filter(
    (r) =>
      r.consensus !== null &&
      (r.family === r.consensus ||
        r.genre.toLowerCase() === r.consensus.toLowerCase()),
  ).length;
  return { flagged: rows.length, alreadyAgree, rows };
}

/** Resolution input for one row: which verb, optional note. */
export interface Resolution {
  videoId: string;
  /** "agree" ratifies the audio (label := consensus); "keep" vouches
   *  for the source (label stays). */
  verb: "agree" | "keep";
  note?: string | undefined;
}

/** Apply one resolution through the state seam. Returns a human-readable
 *  outcome. "agree" recomputes the consensus live and refuses when the
 *  neighbourhood no longer votes — a row whose evidence evaporated is
 *  re-flagged (or silently healed) by the next --flag pass anyway, so
 *  agreeing on nothing would write an arbitrary label. */
export function resolveDispute(
  state: ArchiveState,
  res: Resolution,
): { ok: boolean; message: string } {
  const row = state.disputedRows().find((r) => r.video_id === res.videoId);
  if (!row)
    return {
      ok: false,
      message: `${res.videoId} is not flagged 'disputed' (already resolved, or never flagged)`,
    };

  if (res.verb === "keep") {
    state.setGenreFlag(res.videoId, null);
    if (res.note) state.setGenreFlagNote(res.videoId, res.note);
    return {
      ok: true,
      message: `kept "${row.genre}" — flag cleared (source vouched)`,
    };
  }

  // verb === "agree": the audio wins, but only with live evidence.
  const review = collectDisputesRow(state, res.videoId);
  if (!review?.consensus)
    return {
      ok: false,
      message: `${res.videoId} has no current consensus to agree with — re-run \`megadj genre --flag --apply\` first`,
    };
  state.agreeDispute(res.videoId, review.consensus);
  if (res.note) state.setGenreFlagNote(res.videoId, res.note);
  return {
    ok: true,
    message: `label "${row.genre}" → "${review.consensus}" (audio ratified, ${review.agreement ?? "?%"} agreement), flag cleared — row re-enters seeding`,
  };
}

/** Live consensus for ONE row (the --agree path; avoids recomputing the
 *  whole table for a single resolution). */
function collectDisputesRow(
  state: ArchiveState,
  videoId: string,
): { consensus: string | null; agreement: number | null } {
  const { flagged: voteRows, seeds } = state.disputeVoteInputs();
  const vecJson = voteRows.find((r) => r.video_id === videoId)?.vec_json;
  if (!vecJson) return { consensus: null, agreement: null };
  const seedVecs = seeds.map((s) => ({
    videoId: s.video_id,
    genre: s.genre,
    vec: parseEmbeddingVector(s.vec_json, `dispute seed ${s.video_id}`),
  }));
  const vec = parseEmbeddingVector(vecJson, `dispute query ${videoId}`);
  const vote = inferGenre(seedVecs, vec, CONSENSUS_K, CONSENSUS_MIN_AGREEMENT);
  return vote.inferred !== null
    ? { consensus: vote.inferred, agreement: vote.agreement }
    : { consensus: null, agreement: null };
}
