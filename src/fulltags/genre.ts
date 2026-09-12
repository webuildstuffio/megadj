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

import { commandLog } from "../progress";
import { inferGenre, type GenreSeed } from "../archive/similar";
import type { ArchiveState } from "../archive/state";

export interface GenreOptions {
  state: ArchiveState;
  /** Write inferred genres (default: propose only). */
  apply?: boolean | undefined;
  /** Neighbour count for the vote (default 5). */
  k?: number | undefined;
  /** Min vote agreement to decide (0–1, default 0.6). */
  minAgreement?: number | undefined;
  json?: boolean | undefined;
}

export async function genre(opts: GenreOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 5;
  const minAgreement = opts.minAgreement ?? 0.6;

  // seeds: embedded tracks WITH a trusted genre; queries: embedded
  // tracks WITHOUT one (COALESCE means we could also never clobber, but
  // not querying them at all keeps the run bounded by the real gap)
  const rows = opts.state.genreSeeds();
  const seeds: GenreSeed[] = rows.seeds.map((s) => ({
    videoId: s.video_id,
    genre: s.genre!,
    vec: JSON.parse(s.vec_json) as number[],
  }));

  let inferred = 0;
  let split = 0;
  const proposals: {
    video_id: string;
    title: string | null;
    genre: string;
    agreement: number;
  }[] = [];
  for (const q of rows.queries) {
    const vec = JSON.parse(q.vec_json) as number[];
    const v = inferGenre(seeds, vec, k, minAgreement);
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
