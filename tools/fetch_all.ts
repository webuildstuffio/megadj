/**
 * fetch_all.ts — THE one-shot fetch pipeline: metadata + genre + artwork for
 * every archive track. Ground-truth verified (reads files, not the DB),
 * parallel, idempotent — safe to re-run any time.
 *
 * Per track (skips whatever is already complete):
 *   1. tags    — title/artist/album/genre/year from DB → file
 *   2. genre   — SoundCloud tag (via search) → OpenRouter classifier (conf ≥ 0.7)
 *   3. artwork — SC search → SC page og:image at ORIGINAL resolution →
 *                gateway (hypeddit/hyperfollow) → mp3-twin → Deezer →
 *                iTunes → append to AI cover queue (last resort)
 *   4. year    — SC upload timestamp = the remix/edit year (NOT the
 *                original's) → OpenRouter fallback → file release_year
 *
 * One yt-dlp call per track feeds genre AND art AND year.
 *
 * usage:
 *   bun tools/fetch_all.ts                 # fill everything missing
 *   bun tools/fetch_all.ts --all           # + upgrade existing SC art to original res
 *   bun tools/fetch_all.ts --art           # artwork only
 *   bun tools/fetch_all.ts --genres        # genres only
 *   bun tools/fetch_all.ts --tags          # tags only
 *   bun tools/fetch_all.ts --years         # years only
 *   bun tools/fetch_all.ts --jobs 8        # workers (default 6)
 *   bun tools/fetch_all.ts --dry-run       # report what would happen
 *
 * env: OPENROUTER_API_KEY (only needed for AI genre/year fallback + covers)
 *
 * Shared plumbing lives in tools/fetch_lib.ts.
 */
