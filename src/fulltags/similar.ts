// similar.ts — I49 "sounds like": cosine kNN over the embeddings ledger.
//
// The embeddings come from the mood pass's effnet tower (one probe run
// already computes them — `megadj mood` mirrors them into the `embeddings`
// table when asked). This command is the query half: nearest neighbours of
// one track, pure read over the DB.
//
// `--space whitened` applies the research review's retrieval corrections
// (docs/archive/embedding-research-2026-09-14.md R5): mean-centre +
// all-but-the-top whitening + CSLS penalties, fitted on the live corpus
// per query (pure math, ~seconds at 3k). Raw stays the default until the
// A/B (archived ideas P100 (docs/archive/ideas-2026-09-15.md)) retires one of the two.
//
// Agent-first contract: --json (one summary object), human logs suppressed
// in json mode, exit codes meaningful (1 = no such track / no embeddings).
import { commandLog } from "../progress";
import { writeJson } from "../shared/cli-output";
import { similarTracks, cosineSimilarity } from "../archive/state";
import {
  applySpace,
  cslsPenalties,
  cslsQueryPenalty,
  fitAllButTheTop,
  isSimilarSpace,
  type SimilarSpace,
} from "../../cratedeck/shared/vector-space";

export interface SimilarOptions {
  state: import("../archive/state").ArchiveState;
  videoId: string;
  k?: number | undefined;
  /** Retrieval space: raw cosine (default) or whitened+CSLS. */
  space?: string | undefined;
  json?: boolean | undefined;
}

export async function similar(opts: SimilarOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 10;
  const space: SimilarSpace =
    opts.space !== undefined && isSimilarSpace(opts.space) ? opts.space : "raw";
  if (opts.space !== undefined && !isSimilarSpace(opts.space)) {
    console.error(
      `similar: unknown --space "${opts.space}" — expected raw or whitened`,
    );
    process.exitCode = 2;
    return;
  }

  const t = opts.state.allTracks().find((x) => x.video_id === opts.videoId);
  if (!t) {
    console.error(`similar: no track ${opts.videoId}`);
    if (opts.json)
      await writeJson({ command: "similar", error: "unknown track" });
    process.exit(1);
  }
  const q = opts.state.embeddingRecord(opts.videoId);
  if (!q) {
    console.error(
      `similar: ${opts.videoId} has no embedding — run \`megadj mood\` (mirrors embeddings) first`,
    );
    if (opts.json)
      await writeJson({ command: "similar", error: "no embedding" });
    process.exit(1);
  }

  const corpus = opts.state.embeddingCorpus();
  const compatible = corpus.filter((c) => c.vec.length === q.vec.length);
  let hits = similarTracks(corpus, opts.videoId, q.vec, k);
  let cslsApplied = false;
  if (space === "whitened" && compatible.length > 1) {
    // fit on the corpus + query (the query must live in the same space),
    // then rank by CSLS-corrected cosine: 2·cos(q,c) − r(q) − r(c)
    const model = fitAllButTheTop([...compatible.map((c) => c.vec), q.vec], 2);
    const queryVec = applySpace(model, q.vec);
    const spaceVecs = compatible.map((c) => applySpace(model, c.vec));
    const penalties = cslsPenalties(spaceVecs);
    const queryPenalty = cslsQueryPenalty(queryVec, spaceVecs);
    hits = compatible
      .map((c, i) => ({
        videoId: c.videoId,
        title: c.title,
        artist: c.artist,
        score:
          2 * cosineSimilarity(queryVec, spaceVecs[i]!) -
          queryPenalty -
          penalties[i]!,
      }))
      .toSorted((a, b) => b.score - a.score)
      .slice(0, Math.max(0, k));
    cslsApplied = true;
  }
  log(
    `similar to "${t.title ?? t.video_id}" — ${hits.length} of ${corpus.length - 1} embedded tracks${space === "whitened" ? " (whitened+CSLS)" : ""}:`,
  );
  for (const h of hits)
    log(
      `  ${h.score.toFixed(4)}  ${h.artist ?? "?"} — ${h.title ?? h.videoId}`,
    );
  await writeJson({
    command: "similar",
    video_id: opts.videoId,
    title: t.title,
    k,
    space,
    csls: cslsApplied,
    corpus: corpus.length - 1,
    hits: hits.map((h) => ({
      video_id: h.videoId,
      title: h.title,
      artist: h.artist,
      score: Math.round(h.score * 10000) / 10000,
    })),
  });
}
