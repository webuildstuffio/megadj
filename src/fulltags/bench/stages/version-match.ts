/**
 * bench/stages/version-match.ts — Version-match diagnostic (B3.6, §4.5).
 *
 * Reports: "X% of today's genre votes are about a different recording
 * than the file." That single number tells you how much of "genre
 * quality is still poor" is identity rather than taxonomy.
 *
 * Reads existing genre_votes JSON to classify each vote's evidence scope
 * via the version parser.
 */
import type { Database } from "bun:sqlite";
import { round4 } from "../../../shared/leaf/fmt";
import { parseVersion, versionCompatible } from "../../identity/version";
import { registerStage } from "../runner";
import type { BenchRow, BenchSplit, StageResult } from "../types";

interface VoteTrack {
  video_id: string;
  title: string;
  artist: string | null;
  genre_votes: string | null;
}

interface VoteEntry {
  source?: string;
  candidateTitle?: string;
  candidateArtist?: string;
  candidateArtists?: string[];
  family?: string;
  genre?: string;
  elected?: boolean;
  weight?: number;
}

function runVersionMatchStage(db: Database, _answerKey: string, _split: BenchSplit): StageResult {
  const tracks = db
    .query(
      `SELECT video_id, title, artist, genre_votes FROM tracks
       WHERE status = 'downloaded' AND genre_votes IS NOT NULL`,
    )
    .all() as VoteTrack[];

  let totalVotes = 0;
  let exactVotes = 0;
  let siblingVotes = 0;
  let rejectVotes = 0;
  let unclassifiedVotes = 0;
  const rows: BenchRow[] = [];

  for (const t of tracks) {
    if (t.genre_votes === null) continue;
    let votes: VoteEntry[];
    try {
      votes = JSON.parse(t.genre_votes) as VoteEntry[];
    } catch {
      continue;
    }
    if (!Array.isArray(votes)) continue;

    const qv = parseVersion(t.title ?? "", t.artist ?? "");

    for (const v of votes) {
      totalVotes++;
      const cTitle = v.candidateTitle ?? v.genre ?? "";
      const cArtists: string[] =
        v.candidateArtists ?? (v.candidateArtist !== undefined ? [v.candidateArtist] : []);

      if (cTitle === "" && cArtists.length === 0) {
        // No candidate metadata — can't classify
        unclassifiedVotes++;
        continue;
      }

      const cv = parseVersion(cTitle, cArtists.join(", "));
      const match = versionCompatible(qv, cv);

      if (match === "exact") exactVotes++;
      else if (match === "sibling") siblingVotes++;
      else rejectVotes++;
    }

    // One bench row per track: truth = "version_ok", pred = dominant match
    const dominant = rejectVotes > exactVotes + siblingVotes ? "wrong_version" : "version_ok";
    rows.push({
      runId: "",
      trackId: t.video_id,
      truth: "version_ok",
      pred: dominant,
      conf: null,
      correct: dominant === "version_ok" ? 1 : 0,
    });
  }

  const wrongVersionRate = totalVotes > 0 ? round4(rejectVotes / totalVotes) : null;
  const siblingRate = totalVotes > 0 ? round4(siblingVotes / totalVotes) : null;

  return {
    stage: "version-match",
    answerKey: "internal",
    rows,
    metrics: {
      total_votes: totalVotes,
      exact_votes: exactVotes,
      sibling_votes: siblingVotes,
      reject_votes: rejectVotes,
      unclassified_votes: unclassifiedVotes,
      wrong_version_rate: wrongVersionRate,
      sibling_rate: siblingRate,
      tracks_with_votes: tracks.length,
    },
    configHash: "version-match-v1",
  };
}

registerStage("version-match", runVersionMatchStage);
