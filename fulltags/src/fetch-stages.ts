// fetch-stages.ts — processTask's stage runners, extracted from
// fetch-pipeline.ts so each stage reads (and reports CCN) on its own:
// tags-from-DB, the SC-search fan-out (genre + year + original-res art),
// and the art fallback ladder (gateway → mp3-twin → deezer → itunes).
// Shared mutable state (Stats, notes, the AI batches) rides a Ctx the
// stages mutate; the orchestration order stays in fetch-pipeline.ts.
// The source fan-outs (Beatport / SoundCloud / Bandcamp lookups) are
// stages too (#188): each owns its want-decision and writes its hit onto
// the Ctx, so the pipeline is a flat sequencer with no lookup logic.

import {
  beatportLookup,
  bpGenre,
  bpStamp,
  bcFetchPage,
  bcGenre,
  bcSearch,
  canonGenre,
  cleanArtist,
  db,
  scSearch,
  setFileTags,
  type BcPage,
  type BcTrack,
  type BpTrack,
  type Row,
  type TagValues,
} from "./archive-ledger";
import { stageGenreArm, stageYearArm } from "./fetch-genre-year";

/** Where the SC-art fallback ladder stops being tried (artless → queue). */
export interface Stats {
  tags: number;
  genreSc: number;
  genreBp: number;
  genreAi: number;
  artSc: number;
  artScOrig: number;
  artBeatport: number;
  artBandcamp: number;
  artGateway: number;
  artTwin: number;
  artDeezer: number;
  artItunes: number;
  yearSc: number;
  yearBp: number;
  yearAi: number;
  /** Tracks where the Beatport vote filled ≥1 identity field. */
  bpIdentity: number;
  genreBc: number;
  yearBc: number;
  /** Tracks where the Bandcamp vote filled ≥1 field (genre/year/label). */
  bcFilled: number;
  /** Tracks where the #128 imprint prior cast the deciding genre vote. */
  genreImprint: number;
}

/** Per-task mutable state shared by the stage runners. */
export interface StageCtx {
  row: Row;
  truth: {
    art: boolean;
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    year: string | null;
    label: string | null;
    mixName: string | null;
    isrc: string | null;
    remixer: string | null;
  };
  needTags: boolean;
  needGenre: boolean;
  needArt: boolean;
  needYear: boolean;
  upgradeSc: boolean;
  dry: boolean;
  stats: Stats;
  notes: string[];
  aiGenreBatch: Row[];
  aiYearBatch: Row[];
  /** AI genre/year fallback gate (opt-in, --ai-fallback): when false the
   *  batches are never populated — unresolved genre/year stays a note, and
   *  the operator re-runs the bounded list explicitly. */
  aiAllowed: boolean;
  /** Beatport hit for this track (second source behind SC) — filled by
   * fanOutBeatport when any Beatport-fed field is needed. */
  bpBest: BpTrack | null;
  /** Bandcamp hit (third source behind SC + BP) — filled by fanOutBandcamp
   * only when BOTH SC and BP missed the field Bandcamp is being asked
   * for, so the extra page fetch leg stays rare. */
  bcBest: BcTrack | null;
  /** Track duration in seconds (ffprobe) — the BP scorer's signal. */
  durationS: number | null;
  /** #173 vote ladder: when present (non-undefined) the genre rungs
   *  COLLECT votes instead of first-win writing; the ONE election +
   *  write happens in stageGenreElection. Undefined keeps the legacy
   *  first-win behavior exactly. */
  genreVotes?: GenreVote[] | undefined;
}

/** SC search result shape (first hit feeds genre + year + art). */
export interface ScHit {
  url: string;
  thumb?: string | null;
  genre?: string | null;
  year?: number | null;
}

/** Diff DB truth vs the row: which tag fields are missing and what value
 *  each should get. Pure — no writes, no stats (stageTags applies it). */
function missingTagValues(
  r: Row,
  truth: StageCtx["truth"],
  artist: string | null,
): TagValues {
  const vals: TagValues = {};
  if (!truth.title) vals.title = cleanTitle(r.title);
  if (!truth.artist && artist) vals.artist = artist;
  if (!truth.album && artist)
    vals.album = r.album ?? `${artist} - Unknown Album`;
  if (!truth.genre && r.genre && r.genre !== "Music") vals.genre = r.genre;
  return vals;
}

/** Strip a composed junk prefix from a DB title ("UnknownArtist ·
 *  UnknownAlbum · real title" was baked in by the Sep 11 pool batch). */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^UnknownArtist\s*(?:·\s*UnknownAlbum\s*)?·\s*/iu, "")
    .trim();
}

