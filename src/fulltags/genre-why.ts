// genre-why.ts — the #215 explainability read: every voted track carries
// its full election breakdown in `tracks.genre_votes`, and this is the
// production reader that was missing (`ArchiveState.genreVotes()` had a
// writer but ZERO callers). Answers "why Techno?" from the ROW — rung,
// genre, weight, elected flag — never from code reading.
//
// Agent-first contract (same shape as `similar`): --json carries one
// summary object; exit 2 = bad input, exit 1 = no such track OR a
// DRIFTED row (replay ≠ stored genre — the one finding this command
// exists to surface; exit code makes it agent-detectable without
// parsing). Never-voted is exit 0: a status, not an error.
import { commandLog } from "../progress";
import {
  drainStdout,
  finishCommandError,
  writeJson,
} from "../shared/cli-output";
import {
  GENRE_VOTE_WEIGHTS,
  electGenre,
  type GenreVoteRung,
} from "./genre-vote";
import type { ArchiveState } from "../archive/state";

export interface GenreWhyOptions {
  state: ArchiveState;
  videoId: string;
  json?: boolean | undefined;
}

/** One breakdown row on the wire. `weight` is the rung's configured
 *  weight (from `GENRE_VOTE_WEIGHTS`, re-derived — never trusted from
 *  the serialized row); `elected` marks the winning side. */
export interface GenreWhyVote {
  rung: GenreVoteRung;
  genre: string;
  weight: number;
  elected: boolean;
  detail?: string | undefined;
}

export async function genreWhy(opts: GenreWhyOptions): Promise<void> {
  const log = commandLog(opts);
  const votes = opts.state.genreVotes(opts.videoId);
  const track = opts.state.allTracks().find((x) => x.video_id === opts.videoId);

  if (!track) {
    await finishCommandError({
      command: "genre-why",
      json: opts.json === true,
      error: `no track ${opts.videoId}`,
      exitCode: 1,
    });
    return;
  }
  if (votes.length === 0) {
    // honest empty-state: never-voted is a status, not an error — the
    // genre column may still carry a first-win-era or sync-era label.
    log(
      `${opts.videoId} has no vote breakdown — run \`megadj fetch --genres\` to vote it`,
    );
    await writeJson({
      command: "genre-why",
      video_id: opts.videoId,
      title: track.title,
      artist: track.artist,
      db_genre: track.genre,
      voted: false,
      votes: [],
    });
    return;
  }

  // Re-elect through the WRITE path's exact seam (same electGenre, same
  // tie-breaks) — a stored breakdown always replays to the same winner.
  const elected = electGenre(votes);
  const matchesDb = elected.genre === track.genre;
  const rows: GenreWhyVote[] = votes.map((v) => ({
    rung: v.rung,
    genre: v.genre,
    weight: GENRE_VOTE_WEIGHTS[v.rung],
    elected: elected.genre !== null && v.genre === elected.genre,
    ...(v.detail !== undefined ? { detail: v.detail } : {}),
  }));
  for (const r of rows) {
    log(
      `  ${r.elected ? "★" : " "} ${r.rung.padEnd(8)} w=${r.weight.toFixed(2)}  ${r.genre}${r.detail ? `  (${r.detail})` : ""}`,
    );
  }
  log(
    `elected: ${elected.genre ?? "—"} (w=${elected.weight.toFixed(2)}) — stored genre: ${track.genre ?? "null"}`,
  );
  if (!matchesDb) {
    // Drift is the one state this command exists to catch — never let it
    // scroll past as a quiet field. exit 1 mirrors it for --json agents.
    log(
      `DRIFT: the replay elects "${elected.genre ?? "—"}" but the row stores "${track.genre ?? "null"}" — re-run \`megadj fetch --genres\` or inspect manually`,
    );
  }

  await writeJson({
    command: "genre-why",
    video_id: opts.videoId,
    title: track.title,
    artist: track.artist,
    db_genre: track.genre,
    voted: true,
    elected: elected.genre,
    elected_weight: elected.weight,
    winner_rungs: elected.winnerRungs,
    matches_db: matchesDb,
    votes: rows,
  });
  if (!matchesDb) {
    // Meaningful exit codes (P1): a drifted row is a finding, not a
    // clean read. Pure --json agents can detect it by exit code alone.
    await drainStdout();
    process.exitCode = 1;
  }
}
