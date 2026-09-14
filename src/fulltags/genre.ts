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
// regression gate for label hygiene (docs/megaset/05-genre-audit.md
// §5b.3 step 4 — target: gated ≥65% after refold, baseline 62.7%).

import { commandLog } from "../progress";
import {
  evalLeaveOneOut,
  inferGenre,
  parseEmbeddingVector,
  type GenreSeed,
} from "../archive/similar";
import type { ArchiveState } from "../archive/state";

/** Share 0..1 → percentage string with one decimal (eval log lines). */
const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

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
  json?: boolean | undefined;
}

export async function genre(opts: GenreOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 5;
  const minAgreement = opts.minAgreement ?? 0.6;

  if (opts.eval) {
    // ---- eval mode: measure, never write ----
    const pop = opts.state.evalPopulation();
    const seeds: GenreSeed[] = [];
    const durations: { videoId: string; durationS: number | null }[] = [];
    for (const row of pop) {
      seeds.push({
        videoId: row.video_id,
        genre: row.genre,
        vec: parseEmbeddingVector(row.vec_json, `genre eval ${row.video_id}`),
      });
      durations.push({ videoId: row.video_id, durationS: row.duration_s });
    }
    const summary = evalLeaveOneOut(
      seeds,
      k,
      minAgreement,
      opts.durationGuard === false ? [] : durations,
    );
    // the audit's checkpoint: gated agreement — v3 target ≥65% post-refold
    log(
      `genre eval: ${summary.evaluated} evaluated · gated agreement ${pct(summary.agreement)} · refusal ${pct(summary.refusal)} · ungated ${pct(summary.ungatedAgreement)} (k=${k}, minAgreement ${minAgreement}${opts.durationGuard === false ? ", no duration guard" : ", 90–480s guard"})`,
    );
    const pass = summary.agreement >= 0.65;
    log(
      `  target (05-genre-audit §5b.3): gated ≥65% post-refold — ${pass ? "PASS" : "below target (see audit for the refold plan)"}`,
    );
    console.log(
      JSON.stringify({
        command: "genre",
        mode: "eval",
        k,
        minAgreement,
        durationGuard: opts.durationGuard !== false,
        evaluated: summary.evaluated,
        agree: summary.agree,
        disagree: summary.disagree,
        refused: summary.refused,
        agreement: Math.round(summary.agreement * 1000) / 1000,
        refusal: Math.round(summary.refusal * 1000) / 1000,
        ungated_agreement: Math.round(summary.ungatedAgreement * 1000) / 1000,
        target: 0.65,
        pass,
      }),
    );
    process.exitCode = pass ? 0 : 1;
    return;
  }

  // seeds: embedded tracks WITH a trusted genre; queries: embedded
  // tracks WITHOUT one (COALESCE means we could also never clobber, but
  // not querying them at all keeps the run bounded by the real gap)
  const rows = opts.state.genreSeeds();
  const seeds: GenreSeed[] = rows.seeds.map((s) => ({
    videoId: s.video_id,
    genre: s.genre!,
    vec: parseEmbeddingVector(s.vec_json, `genre seed ${s.video_id}`),
  }));
  // Parse and validate every query before the first --apply write. A late
  // corrupt row must never leave an earlier query partially committed.
  const queries = rows.queries.map((q) => ({
    ...q,
    vec: parseEmbeddingVector(q.vec_json, `genre query ${q.video_id}`),
  }));

  let inferred = 0;
  let split = 0;
  const proposals: {
    video_id: string;
    title: string | null;
    genre: string;
    agreement: number;
  }[] = [];
  for (const q of queries) {
    const v = inferGenre(seeds, q.vec, k, minAgreement);
    if (v.inferred === null) {
      split++;
      continue;
    }
    inferred++;
    if (opts.apply) opts.state.updateGenre(q.video_id, v.inferred);
    proposals.push({
      video_id: q.video_id,
      title: q.title,
      genre: v.inferred,
      agreement: v.agreement,
    });
  }

  log(
    `genre: ${inferred} inferred, ${split} split-vote (left untouched), from ${seeds.length} seeds — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  for (const p of proposals.slice(0, 20))
    log(
      `  ${p.genre.padEnd(8)} ${(p.agreement * 100).toFixed(0)}%  ${p.title ?? p.video_id}`,
    );

  console.log(
    JSON.stringify({
      command: "genre",
      mode: "infer",
      seeds: seeds.length,
      queries: rows.queries.length,
      inferred,
      split,
      applied: opts.apply === true,
      proposals: proposals.slice(0, 40),
    }),
  );
  // an all-split run is a finding, not an error — embeddings may not
  // exist yet; say so and exit 0 (the JSON states the census)
  if (inferred === 0 && split === 0)
    log(
      "genre: nothing to infer — run `megadj mood --embeddings` to build the embedding ledger first",
    );
}