/** Junk album detector: a literal "UnknownAlbum" carries no information. */
function cleanAlbum(a: string | null): string | null {
  if (!a) return null;
  return /^unknown\s*album$/iu.test(a.trim()) ? null : a;
}

/** The DB-row refresh half of stageTags: each column takes the value we
 *  wrote, falling back to the truth it filled in for. Junk-composed DB
 *  values are repaired here too — refreshTrackRow is what UN-bakes the
 *  "UnknownArtist · UnknownAlbum · X" rows from the Sep 11 pool batch. */
function refreshTrackRow(
  r: Row,
  truth: StageCtx["truth"],
  artist: string | null,
  vals: TagValues,
): void {
  // A literal "UnknownAlbum" carries no information — prefer the row's
  // existing real album, else leave what we wrote (never store junk).
  const junkAlbum = truth.album ? cleanAlbum(truth.album) : null;
  const junkArtist = cleanArtist(artist);
  db.query(
    "UPDATE tracks SET title=?, artist=?, album=?, genre=? WHERE video_id=?",
  ).run(
    vals.title ?? truth.title ?? cleanTitle(r.title),
    vals.artist ?? junkArtist ?? cleanArtist(r.artist),
    vals.album ?? junkAlbum,
    vals.genre ?? truth.genre,
    r.video_id,
  );
}

/** Stage 1 — DB metadata → file tags (missing fields only). */
export function stageTags(t: StageCtx): void {
  if (!t.needTags || t.dry) return;
  const r = t.row;
  // cleanArtist guards against DB rows carrying junk composed artist
  // strings ("UnknownArtist · UnknownAlbum · X") — never write those.
  const artist = cleanArtist(t.truth.artist) ?? cleanArtist(r.artist);
  const vals = missingTagValues(r, t.truth, artist);
  if (!Object.keys(vals).length) return;
  if (!setFileTags(r.file_path, vals)) return;
  t.stats.tags++;
  t.notes.push(`tags(${Object.keys(vals).join(",")})`);
  refreshTrackRow(r, t.truth, artist, vals);
}

/** SC-path year stamp: file tag + DB row + stat + note, in one call (the
 *  art path and the direct year path were identical 8-liners). */