import {
  ARCH,
  QUEUE,
  canonGenre,
  db,
  deezerArt,
  fetchBestScArt,
  fetchImage,
  gatewayArt,
  groundTruth,
  archiveFiles,
  itunesArt,
  pageOgImage,
  scSearch,
  setFileTags,
  twinArt,
  embedArt,
  type Row,
  type TagValues,
} from "./fetch_lib";
import { aiGenres, albumHeuristic } from "./fetch_ai";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { appendFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const ONLY = (
  argv.includes("--art")
    ? "art"
    : argv.includes("--genres")
      ? "genres"
      : argv.includes("--tags")
        ? "tags"
        : argv.includes("--years")
          ? "years"
          : "all"
) as "art" | "genres" | "tags" | "years" | "all";
const DRY = argv.includes("--dry-run");
const t0 = Date.now();
const jobsArg = argv.indexOf("--jobs");
const JOBS = Math.max(1, Number(jobsArg !== -1 ? argv[jobsArg + 1] : 6) || 6);

interface Task {
  row: Row;
  truth: ReturnType<typeof groundTruth>;
  needTags: boolean;
  needGenre: boolean;
  needArt: boolean;
  needYear: boolean;
  upgradeSc: boolean;
}

interface Stats {
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

async function processTask(
  t: Task,
  i: number,
  total: number,
  stats: Stats,
  aiGenreBatch: Row[],
  aiYearBatch: Row[],
  artless: Row[],
): Promise<void> {
  const { row: r, truth } = t;
  const name = `${r.artist ?? "?"} - ${r.title}`.slice(0, 56);
  const notes: string[] = [];

  // ---- 1. tags (DB → file) ----
  if (t.needTags && !DRY) {
    const artist = truth.artist ?? r.artist ?? null;
    const vals: TagValues = {};
    if (!truth.title) vals.title = r.title;
    if (!truth.artist && artist) vals.artist = artist;
    if (!truth.album && artist)
      vals.album = r.album ?? albumHeuristic(artist, basename(r.file_path));
    if (!truth.genre && r.genre && r.genre !== "Music") vals.genre = r.genre;
    if (Object.keys(vals).length && setFileTags(r.file_path, vals)) {
      stats.tags++;
      notes.push(`tags(${Object.keys(vals).join(",")})`);
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
  }

  // ---- 2+3+4. SC search feeds genre AND art AND year ----
  const wantsSc = t.needGenre || t.needArt || t.upgradeSc || t.needYear;
  const sc = wantsSc && !DRY ? scSearch(r) : null;
  const best = sc?.[0];

  if (t.needGenre && !DRY) {
    if (best?.genre) {
      const g = canonGenre(best.genre);
      db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(g, r.video_id);
      setFileTags(r.file_path, { genre: g });
      stats.genreSc++;
      notes.push(`genre:${g}`);
    } else {
      aiGenreBatch.push(r);
    }
  }

  if (t.needYear && !DRY) {
    if (best?.year) {
      setFileTags(r.file_path, { year: best.year });
      db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
        String(best.year),
        r.video_id,
      );
      stats.yearSc++;
      notes.push(`year:${best.year}`);
    } else {
      aiYearBatch.push(r);
    }
  }

  if (t.needArt && !DRY) {
    let done = false;
    // 3a. SC search hit → original-res page art (best quality path)
    if (best) {
      const og = await pageOgImage(best.url);
      const bytes = og
        ? await fetchBestScArt(og)
        : best.thumb
          ? await fetchImage(best.thumb)
          : null;
      const isOrig = !!og?.includes("-original");
      if (bytes && embedArt(r.file_path, bytes)) {
        done = true;
        if (isOrig) stats.artScOrig++;
        else stats.artSc++;
        notes.push(`art:sc${isOrig ? "-orig" : ""}`);
        db.query(
          "UPDATE tracks SET artwork_status=?, format_id=? WHERE video_id=?",
        ).run(
          `embedded:sc${isOrig ? "-orig" : ""}`,
          `sc:${best.url}`,
          r.video_id,
        );
        if (best.genre && t.needGenre) {
          const g = canonGenre(best.genre);
          db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
            g,
            r.video_id,
          );
        }
        if (best.year && t.needYear) {
          setFileTags(r.file_path, { year: best.year });
          db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
            String(best.year),
            r.video_id,
          );
          stats.yearSc++;
          notes.push(`year:${best.year}`);
        }
      }
    }
    // 3b. gateway
    if (!done) {
      const gw = await gatewayArt(r);
      if (gw && embedArt(r.file_path, gw.bytes)) {
        done = true;
        stats.artGateway++;
        notes.push("art:gateway");
        db.query(
          "UPDATE tracks SET artwork_status='embedded:gateway' WHERE video_id=?",
        ).run(r.video_id);
      }
    }
    // 3c. twin
    if (!done) {
      const twin = twinArt(r);
      if (twin && embedArt(r.file_path, twin)) {
        done = true;
        stats.artTwin++;
        notes.push("art:twin");
        db.query(
          "UPDATE tracks SET artwork_status='embedded:mp3-twin' WHERE video_id=?",
        ).run(r.video_id);
      }
    }
    // 3d. deezer
    if (!done) {
      const dz = await deezerArt(r);
      if (dz && embedArt(r.file_path, dz)) {
        done = true;
        stats.artDeezer++;
        notes.push("art:deezer");
        db.query(
          "UPDATE tracks SET artwork_status='embedded:deezer' WHERE video_id=?",
        ).run(r.video_id);
      }
    }
    // 3e. itunes
    if (!done) {
      const it = await itunesArt(r);
      if (it && embedArt(r.file_path, it)) {
        done = true;
        stats.artItunes++;
        notes.push("art:itunes");
        db.query(
          "UPDATE tracks SET artwork_status='embedded:itunes' WHERE video_id=?",
        ).run(r.video_id);
      }
    }
    if (!done) artless.push(r);
  }

  if (notes.length)
    console.log(`  [${i + 1}/${total}] ${notes.join(" ")} — ${name}`);
  else if (DRY)
    console.log(
      `  [${i + 1}/${total}] (dry) tags:${t.needTags} genre:${t.needGenre} art:${t.needArt} year:${t.needYear} — ${name}`,
    );
}

