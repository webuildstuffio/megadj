import type { Database } from "bun:sqlite";

/** Round to 3 decimals for wire payloads (null degrades to 0). Pure —
 *  module-level, not re-created per call. */
const round3 = (v: number | null): number => Math.round((v ?? 0) * 1000) / 1000;

/** One mood-ledger row's numeric profile + provenance — the wire shape
 *  shared by Ledgers and ArchiveState (was repeated inline in both
 *  files; jscpd flagged the twin literal). */
export interface MoodRecordInput {
  videoId: string;
  dance: number;
  aggressive: number;
  happy: number;
  electronic: number;
  party: number;
  valence: number;
  arousal: number;
  sourcePath: string;
}

/** MoodRecordInput + its read-side timestamp. */
export interface MoodRecord extends MoodRecordInput {
  analyzedAt: string;
}

/** One cue set for a track + where it was derived from. */
export interface CueRecordInput {
  videoId: string;
  cues: { index: number; position: number; bar: number }[];
  source: string;
}

/** CueRecordInput + its read-side timestamp. */
export interface CueRecord extends CueRecordInput {
  derivedAt: string;
}

/**
 * Mood + structure-cues ledger storage (roadmap rev 6.1 #4 and the cues
 * slice). Extracted from state.ts for the file-length guard; ArchiveState
 * delegates to this so the call surface (`state.setMoodRecord(...)`,
 * `state.cueAnalyzedTracks()`) is unchanged.
 */
export class Ledgers {
  constructor(
    private readonly db: Database,
    private readonly now: () => string,
  ) {}

  // ---------- mood ledger (roadmap rev 6.1 #4) ----------

  /** Upsert one parsed mood result. Idempotent by video_id: a re-run
   * replaces the row (fresh timestamps). */
  setMoodRecord(rec: MoodRecordInput): void {
    this.db
      .query(
        `INSERT INTO mood (video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           dance = excluded.dance,
           aggressive = excluded.aggressive,
           happy = excluded.happy,
           electronic = excluded.electronic,
           party = excluded.party,
           valence = excluded.valence,
           arousal = excluded.arousal,
           source_path = excluded.source_path,
           analyzed_at = excluded.analyzed_at`,
      )
      .run(
        rec.videoId,
        rec.dance,
        rec.aggressive,
        rec.happy,
        rec.electronic,
        rec.party,
        rec.valence,
        rec.arousal,
        rec.sourcePath,
        this.now(),
      );
  }

  /** One mood record (by video id), null when never analyzed. */
  moodRecord(videoId: string): MoodRecord | null {
    const row = this.db
      .query(
        `SELECT video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at
         FROM mood WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      dance: number;
      aggressive: number;
      happy: number;
      electronic: number;
      party: number;
      valence: number;
      arousal: number;
      source_path: string;
      analyzed_at: string;
    } | null;
    if (!row) return null;
    return {
      videoId: row.video_id,
      dance: row.dance,
      aggressive: row.aggressive,
      happy: row.happy,
      electronic: row.electronic,
      party: row.party,
      valence: row.valence,
      arousal: row.arousal,
      sourcePath: row.source_path,
      analyzedAt: row.analyzed_at,
    };
  }

  /** Aggregate mood/energy profile over all analyzed tracks — the CrateDeck
   * vibe-map feed: averages + count, ordered extremes for UI pickers. */
  moodSummary(): {
    available: boolean;
    analyzed: number;
    avg: {
      dance: number;
      valence: number;
      arousal: number;
      party: number;
      electronic: number;
    };
  } {
    const row = this.db
      .query(
        `SELECT COUNT(*) n,
                AVG(dance) dance, AVG(valence) valence, AVG(arousal) arousal,
                AVG(party) party, AVG(electronic) electronic
         FROM mood`,
      )
      .get() as {
      n: number;
      dance: number | null;
      valence: number | null;
      arousal: number | null;
      party: number | null;
      electronic: number | null;
    };
    return {
      available: true,
      analyzed: row.n,
      avg: {
        dance: round3(row.dance),
        valence: round3(row.valence),
        arousal: round3(row.arousal),
        party: round3(row.party),
        electronic: round3(row.electronic),
      },
    };
  }

  // ---------- structure cues ledger (roadmap cues slice) ----------

  /** Upsert one derived cue set. Idempotent by video_id: a re-run replaces
   * the row (fresh timestamps). */
  setCueRecord(rec: CueRecordInput): void {
    this.db
      .query(
        `INSERT INTO cues (video_id, cues_json, model, derived_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           cues_json = excluded.cues_json,
           model = excluded.model,
           derived_at = excluded.derived_at`,
      )
      .run(rec.videoId, JSON.stringify(rec.cues), rec.source, this.now());
  }

  /** One cue record (by video id), null when never derived. */
  cueRecord(videoId: string): CueRecord | null {
    const row = this.db
      .query(
        `SELECT video_id, cues_json, model, derived_at
         FROM cues WHERE video_id = ?`,
      )
      .get(videoId) as {
      video_id: string;
      cues_json: string;
      model: string;
      derived_at: string;
    } | null;
    if (!row) return null;
    let cues: { index: number; position: number; bar: number }[] = [];
    try {
      cues = JSON.parse(row.cues_json) as {
        index: number;
        position: number;
        bar: number;
      }[];
    } catch {
      return null; // corrupt JSON row — treat as absent so the pass re-derives
    }
    return {
      videoId: row.video_id,
      cues,
      source: row.model,
      derivedAt: row.derived_at,
    };
  }

  /** All cue records joined to their track rows (downloaded only). */
  cueAnalyzedTracks(): {
    videoId: string;
    title: string | null;
    cues: Array<{ index: number; position: number; bar: number }>;
    source: string;
  }[] {
    const rows = this.db
      .query(
        `SELECT c.video_id, t.title, c.cues_json, c.model
         FROM cues c JOIN tracks t ON t.video_id = c.video_id
         WHERE t.status = 'downloaded'`,
      )
      .all() as {
      video_id: string;
      title: string | null;
      cues_json: string;
      model: string;
    }[];
    return rows.flatMap((r) => {
      try {
        return [
          {
            videoId: r.video_id,
            title: r.title,
            cues: JSON.parse(r.cues_json) as {
              index: number;
              position: number;
              bar: number;
            }[],
            source: r.model,
          },
        ];
      } catch {
        return []; // corrupt row — skip, never throw
      }
    });
  }
}