export function markYear(t: StageCtx, year: number): void {
  // Tag write first: the DB row only records a value that reached the
  // file — a failed write leaves the field "still missing" for the next
  // run instead of a DB row lying about the file.
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

// ---- source fan-out stages (#188) ----------------------------------------
// Each catalog lookup is a stage: it owns its want-decision (which fields
// still need that source), performs the one search, and writes the hit
// onto the Ctx. The pipeline body stays a flat sequencer with identical
// stage order — the lookups were inline fan-out branches before.

/** Fan-out 1 — Beatport lookup (second source, behind SC). One catalog
 *  search feeds genre AND year AND art AND identity. Runs when any
 *  Beatport-fed field is needed; SC wins every field it covers. */
export async function fanOutBeatport(t: StageCtx): Promise<void> {
  const needsIdentity =
    t.needTags &&
    (!t.truth.label || !t.truth.mixName || !t.truth.isrc || !t.truth.remixer);
  if (t.dry || !(t.needGenre || t.needArt || t.needYear || needsIdentity))
    return;
  t.bpBest = await beatportLookup({
    artist: cleanArtist(t.truth.artist) ?? cleanArtist(t.row.artist),
    title: cleanTitle(t.truth.title ?? t.row.title),
    durationS: t.durationS ?? undefined,
  });
}

/** Fan-out 2 — SoundCloud search (first source). One yt-dlp call feeds
 *  genre AND art AND year. Returns the first hit for the art/genre/year
 *  stages; null when nothing was wanted or the search missed. */
export async function fanOutSoundcloud(t: StageCtx): Promise<ScHit | null> {
  if (t.dry || !(t.needGenre || t.needArt || t.upgradeSc || t.needYear))
    return null;
  const sc = await scSearch(t.row);
  return sc?.[0] ?? null;
}

/** Fan-out 3 — Bandcamp vote search (third source). The page fetch inside
 *  stageBandcamp is the expensive leg, so the search only fires when SC
 *  and BP BOTH left a Bandcamp-readable field unfilled (genre/year/label).
 *  Search hits were artist-gated in bandcamp.ts (scoreBcHits). */
export async function fanOutBandcamp(
  t: StageCtx,
  scGenreWon: boolean,
  scYearWon: boolean,
): Promise<void> {
  const wantsBcGenre =
    t.needGenre && !scGenreWon && !(t.bpBest && bpGenre(t.bpBest));
  const wantsBcYear = t.needYear && !scYearWon && !t.bpBest?.year;
  const wantsBcLabel = t.needTags && !t.truth.label && !t.bpBest?.label;
  if (t.dry || !(wantsBcGenre || wantsBcYear || wantsBcLabel)) return;
  t.bcBest = await bcSearch({
    artist: cleanArtist(t.truth.artist) ?? cleanArtist(t.row.artist),
    title: cleanTitle(t.truth.title ?? t.row.title),
  });
}

/** SC vote rung: the same junk gates as first-win, then COLLECTED. */
import {
  GENRE_VOTE_WEIGHTS,
  electGenre,
  serializeVotes,
  type GenreVote,
} from "../../src/fulltags/genre-vote";

/** One SC genre win: canonicalize → file tag + DB row + stat + note.
 *  Structurally typed on GenreYearCtx (the stage-2 arms' context) — the
 *  arm-split module in fetch-genre-year.ts calls this injected rung.
 *  #173: when the ctx carries a vote accumulator it COLLECTS (the
 *  election writes once, in stageGenreElection); without one it keeps
 *  the legacy first-win write. */
export function applyScGenre(
  t: Parameters<typeof stageGenreArm>[0],
  rawGenre: string,
): void {
  // Junk gate: numeric genres (SC genre IDs leaked through yt-dlp) and the
  // placeholder "Music" are not genres — refuse, never write them anywhere.
  if (/^\d+$/.test(rawGenre) || rawGenre.toLowerCase() === "music") return;
  const g = canonGenre(rawGenre);
  if (t.genreVotes !== undefined) {
    // vote mode: collect, never write (the election owns the write)
    t.genreVotes.push({
      rung: "sc",
      genre: g,
      weight: GENRE_VOTE_WEIGHTS.sc,
    });
    t.stats.genreSc++;
    t.notes.push(`genre:${g} (sc, vote)`);
    return;
  }
  // Tag write first, DB row only on success — the DB never claims a genre
  // the file doesn't carry (the discipline markYear and the BP path use;
  // the SC path silently skipped it and could leave a lying DB row).
  if (!setFileTags(t.row.file_path, { genre: g })) {
    t.notes.push("genre:WRITE-FAILED");
    return;
  }
  db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(g, t.row.video_id);
  t.stats.genreSc++;
  t.notes.push(`genre:${g}`);
}

/** The #128 imprint prior vote lives in fetch-genre-year.ts now (the
 *  stage-2 arms' shared rung); bcApplyGenre keeps its own copy of the
 *  write-first shape because the Bandcamp consume-on-failed-write
 *  semantics differ (see its comment). */

/** The Bandcamp genre vote: canonicalize the page's best tag through the
 *  SAME junk gates every other source funnels through (numeric refuse,
 *  "Music" refuse — applyScGenre's guard class, inside bcGenre). Never
 *  invents a label: an unmapped tag set returns null and the ladder
 *  moves on. #173: in vote mode it COLLECTS (weight W2b) and still
 *  consumes the fetch (the page fetch is the scarce resource); the
 *  election owns the write. */
function bcApplyGenre(t: StageCtx, page: BcPage): boolean {
  const g = bcGenre(page, canonGenre);
  if (!g) return false;
  if (t.genreVotes !== undefined) {
    t.genreVotes.push({
      rung: "bc",
      genre: g,
      weight: GENRE_VOTE_WEIGHTS.bc,
    });
    t.stats.genreBc++;
    t.notes.push(`genre:${g} (bc, vote)`);
    return true; // consumed: the page fetch already happened
  }
  if (!setFileTags(t.row.file_path, { genre: g })) {
    t.notes.push("genre:WRITE-FAILED (bc)");
    return true; // consumed: stop the ladder even though the write failed
  }
  db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(g, t.row.video_id);
  t.stats.genreBc++;
  t.notes.push(`genre:${g} (bc)`);
  return true;
}

/** Stage 2b — Bandcamp vote, THIRD in the ladder (behind SC and BP).
 *  Only runs when SC and BP both missed the field, so the extra page
 *  fetch stays rare; the search hit was already artist-gated in
 *  bandcamp.ts. Fills genre first (tag list), then year (publish date),
 *  then label (the publisher field only BP also carries). Synchronous
 *  DB/tag writes per the markYear discipline; page fetch is the one
 *  async leg, done once per task and shared across the three fields. */
export async function stageBandcamp(
  t: StageCtx,
  wantGenre: boolean,
  wantYear: boolean,
  wantLabel: boolean,
): Promise<void> {
  if (t.dry || !t.bcBest) return;
  if (!wantGenre && !wantYear && !wantLabel) return;
  const page = await bcFetchPage(t.bcBest.url);
  if (!page) return;
  let filled = false;
  if (wantGenre && !t.truth.genre && bcApplyGenre(t, page)) filled = true;
  if (
    wantYear &&
    !t.truth.year &&
    page.datePublished &&
    setFileTags(t.row.file_path, {
      year: Number(page.datePublished.slice(0, 4)),
    })
  ) {
    const y = page.datePublished.slice(0, 4);
    db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
      y,
      t.row.video_id,
    );
    t.stats.yearBc++;
    t.notes.push(`year:${y} (bc)`);
    filled = true;
  }
  if (wantLabel && !t.truth.label && page.label) {
    db.query("UPDATE tracks SET label=? WHERE video_id=?").run(
      page.label,
      t.row.video_id,
    );
    t.stats.bcFilled++;
    t.notes.push(`label:${page.label} (bc)`);
    filled = true;
  }
  if (filled) t.stats.bcFilled++;
}

