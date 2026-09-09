// similar.ts — I49 "sounds like": cosine kNN over the embeddings ledger.
//
// The embeddings come from the mood pass's effnet tower (one probe run
// already computes them — `megadj mood` mirrors them into the `embeddings`
// table when asked). This command is the query half: nearest neighbours of
// one track, pure read over the DB.
//
// Agent-first contract: --json (one summary object), human logs suppressed
// in json mode, exit codes meaningful (1 = no such track / no embeddings).
import { commandLog } from "../progress";
import { similarTracks } from "../state";

export interface SimilarOptions {
  state: import("../state").ArchiveState;
  videoId: string;
  k?: number;
  json?: boolean;
}

export async function similar(opts: SimilarOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 10;

  const t = opts.state.allTracks().find((x) => x.video_id === opts.videoId);
  if (!t) {
    console.error(`similar: no track ${opts.videoId}`);
    if (opts.json)
      console.log(
        JSON.stringify({ command: "similar", error: "unknown track" }),
      );
    process.exit(1);
  }
  const q = opts.state.embeddingRecord(opts.videoId);
  if (!q) {
    console.error(
      `similar: ${opts.videoId} has no embedding — run \`megadj mood\` (mirrors embeddings) first`,
    );
    if (opts.json)
      console.log(
        JSON.stringify({ command: "similar", error: "no embedding" }),
      );
    process.exit(1);
  }

  const corpus = opts.state.embeddingCorpus();
  const hits = similarTracks(corpus, opts.videoId, q.vec, k);
  log(
    `similar to "${t.title ?? t.video_id}" — ${hits.length} of ${corpus.length - 1} embedded tracks:`,
  );
  for (const h of hits)
    log(
      `  ${h.score.toFixed(4)}  ${h.artist ?? "?"} — ${h.title ?? h.videoId}`,
    );
  console.log(
    JSON.stringify({
      command: "similar",
      video_id: opts.videoId,
      title: t.title,
      k,
      corpus: corpus.length - 1,
      hits: hits.map((h) => ({
        video_id: h.videoId,
        title: h.title,
        artist: h.artist,
        score: Math.round(h.score * 10000) / 10000,
      })),
    }),
  );
}
