// fetch-stages.ts — processTask's stage runners, extracted from
// tools/fetch-all.ts so each stage reads (and reports CCN) on its own:
// tags-from-DB, the SC-search fan-out (genre + year + original-res art),
// and the art fallback ladder (gateway → mp3-twin → deezer → itunes).
// Shared mutable state (Stats, notes, the AI batches) rides a Ctx the
// stages mutate; the orchestration order stays in fetch-all.ts.

import {
  canonGenre,
  db,
  deezerArt,
  embedArt,
  fetchBestScArt,
  fetchImage,
  gatewayArt,
  itunesArtwork as itunesArtUrl,
  pageOgImage,
  setFileTags,
  twinArt,
  type Row,
  type TagValues,
} from "./fetch-lib";

/** Where the SC-art fallback ladder stops being tried (artless → queue). */
export interface Stats {
  tags: number;
  genreSc: number;
  genreAi: number;
  artSc: number;
  artScOrig: number;
  artGateway: number;
  artTwin: number;
  artDeezer: number;
  artItunes: number;
  yearSc: number;
  yearAi: number;
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
  if (!truth.title) vals.title = r.title;
  if (!truth.artist && artist) vals.artist = artist;
  if (!truth.album && artist)
    vals.album = r.album ?? `${artist} - Unknown Album`;
  if (!truth.genre && r.genre && r.genre !== "Music") vals.genre = r.genre;
  return vals;
}

/** The DB-row refresh half of stageTags: each column takes the value we
 *  wrote, falling back to the truth it filled in for. */
function refreshTrackRow(
  r: Row,
  truth: StageCtx["truth"],
  artist: string | null,
  vals: TagValues,
): void {
  db.query(
    "UPDATE tracks SET title=?, artist=?, album=?, genre=? WHERE video_id=?",
  ).run(
    vals.title ?? truth.title ?? r.title,
    vals.artist ?? artist,
    vals.album ?? truth.album,
    vals.genre ?? truth.genre,
    r.video_id,
  );
}

/** Stage 1 — DB metadata → file tags (missing fields only). */
export function stageTags(t: StageCtx): void {
  if (!t.needTags || t.dry) return;
  const r = t.row;
  const artist = t.truth.artist ?? r.artist ?? null;
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
  setFileTags(t.row.file_path, { year });
  db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
    String(year),
    t.row.video_id,
  );
  t.stats.yearSc++;
  t.notes.push(`year:${year}`);
}

/** Record an SC-art win: stats bucket + note + tracks.artwork_status. */
function markArt(
  t: StageCtx,
  label: string,
  origRes: boolean,
  formatId?: string,
): void {
  if (origRes) t.stats.artScOrig++;
  else t.stats.artSc++;
  t.notes.push(`art:sc${origRes ? "-orig" : ""}`);
  db.query(
    formatId
      ? "UPDATE tracks SET artwork_status=?, format_id=? WHERE video_id=?"
      : "UPDATE tracks SET artwork_status=? WHERE video_id=?",
  ).run(`embedded:${label}`, ...(formatId ? [formatId] : []), t.row.video_id);
}

/** One SC genre win: canonicalize → DB row + file tag + stat + note. */
function applyScGenre(t: StageCtx, rawGenre: string): void {
  const g = canonGenre(rawGenre);
  db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(g, t.row.video_id);
  setFileTags(t.row.file_path, { genre: g });
  t.stats.genreSc++;
  t.notes.push(`genre:${g}`);
}

/** Stage 2 — SC search hit → genre + year (the cheap half of the fan-out;
 *  original-res art needs the page fetch and lives in stage 3). */
export function stageGenreYear(t: StageCtx, best: ScHit | null): void {
  if (t.dry) return;
  if (t.needGenre) {
    if (best?.genre) {
      applyScGenre(t, best.genre);
    } else {
      t.aiGenreBatch.push(t.row);
    }
  }
  if (t.needYear) {
    if (best?.year) {
      markYear(t, best.year);
    } else {
      t.aiYearBatch.push(t.row);
    }
  }
}

/** Stage 3a — SC art: page og:image at original resolution, thumb fallback. */
async function scArt(t: StageCtx, best: ScHit): Promise<boolean> {
  const og = await pageOgImage(best.url);
  const bytes = og
    ? await fetchBestScArt(og)
    : best.thumb
      ? await fetchImage(best.thumb)
      : null;
  if (!bytes) return false;
  if (!embedArt(t.row.file_path, bytes)) return false;
  const orig = !!og?.includes("-original");
  markArt(t, `sc${orig ? "-orig" : ""}`, orig, `sc:${best.url}`);
  // SC hit can also fill genre/year when the cheap stage didn't run
  if (best.genre && t.needGenre) {
    const g = canonGenre(best.genre);
    db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
      g,
      t.row.video_id,
    );
  }
  if (best.year && t.needYear) markYear(t, best.year);
  return true;
}

/** One ladder win: stat + note + DB artwork_status (the record step). */
function recordArtWin(
  t: StageCtx,
  stat: keyof Stats,
  label: string,
  r: Row,
): void {
  t.stats[stat]++;
  t.notes.push(`art:${label}`);
  db.query("UPDATE tracks SET artwork_status=? WHERE video_id=?").run(
    `embedded:${label}`,
    r.video_id,
  );
}

/** Stage 3b — fallback ladder: gateway → mp3-twin → deezer → itunes. */
async function fallbackArt(t: StageCtx): Promise<boolean> {
  const r = t.row;
  const ladder: Array<{
    stat: keyof Stats;
    label: string;
    bytes: Promise<Uint8Array | null> | Uint8Array | null;
  }> = [
    {
      stat: "artGateway",
      label: "gateway",
      bytes: gatewayArt(r).then((g) => g?.bytes ?? null),
    },
    { stat: "artTwin", label: "mp3-twin", bytes: twinArt(r) },
    { stat: "artDeezer", label: "deezer", bytes: deezerArt(r) },
    {
      stat: "artItunes",
      label: "itunes",
      bytes: itunesArtUrl(r.artist ?? "", r.album ?? r.title).then((u) =>
        u ? fetchImage(u) : null,
      ),
    },
  ];
  for (const step of ladder) {
    const bytes = await step.bytes;
    if (bytes && embedArt(r.file_path, bytes)) {
      recordArtWin(t, step.stat, step.label, r);
      return true;
    }
  }
  return false;
}

/** Stage 3 — artwork. Returns false when every source missed (→ artless). */
export async function stageArt(
  t: StageCtx,
  best: ScHit | null,
): Promise<boolean> {
  if (!t.needArt || t.dry) return true;
  if (best && (await scArt(t, best))) return true;
  return fallbackArt(t);
}
