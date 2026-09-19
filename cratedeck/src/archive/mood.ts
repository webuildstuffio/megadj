// archive/mood.ts — the MOOD / dance / valence profile, split out of
// archive.ts under the file-length guard (the same delegate pattern as
// archive_similar/archive_overview/archive_tagcensus).
//
// Roadmap #4: the aggregate + the extremes of megadj's `mood` ledger
// (mirror of the TXXX:MOOD file stamps, written by `megadj mood`). Gives
// agents/UI the vibe-map view without touching audio: averages for
// pickers, highest/lowest valence + arousal + danceability tracks for
// "play me something…". Degrades to available:false on pre-mood DBs
// (no `mood` table).
import type { ArchiveQuery } from "./types";
import type { ArchiveMoodProfile } from "../../shared/archive-wire";

/** Round to 3 decimals for wire payloads (null degrades to 0). Pure. */
const r4 = (v: number | null): number => Math.round((v ?? 0) * 1000) / 1000;

interface MoodExtreme {
  video_id: string;
  title: string | null;
  artist: string | null;
  v: number;
}

export function moodProfile(
  reader: ArchiveQuery,
  limit = 5,
): ArchiveMoodProfile {
  const empty = {
    available: reader.available(),
    analyzed: 0,
    avg: {
      dance: 0,
      valence: 0,
      arousal: 0,
      party: 0,
      electronic: 0,
      aggressive: 0,
    },
    extremes: {
      valence: [] as MoodExtreme[],
      arousal: [] as MoodExtreme[],
      dance: [] as MoodExtreme[],
    },
  };
  const hasMood = reader.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mood'`,
  );
  if (!hasMood.length) return empty;
  const agg = reader.rows<{
    n: number;
    dance: number | null;
    valence: number | null;
    arousal: number | null;
    party: number | null;
    electronic: number | null;
    aggressive: number | null;
  }>(
    `SELECT COUNT(*) n, AVG(dance) dance, AVG(valence) valence,
            AVG(arousal) arousal, AVG(party) party,
            AVG(electronic) electronic, AVG(aggressive) aggressive
     FROM mood`,
  )[0];
  if (!agg || !agg.n) return empty;
  const n = Math.min(Math.max(limit, 1), 25);
  const top = (col: string, dir: "DESC" | "ASC"): MoodExtreme[] =>
    reader
      .rows<{
        video_id: string;
        title: string | null;
        artist: string | null;
        v: number;
      }>(
        `SELECT m.video_id, t.title, t.artist, m.${col} v
       FROM mood m LEFT JOIN tracks t ON t.video_id = m.video_id
       ORDER BY m.${col} ${dir}, m.video_id LIMIT ?`,
        n,
      )
      .map((row) => ({ ...row, v: r4(row.v) }));
  return {
    available: true,
    analyzed: agg.n,
    avg: {
      dance: r4(agg.dance),
      valence: r4(agg.valence),
      arousal: r4(agg.arousal),
      party: r4(agg.party),
      electronic: r4(agg.electronic),
      aggressive: r4(agg.aggressive),
    },
    extremes: {
      valence: [...top("valence", "DESC"), ...top("valence", "ASC")],
      arousal: [...top("arousal", "DESC"), ...top("arousal", "ASC")],
      dance: [...top("dance", "DESC"), ...top("dance", "ASC")],
    },
  };
}
