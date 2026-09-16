// fetch-genre-year.ts — stage 2 (SC hit → genre + year), split by arm
// from fetch-stages.ts (#42): stageGenreYear carried both the genre
// ladder and the year ladder (CCN 50); each ladder now reads on its own.
// The write-first discipline (file tag, then DB row — the DB never
// claims a value the file doesn't carry) is the convention every arm
// keeps, with the source stamp on each note.

import {
  bpGenre,
  db,
  setFileTags,
  type BpTrack,
  type Row,
} from "./archive-ledger";
import { imprintVote } from "../../src/fulltags/imprint-prior";

/** Minimal SC search hit (the fields stage 2 consumes). */
export interface ScHit {
  url: string;
  thumb?: string | null;
  genre?: string | null;
  year?: number | null;
}

/** The per-task mutable stage context, structurally — the module stays
 *  decoupled from fetch-stages.ts (no import cycle; only the counters
 *  these arms touch are named). */
export interface GenreYearCtx {
  row: Row;
  truth: { label: string | null };
  aiGenreBatch: Row[];
  aiYearBatch: Row[];
  aiAllowed: boolean;
  bpBest: BpTrack | null;
  stats: Pick<
    StatsShape,
    "genreSc" | "genreBp" | "genreImprint" | "yearBp" | "yearSc"
  >;
  notes: string[];
}
/** Structural mirror of fetch-stages' Stats (kept local: importing it
 *  would re-create the cycle the split removes). */
interface StatsShape {
  genreSc: number;
  genreBp: number;
  genreImprint: number;
  yearBp: number;
  yearSc: number;
}

/** One BP genre win: file tag + DB row + stat + note (write-first). */
function applyBpGenre(t: GenreYearCtx, g: string): void {
  if (setFileTags(t.row.file_path, { genre: g })) {
    db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
      g,
      t.row.video_id,
    );
    t.stats.genreBp++;
    t.notes.push(`genre:${g} (bp)`);
  } else {
    t.notes.push("genre:WRITE-FAILED (bp)");
  }
}

/** The #128 imprint prior vote: the track's imprint (Beatport-filled
 *  TPUB) maps to a scene family through the cited IMPRINT_FAMILIES
 *  table. A VOTE, not a write-over: it fires only when both catalog
 *  sources (SC + BP) missed the genre, and never when the file's own
 *  label disagrees with the DB (stale row). Same write-first discipline
 *  as the SC/BP paths. Returns true when it wrote a genre. */
function applyImprintGenre(t: GenreYearCtx): boolean {
  const label = t.truth.label ?? t.row.label;
  const vote = imprintVote(label);
  if (!vote) return false;
  // Tag write first, DB row only on success (the ladder discipline).
  if (!setFileTags(t.row.file_path, { genre: vote.family })) {
    t.notes.push("genre:WRITE-FAILED (imprint)");
    return false;
  }
  db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
    vote.family,
    t.row.video_id,
  );
  t.stats.genreImprint++;
  t.notes.push(`genre:${vote.family} (imprint:${vote.imprint})`);
  return true;
}

/** Nothing left in the ladder: the AI fallback is opt-in (aiAllowed);
 *  a missing genre stays an honest gap, never a guess. */
function queueAiGenre(t: GenreYearCtx): void {
  if (t.aiAllowed) t.aiGenreBatch.push(t.row);
  else t.notes.push("genre:UNRESOLVED (no SC/bp hit — AI fallback off)");
}

/** The genre ladder: SC hit → BP store genre → imprint prior → AI queue.
 *  `applyScGenre` is injected (the SC rung stays in fetch-stages with the
 *  Stats/junk-gate context it shares with the art path). */
export function stageGenreArm(
  t: GenreYearCtx,
  best: ScHit | null,
  applyScGenre: (t: GenreYearCtx, rawGenre: string) => void,
): void {
  if (best?.genre) return applyScGenre(t, best.genre);
  if (t.bpBest) {
    // Beatport store genre is the vote BETWEEN SC and AI.
    const g = bpGenre(t.bpBest);
    if (g) return applyBpGenre(t, g);
    // both catalog genres missed but Beatport matched the release —
    // the #128 imprint prior votes from the label it carries
    if (applyImprintGenre(t)) return;
    return queueAiGenre(t);
  }
  // no BP hit at all, but a BP-filled label already on the row/file
  // votes (e.g. a re-run after the identity stage landed)
  if (applyImprintGenre(t)) return;
  queueAiGenre(t);
}

/** One BP year win: file tag + DB row + stat + note (markYear's
 *  write-first discipline with the bp source stamp). */
function applyBpYear(t: GenreYearCtx, year: number): void {
  if (setFileTags(t.row.file_path, { year })) {
    db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
      String(year),
      t.row.video_id,
    );
    t.stats.yearBp++;
    t.notes.push(`year:${year} (bp)`);
  } else {
    t.notes.push("year:WRITE-FAILED (bp)");
  }
}

/** The year ladder: SC upload timestamp (remix year) → BP publish date →
 *  AI queue. */
export function stageYearArm(t: GenreYearCtx, best: ScHit | null): void {
  if (best?.year) return applyScYearArm(t, best.year);
  if (t.bpBest?.year) return applyBpYear(t, t.bpBest.year);
  if (t.aiAllowed) t.aiYearBatch.push(t.row);
  else t.notes.push("year:UNRESOLVED (no SC/bp hit — AI fallback off)");
}

/** SC-path year stamp: file tag + DB row + stat + note (markYear's
 *  discipline — the DB never claims a value the file doesn't carry). */
function applyScYearArm(t: GenreYearCtx, year: number): void {
  if (!setFileTags(t.row.file_path, { year })) {
    t.notes.push("year:WRITE-FAILED");
    return;
  }
  db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
    String(year),
    t.row.video_id,
  );
  t.stats.yearSc++;
  t.notes.push(`year:${year}`);
}
