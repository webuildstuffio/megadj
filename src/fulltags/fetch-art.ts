// fetch-art.ts — stage 3's artwork family (#89/#90 diet extraction from
// fetch-stages.ts): the SC hit path (original-res aware) and the fallback
// ladder (beatport → bandcamp → gateway → mp3-twin → deezer → itunes).
// Write-first discipline lives here: an art byte only lands when the
// embed succeeded; the DB artwork_status is written by the same step.
import {
  artUrlLarge,
  beatportArt,
  db,
  deezerArt,
  embedArt,
  fetchBestScArt,
  fetchImage,
  gatewayArt,
  itunesArtwork as itunesArtUrl,
  pageOgImage,
  twinArt,
  type Row,
} from "./archive-ledger";
import type { ScHit, StageCtx, Stats } from "./fetch-stages";

/** markArt + genre/year piggyback helper import shape: applyScGenre and
 *  markYear are injected (they live in fetch-stages / fetch-genre-year
 *  and carry the junk gates + vote-mode branches). */
type ScGenreRung = (t: StageCtx, rawGenre: string) => void;
type YearMark = (t: StageCtx, year: number) => void;

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

async function scArt(
  t: StageCtx,
  best: ScHit,
  applyScGenre: ScGenreRung,
  markYear: YearMark,
): Promise<boolean> {
  const og = await pageOgImage(best.url);
  const bytes = og
    ? await fetchBestScArt(og)
    : best.thumb
      ? await fetchImage(best.thumb)
      : null;
  if (!bytes) return false;
  if (!embedArt(t.row.file_path, bytes)) return false;
  const orig = og?.includes("-original") === true;
  markArt(t, `sc${orig ? "-orig" : ""}`, orig, `sc:${best.url}`);
  // SC hit can also fill genre when the cheap stage didn't run. The same
  // junk gate + write-first discipline as applyScGenre — a bare DB write
  // here bypassed both (numeric IDs could land via this path, and the row
  // could claim a genre the file never received).
  if (best.genre && t.needGenre) applyScGenre(t, best.genre);
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

/** Stage 3b — fallback ladder: beatport → bandcamp → gateway → mp3-twin →
 *  deezer → itunes. Beatport outranks the gateway scrape: the store's
 *  official release master (1500²) beats a hype-page screenshot. Bandcamp
 *  sits behind Beatport (its og:image is the official cover art when the
 *  artist-gated hit is the real release page). */
async function fallbackArt(t: StageCtx): Promise<boolean> {
  const r = t.row;
  const ladder: {
    stat: keyof Stats;
    label: string;
    bytes: Promise<Uint8Array | null> | Uint8Array | null;
  }[] = [
    {
      stat: "artBeatport",
      label: "beatport",
      bytes: t.bpBest ? beatportArt(t.bpBest) : null,
    },
    {
      stat: "artBandcamp",
      label: "bandcamp",
      bytes: t.bcBest?.artUrl
        ? fetchImage(artUrlLarge(t.bcBest.artUrl) ?? t.bcBest.artUrl)
        : null,
    },
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
  applyScGenre: ScGenreRung,
  markYear: YearMark,
): Promise<boolean> {
  if (!t.needArt || t.dry) return true;
  if (best && (await scArt(t, best, applyScGenre, markYear))) return true;
  // Beatport official release art — second rung, ahead of the gateway
  // scrape (its ladder slot is inside fallbackArt).
  return fallbackArt(t);
}