async function main() {
  const files = archiveFiles();
  const rows = (
    db
      .query(
        "SELECT video_id, title, artist, album, genre, file_path, format_id FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'",
      )
      .all() as Row[]
  ).filter(
    (r) =>
      files.has(r.file_path.split("/").pop() ?? "") && existsSync(r.file_path),
  );

  const tasks: Task[] = [];
  for (const r of rows) {
    const truth = groundTruth(r.file_path);
    const genreOk = truth.genre && truth.genre !== "Music";
    const needTags =
      (ONLY === "all" || ONLY === "tags") &&
      (!truth.title || !truth.artist || !truth.album || !genreOk);
    const needGenre = (ONLY === "all" || ONLY === "genres") && !genreOk;
    const needYear = (ONLY === "all" || ONLY === "years") && !truth.year;
    const upgradeSc = ALL && !!r.format_id?.startsWith("sc:");
    const needArt =
      (ONLY === "all" || ONLY === "art") && (!truth.art || upgradeSc);
    if (needTags || needGenre || needArt || needYear)
      tasks.push({
        row: r,
        truth,
        needTags,
        needGenre,
        needArt,
        needYear,
        upgradeSc,
      });
  }

  console.log(
    `fetch_all: ${rows.length} tracks | tasks: ${tasks.length} (tags ${tasks.filter((t) => t.needTags).length}, genres ${tasks.filter((t) => t.needGenre).length}, art ${tasks.filter((t) => t.needArt).length}, years ${tasks.filter((t) => t.needYear).length}) | jobs: ${JOBS}${ALL ? " [--all upgrade]" : ""}${DRY ? " [DRY RUN]" : ""}\n`,
  );

  const stats: Stats = {
    tags: 0,
    genreSc: 0,
    genreAi: 0,
    artSc: 0,
    artScOrig: 0,
    artGateway: 0,
    artTwin: 0,
    artDeezer: 0,
    artItunes: 0,
    yearSc: 0,
    yearAi: 0,
  };
  const aiGenreBatch: Row[] = [];
  const aiYearBatch: Row[] = [];
  const artless: Row[] = [];

  let idx = 0;
  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= tasks.length) break;
      try {
        await processTask(
          tasks[my]!,
          my,
          tasks.length,
          stats,
          aiGenreBatch,
          aiYearBatch,
          artless,
        );
      } catch (err) {
        console.log(
          `  [${my + 1}/${tasks.length}] ✗ error: ${(err as Error).message?.slice(0, 80)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, () => worker()));

  // ---- AI genre fallback (batched, after the parallel pass) ----
  if (aiGenreBatch.length && !DRY) {
    console.log(`\nAI genre fallback for ${aiGenreBatch.length}…`);
    for (let k = 0; k < aiGenreBatch.length; k += 20) {
      const batch = aiGenreBatch.slice(k, k + 20);
      const res = await aiGenres(batch);
      for (const [vid, result] of res) {
        const genre = result[0];
        if (!genre) continue;
        const row = batch.find((b) => b.video_id === vid)!;
        db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(genre, vid);
        setFileTags(row.file_path, { genre });
        stats.genreAi++;
      }
    }
    console.log(`  AI set: ${stats.genreAi}/${aiGenreBatch.length}`);
  }

  // ---- AI year fallback (single batched call: genre + year together) ----
  if (aiYearBatch.length && !DRY) {
    console.log(`\nAI year fallback for ${aiYearBatch.length}…`);
    for (let k = 0; k < aiYearBatch.length; k += 20) {
      const batch = aiYearBatch.slice(k, k + 20);
      const res = await aiGenres(batch, true);
      for (const [vid, result] of res) {
        const [genre, year] = result;
        const row = batch.find((b) => b.video_id === vid)!;
        const vals: TagValues = {};
        if (genre) {
          db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
            genre,
            vid,
          );
          vals.genre = genre;
          stats.genreAi++;
        }
        if (year) {
          db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
            String(year),
            vid,
          );
          vals.year = year;
          stats.yearAi++;
        }
        if (Object.keys(vals).length) setFileTags(row.file_path, vals);
      }
    }
    console.log(
      `  AI years set: ${stats.yearAi}/${aiYearBatch.length} (genres too where missing: +${stats.genreAi})`,
    );
  }

  // ---- AI cover queue append ----
  if (artless.length && !DRY) {
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
    if (lines.length) await appendFile(QUEUE, lines.join("\n") + "\n");
  }

  // ---- summary ----
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nDONE${DRY ? " (dry)" : ""} in ${secs}s — tags: ${stats.tags} | genres: SC ${stats.genreSc} + AI ${stats.genreAi} | years: SC ${stats.yearSc} + AI ${stats.yearAi} | art: SC ${stats.artSc} (${stats.artScOrig} orig-res) + gateway ${stats.artGateway} + twin ${stats.artTwin} + deezer ${stats.artDeezer} + itunes ${stats.artItunes} | artless→queue: ${artless.length}`,
  );
  db.close();
}

await main();
