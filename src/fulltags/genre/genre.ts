// genre.ts — `megadj genre`: infer genres from AUDIO, not ID3 tags.
//
// The `tracks.genre` column is unreliable at intake (YouTube-tier labels
// like "Music" ×99, comma soup, wholesale missing). But the effnet
// embedding (already computed by `megadj mood --embeddings`) clusters by
// sound — so kNN-vote each un-genred track against trusted-genre seeds,
// with sub-genres collapsed to families (deep house / progressive house
// both vote "house") and split neighbourhoods left HONESTLY untouched
// (the engine in src/archive/similar.ts decides nothing under 60%
// agreement).
//
// Default is a DRY RUN (proposals only); --apply writes via
// state.updateGenre, whose COALESCE means a track that already has a
// genre is never overwritten — the column is fill-in, never clobber.
// --eval runs the leave-one-out harness INSTEAD: it is the standing
// regression gate for label hygiene (docs/fulltags/genre-audit.md
// §5b.3 step 4 — target: gated ≥65% after refold, baseline 62.7%).
//
// (#206 split) this file is the VOCABULARY: option/report types plus the
// `genre` re-export so existing importers don't move. The runner arm
// (flag parse → ladder invocation → report) lives in genre-run.ts, the
// #88 fetch-split pattern.

import type { ArchiveState } from "../../archive/state";

export { genre } from "./genre-run";

/** The `--eval --refold` JSON block: the arbitration A/B against the
 *  pinned baseline on the same population. */
export interface RefoldEvalBlock {
  /** Rows scored through the arbitration (umbrella rows excluded). */
  evaluated: number;
  /** Baseline-population rows the arbitration abstains (plain EDM/
   * Dance/Electronic/Mainstage EDM). */
  abstained: number;
  agree: number;
  disagree: number;
  refused: number;
  agreement: number;
  refusal: number;
  /** Arbitration gated agreement − baseline gated agreement. */
  deltaVsBaseline: number;
}

export interface GenreOptions {
  state: ArchiveState;
  /** Write inferred genres (default: propose only). */
  apply?: boolean | undefined;
  /** Neighbour count for the vote (default 5). */
  k?: number | undefined;
  /** Min vote agreement to decide (0–1, default 0.6). */
  minAgreement?: number | undefined;
  /** Run the leave-one-out eval harness instead of inference. */
  eval?: boolean | undefined;
  /** Apply the measured 90–480 s duration guard in --eval (default on,
   * matching the audit's v3 methodology; --no-duration-guard disables). */
  durationGuard?: boolean | undefined;
  /** --eval: also run the Tier-0 diagnostics battery (research review
   * 0.1–0.4: label-error clustering, artist overlap, hubness, confusion
   * matrix + top-2). Adds ~1 min at n≈3k. */
  diagnostics?: boolean | undefined;
  /** --eval: additionally run the artist-disjoint LOO (Sturm's "horse"
   * control — same-artist neighbours cannot vote). */
  artistDisjoint?: boolean | undefined;
  /** --eval: additionally run the linear-probe LOO readout (frozen
   * softmax regression over the same vectors). Slower: fits n probes. */
  probe?: boolean | undefined;
  /** Refold pass (genre-audit §5b.3 step 1, archived ideas #94 (docs/archive/ideas-2026-09-15.md)). With --eval:
   * score through the umbrella arbitration (`scoringFamily` — plain
   * EDM/Dance/Electronic abstain) and report the baseline delta. Alone:
   * propose data-half canonicalizations (escape repair, multi-label
   * split, casing) — dry by default, --apply writes them. */
  refold?: boolean | undefined;
  /** Demote-and-flag pass (genre-audit §5b.3 step 2). Runs the LOO
   * harness and flags rows whose label contradicts a UNANIMOUS kNN
   * consensus as `genre_flag='disputed'` — never rewritten, but
   * excluded from inference seeding. Dry by default; --apply writes
   * flags. Requires embeddings; mutually exclusive with --refold. */
  flag?: boolean | undefined;
  /** #64 dispute review: list flagged rows + live evidence (read-only). */
  disputes?: boolean | undefined;
  /** #64 resolution: ratify the audio on ONE flagged row (label :=
   *  live consensus family, flag cleared, row re-enters seeding). */
  agree?: string | undefined;
  /** #64 resolution: vouch for the source on ONE flagged row (flag
   * cleared, label untouched). */
  keep?: string | undefined;
  /** #64 audit note riding with --agree/--keep (max ~120 chars). */
  note?: string | undefined;
  json?: boolean | undefined;
}
