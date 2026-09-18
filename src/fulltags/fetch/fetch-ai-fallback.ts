// fetch-ai-fallback.ts — the post-pass AI fallback legs of runFetch
// (#88 item 1): batched genre, batched year (+genre), and the artless
// queue append. Each takes the collected batches + the running Stats and
// mutates stats in place. OPT-IN: batches stay empty unless --ai-fallback
// collected them (the stage gate keeps them clean).
import { appendFile } from "node:fs/promises";
import { aiGenres } from "../analysis/ai";
import {
  QUEUE,
  db,
  setFileTags,
  type Row,
  type TagValues,
} from "../archive-ledger";
import type { Stats } from "./fetch-stages";

const BATCH = 20;

/** AI genre fallback for the rows SC + Beatport + Bandcamp all missed. */
export async function aiGenreFallback(
  batch: Row[],
  stats: Stats,
  dry: boolean,
  jsonOut: boolean,
): Promise<void> {
  if (!batch.length || dry) return;
  if (!jsonOut) console.log(`AI genre fallback for ${batch.length}…`);
  for (let k = 0; k < batch.length; k += BATCH) {
    const slice = batch.slice(k, k + BATCH);
    const res = await aiGenres(slice);
    for (const [vid, result] of res) {
      const genre = result[0];
      if (!genre) continue;
      const row = slice.find((b) => b.video_id === vid)!;
      db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(genre, vid);
      setFileTags(row.file_path, {
        genre,
        aiGenre: `${genre}|${result[2] ?? 1}`,
      });
      stats.genreAi++;
    }
  }
  if (!jsonOut) console.log(`  AI set: ${stats.genreAi}/${batch.length}`);
}

/** AI year fallback — one batched call: genre + year together. */
export async function aiYearFallback(
  batch: Row[],
  stats: Stats,
  dry: boolean,
  jsonOut: boolean,
): Promise<void> {
  if (!batch.length || dry) return;
  if (!jsonOut) console.log(`\nAI year fallback for ${batch.length}…`);
  for (let k = 0; k < batch.length; k += BATCH) {
    const slice = batch.slice(k, k + BATCH);
    const res = await aiGenres(slice, true);
    for (const [vid, result] of res) {
      const [genre, year, confidence] = result;
      const row = slice.find((b) => b.video_id === vid)!;
      const vals: TagValues = {};
      if (genre) {
        db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(genre, vid);
        vals.genre = genre;
        vals.aiGenre = `${genre}|${confidence ?? 1}`;
        stats.genreAi++;
      }
      if (year) {
        db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
          String(year),
          vid,
        );
        vals.year = year;
        vals.aiYear = `${year}|${confidence ?? 1}`;
        stats.yearAi++;
      }
      if (Object.keys(vals).length) setFileTags(row.file_path, vals);
    }
  }
  if (!jsonOut) {
    console.log(
      `  AI years set: ${stats.yearAi}/${batch.length} (genres too where missing: +${stats.genreAi})`,
    );
  }
}

/** Append the artless rows to the AI cover queue (the last rung). */
export async function queueArtless(
  artless: Row[],
  dry: boolean,
): Promise<void> {
  if (!artless.length || dry) return;
  const lines = artless
    .filter((r) => r.artist && r.title)
    .map((r) =>
      JSON.stringify({
        path: r.file_path,
        title: r.title,
        artist: r.artist,
        album: r.album,
        reason: "no-online-cover",
      }),
    );
  if (lines.length) await appendFile(QUEUE, `${lines.join("\n")}\n`);
}