/** Stage 2 — SC search hit → genre + year (the cheap half of the fan-out;
 *  original-res art needs the page fetch and lives in stage 3). The two
 *  ladders live in fetch-genre-year.ts (#42 arm split); this is the
 *  dispatcher: dry gate + want gates, then one call per ladder.
 *
 *  #173 vote mode: the caller (fetch-pipeline) opens the accumulator on
 *  the ctx; the SC rung votes through voteScGenre below, and the one
 *  election+write happens in stageGenreElection. */
export function stageGenreYear(t: StageCtx, best: ScHit | null): void {
  if (t.dry) return;
  if (t.needGenre) stageGenreArm(t, best, applyScGenre);
  if (t.needYear) stageYearArm(t, best);
}

/** #173 SC vote rung: the SAME junk gates as the first-win arm (numeric
 *  refuse, "Music" refuse — the genre ID leak class), then a COLLECTED
 *  vote instead of an immediate write (handled inside applyScGenre).
 *  Sourced from the search hit the hard artist gate already filtered
 *  (scoreScHits). */

/** #173 the ONE genre write for a voted track: elect + file-tag + DB row
 *  + breakdown persist. Write-first discipline preserved — a failed tag
 *  write leaves BOTH the DB genre and the breakdown untouched (the DB
 *  never claims a genre the file doesn't carry). The vote mode never
 *  overwrites an existing label (COALESCE in the injected writeRow):
 *  re-runs stay idempotent, and a stronger late rung wins on the NEXT
 *  re-fetch of an empty row per the issue's acceptance. */
export function stageGenreElection(
  t: StageCtx,
  writeRow: (videoId: string, genre: string, votes: string) => void,
): void {
  if (t.dry) return;
  const votes = t.genreVotes;
  if (!votes || votes.length === 0) return;
  const elected = electGenre(votes);
  if (elected.genre === null) return;
  if (!setFileTags(t.row.file_path, { genre: elected.genre })) {
    t.notes.push("genre:WRITE-FAILED (vote election)");
    return;
  }
  writeRow(t.row.video_id, elected.genre, serializeVotes(votes));
  t.notes.push(
    `genre:${elected.genre} ELECTED w=${elected.weight.toFixed(2)} [${elected.winnerRungs.join("+")}]`,
  );
}

/** Stage 2.5 — Beatport identity fields (label / mix name / ISRC /
 * official remixer) straight into the file. Only what NO other source
 * carries, only when the file lacks it (ground truth). The TXXX:BP-FIELDS
 * provenance stamp rides along so a bp-filled field is always
 * identifiable — 1:1 with the fulltags single-file pipeline. */
export function stageBeatportIdentity(t: StageCtx): void {
  if (t.dry || !t.needTags || !t.bpBest) return;
  const vals: TagValues = {};
  const bpFields: [string, string | number][] = [];
  if (!t.truth.label && t.bpBest.label) {
    vals.label = t.bpBest.label;
    bpFields.push(["label", t.bpBest.label]);
  }
  if (
    !t.truth.mixName &&
    t.bpBest.mixName &&
    !/^original mix$/i.test(t.bpBest.mixName)
  ) {
    vals.mixName = t.bpBest.mixName;
    bpFields.push(["mix", t.bpBest.mixName]);
  }
  if (!t.truth.isrc && t.bpBest.isrc) {
    vals.isrc = t.bpBest.isrc;
    bpFields.push(["isrc", t.bpBest.isrc]);
  }
  if (!t.truth.remixer && t.bpBest.remixers.length > 0) {
    const credit = t.bpBest.remixers.join(", ");
    vals.remixer = credit;
    bpFields.push(["remixer", credit]);
  }
  if (!Object.keys(vals).length) return;
  const stamp = bpStamp(bpFields);
  if (stamp) vals.beatport = stamp;
  if (!setFileTags(t.row.file_path, vals)) {
    t.notes.push("bp-identity:WRITE-FAILED");
    return;
  }
  t.stats.bpIdentity++;
  t.notes.push(`bp:${bpFields.map(([k]) => k).join(",")}`);
}
