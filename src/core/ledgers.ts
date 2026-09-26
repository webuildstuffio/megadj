import {
  isFiniteNumber,
  isRecord,
  isUnknownArray,
} from "../shared/leaf/guards";
import { round3n } from "../shared/leaf/fmt";
import { RecordLedger } from "./record-ledger";

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

function isCue(value: unknown): value is CueRecordInput["cues"][number] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.index) &&
    isFiniteNumber(value.position) &&
    isFiniteNumber(value.bar)
  );
}

function parseCueArray(
  cuesJson: string,
  context: string,
): CueRecordInput["cues"] {
  let value: unknown;
  try {
    value = JSON.parse(cuesJson) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(
      `${context} has invalid cues_json: malformed JSON${detail}`,
      { cause: error },
    );
  }
  if (!isUnknownArray(value) || !value.every(isCue)) {
    throw new Error(
      `${context} has invalid cues_json: expected a cue array with finite index, position, and bar values`,
    );
  }
  return value;
}

/**
 * Mood + structure-cues ledger storage (roadmap rev 6.1 #4 and the cues
 * slice). Extracted from state.ts for the file-length guard; ArchiveState
 * delegates to this so the call surface (`state.setMoodRecord(...)`,
 * `state.cueAnalyzedTracks()`) is unchanged.
 */
export class Ledgers extends RecordLedger {
  // ---------- mood ledger (roadmap rev 6.1 #4) ----------

  /** Upsert one parsed mood result. Idempotent by video_id: a re-run
   * replaces the row (fresh timestamps) — plumbing is RecordLedger's. */
  setMoodRecord(rec: MoodRecordInput): void {
    this.upsert(
      "mood",
      rec.videoId,
      [
        "dance",
        "aggressive",
        "happy",
        "electronic",
        "party",
        "valence",
        "arousal",
        "source_path",
        "analyzed_at",
      ],
      [
        rec.dance,
        rec.aggressive,
        rec.happy,
        rec.electronic,
        rec.party,
        rec.valence,
        rec.arousal,
        rec.sourcePath,
        this.now(),
      ],
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
        dance: round3n(row.dance),
        valence: round3n(row.valence),
        arousal: round3n(row.arousal),
        party: round3n(row.party),
        electronic: round3n(row.electronic),
      },
    };
  }

  // ---------- structure cues ledger (roadmap cues slice) ----------

  /** Upsert one derived cue set. Idempotent by video_id: a re-run replaces
   * the row (fresh timestamps). */
  setCueRecord(rec: CueRecordInput): void {
    this.upsert(
      "cues",
      rec.videoId,
      ["cues_json", "model", "derived_at"],
      [JSON.stringify(rec.cues), rec.source, this.now()],
    );
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
    try {
      const cues = parseCueArray(row.cues_json, `cue record ${row.video_id}`);
      return {
        videoId: row.video_id,
        cues,
        source: row.model,
        derivedAt: row.derived_at,
      };
    } catch (error) {
      // THE poison-row guard (#74): one home for the whole ledger family.
      return this.absorbParseFailure(
        error,
        `cue record ${row.video_id}`,
        console.warn,
      );
    }
  }

  /** All cue records joined to their track rows (downloaded only). */
  cueAnalyzedTracks(): {
    videoId: string;
    title: string | null;
    cues: { index: number; position: number; bar: number }[];
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
            cues: parseCueArray(r.cues_json, `cue record ${r.video_id}`),
            source: r.model,
          },
        ];
      } catch (error) {
        this.absorbParseFailure(
          error,
          `cue record ${r.video_id}`,
          console.warn,
        );
        return [];
      }
    });
  }
}
