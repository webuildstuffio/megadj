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
} from "../archive-ledger";
import { imprintVote } from "../imprint-prior";
import { GENRE_VOTE_WEIGHTS, type GenreVote } from "../genre-vote";

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
  /** #173 vote ladder: every genre rung that fires ADDS a vote here;
   *  the single write happens once in applyGenreVotes at stage end (the
   *  first-win arms below only write when the ladder is ALONE — see the
   *  vote-collect guard at stageGenreYear's call site). */
  genreVotes?: GenreVote[] | undefined;
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
  // #173 ladder: cast the family vote (imprint elects scene FAMILIES,
  // weight 0.15 — it only wins when it's the sole voice) and let the
  // single election write. The vote path skips the immediate tag write:
  // the elected label is tagged once, by the vote seam.
  t.genreVotes?.push({
    rung: "imprint",
    genre: vote.family,
    weight: GENRE_VOTE_WEIGHTS.imprint,
    detail: vote.imprint,
  });
  t.stats.genreImprint++;
  t.notes.push(`genre:${vote.family} (imprint:${vote.imprint}, vote)`);
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
 *  Stats/junk-gate context it shares with the art path).
 *
 *  #173 vote ladder: when the context carries a vote accumulator (the
 *  caller opened one), the rungs COLLECT instead of first-win write —
 *  the SC arm votes via the injected applyScGenre wrapper, BP/imprint
 *  votes land here, and the ONE election+write happens in
 *  stageGenreElection after this returns. Without the accumulator the
 *  legacy first-win behavior is preserved exactly (write-on-first-claim). */
export function stageGenreArm(
  t: GenreYearCtx,
  best: ScHit | null,
  applyScGenre: (t: GenreYearCtx, rawGenre: string) => void,
): void {
  if (t.genreVotes !== undefined) {
    // ---- vote-collection mode (#173): EVERY rung with a claim votes —
    // the ladder order no longer hides later rungs (the old early-return
    // let SC's 0.35 vote block BP's 0.6 even when bpBest was in hand;
    // the election, not the ladder order, picks the winner). ----
    if (best?.genre) {
      // junk gates live in applyScGenre; it pushes the vote when clean
      applyScGenre(t, best.genre);
    }
    if (t.bpBest) {
      const g = bpGenre(t.bpBest);
      if (g) {
        t.genreVotes.push({
          rung: "bp",
          genre: g,
          weight: GENRE_VOTE_WEIGHTS.bp,
        });
        t.stats.genreBp++;
        t.notes.push(`genre:${g} (bp, vote)`);
      }
    }
    // The imprint prior's rung gate stays absolute: it speaks only when
    // NO catalog genre claim exists (a junk-refused SC genre is not a
    // claim). Zero votes = honest AI-queue fallback, exactly the old
    // when-catalog-misses rule — multi-collect changed who votes, never
    // when the AI fallback fires.
    if (t.genreVotes.length === 0 && !applyImprintGenre(t)) queueAiGenre(t);
    return;
  }
  // ---- legacy first-win mode (unchanged shape, no vote accumulator) ----
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

/** One BP year win: file tag + DB row + stat + note (write-first
 *  discipline with the bp source stamp). */
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

/** SC-path year stamp: file tag + DB row + stat + note (write-first
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
