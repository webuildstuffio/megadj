// fetch-events.ts — the live-run event protocol for `fetch --json`
// (the #215 visibility pass): when stdout must stay a single parseable
// JSON object (P1), progress flows on STDERR as `@event {json}` lines.
// The CrateDeck job leg (cratedeck/src/job_legs.ts runFetchJob) parses
// these lines into the live Ladder feed the web UI renders — the
// in-product "watch the ladder run" view.
//
// Contract (pinned by cratedeck/test/fetch-events-census.test.ts):
//   line 1  @fetch-start {"total":N,"tasks":N,"jobs":N,"dry":bool}
//   per run @task-done   {"done":n,"total":N,"name":"…","notes":["…"],"votes":[{rung,genre,weight}],"elected":{"genre","weight","winnerRungs"}|null}
//   once    @fetch-done  {"stats":{…}}  (mirrors the summary object)
//
// Human mode (no --json) emits NOTHING here — the TTY bar and note
// lines stay exactly as they were. stderr-only in json mode: stdout
// carries ONLY the summary object.

import type { GenreVote } from "../genre/genre-vote";

/** One vote serialized for the wire — the rung id + its claim. */
export interface FetchVoteEvent {
  rung: string;
  genre: string;
  weight: number;
}

/** One track's ladder outcome, as the UI needs it. */
export interface FetchTaskDoneEvent {
  done: number;
  total: number;
  name: string;
  notes: string[];
  votes: FetchVoteEvent[];
  elected: {
    genre: string;
    weight: number;
    winnerRungs: string[];
  } | null;
}

interface FetchStartEvent {
  total: number;
  tasks: number;
  jobs: number;
  dry: boolean;
}

/** stderr is the progress channel in every mode (progress.ts rule). */
function emit(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** The header event — total scope of this run. */
export function emitFetchStart(e: FetchStartEvent): void {
  emit(`@fetch-start ${JSON.stringify(e)}`);
}

/** Per-track event: the rung votes cast for this track + the election. */
export function emitTaskDone(e: FetchTaskDoneEvent, jsonMode: boolean): void {
  // JSON mode is the structured channel; human mode keeps its plain
  // notes line (the bar redraw owns stderr there).
  if (jsonMode) emit(`@task-done ${JSON.stringify(e)}`);
}

/** The footer event — final stats mirror of the summary object. */
export function emitFetchDone(stats: Record<string, number>): void {
  emit(`@fetch-done ${JSON.stringify({ stats })}`);
}

/** Build the per-track event from pipeline pieces. Exported so the
 *  pipeline assembles it once; keeps the wire shape in one place. */
export function taskDoneEvent(input: {
  done: number;
  total: number;
  name: string;
  notes: string[];
  votes: GenreVote[];
  elected: {
    genre: string;
    weight: number;
    winnerRungs: string[];
  } | null;
}): FetchTaskDoneEvent {
  return {
    done: input.done,
    total: input.total,
    name: input.name,
    notes: input.notes,
    votes: input.votes.map((v) => ({
      rung: v.rung,
      genre: v.genre,
      weight: v.weight,
    })),
    elected: input.elected,
  };
}
