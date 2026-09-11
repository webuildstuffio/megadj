/**
 * fetch-all.ts — THE one-shot fetch pipeline: metadata + genre + artwork for
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
 *   bun tools/fetch-all.ts                 # fill everything missing
 *   bun tools/fetch-all.ts --all           # + upgrade existing SC art to original res
 *   bun tools/fetch-all.ts --art           # artwork only
 *   bun tools/fetch-all.ts --genres        # genres only
 *   bun tools/fetch-all.ts --tags          # tags only
 *   bun tools/fetch-all.ts --years         # years only
 *   bun tools/fetch-all.ts --jobs 8        # workers (default 6)
 *   bun tools/fetch-all.ts --dry-run       # report what would happen
 *   bun tools/fetch-all.ts --ai-fallback   # + AI genre/year for what SC+BP miss
 *                                          #   (opt-in: remix years default "2023")
 *
 * env: OPENROUTER_API_KEY (only needed for AI genre/year fallback + covers)
 *
 * Shared plumbing lives in tools/fetch-lib.ts; AI fallbacks come from
 * fulltags/src/ai.ts (via fulltags/src/exports).
 *
 * Callers: `megadj fetch` (src/fulltags/fetch.ts) runs runFetch() IN-PROCESS
 * — the child-process spawn seam is gone (one Bun boot, no 6.4s overhead).
 * The `bun tools/fetch-all.ts` CLI remains for direct operator runs.
 */
import {
  ARCH,
  QUEUE,
  db,
  groundTruth,
  archiveFiles,
  scSearch,
  setFileTags,
  beatportLookup,
  type Row,
  type TagValues,
} from "./fetch-lib";
import { aiGenres } from "../fulltags/src/exports";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { ProgressBar } from "../src/progress";
import {
  stageArt,
  stageBeatportIdentity,
  stageGenreYear,
  stageTags,
  type StageCtx,
  type Stats,
} from "./fetch-stages";

/** Pipeline options — the former module-level argv constants. `megadj
 * fetch` passes these from parsed FetchOptions; the CLI shim parses argv
 * into the same shape, so there is one pipeline and two thin front doors. */
export interface FetchAllOptions {
  all?: boolean | undefined;
  /** scope: one stage, or "all" (default) */
  only?: "art" | "genres" | "tags" | "years" | "all" | undefined;
  /** AI genre/year fallback — OPT-IN (Sep 11 2026): SC + Beatport resolve
   * nearly everything from a real release, and the flash-lite fallback has
   * a documented failure mode (remix years → "2023", genre = vibe-guess).
   * The operator turns it on for a bounded re-pass over a short unresolved
   * list, never as a silent part of every run. */
  aiFallback?: boolean | undefined;
  onlyDryRun?: boolean | undefined;
  jobs?: number | undefined;
  /** --json: stdout carries only the summary object (agent contract). */
  json?: boolean | undefined;
}

/** Print a line without corrupting the live progress bar redraw. */
let activeBar: ProgressBar | null = null;
let jsonOut = false;
function progressLog(line: string): void {
  if (jsonOut) return; // --json: stdout carries only the summary object
  if (!activeBar) {
    console.log(line);
    return;
  }
  activeBar.close();
  console.log(line);
  activeBar = new ProgressBar(activeBarTotal, "fetch");
  activeBar.update(0);
}
let activeBarTotal = 0;

interface Task {
  row: Row;
  truth: ReturnType<typeof groundTruth>;
  needTags: boolean;
  needGenre: boolean;
  needArt: boolean;
  needYear: boolean;
  upgradeSc: boolean;
}
// Stats shape lives in fetch-stages.ts (the stage runners' shared currency).

async function processTask(
  t: Task,
  i: number,
  total: number,
  stats: Stats,
  aiGenreBatch: Row[],
  aiYearBatch: Row[],
  /** out-param: rows that exhausted every art source → megadj artwork queue */
  artless: Row[],
  /** run-scoped flags (formerly module constants) */
  dry: boolean,
  aiFallback: boolean,
  /** live progress bar; ticks instead of printing per-item logs */
  progress: ProgressBar | null,
): Promise<void> {
  const { row: r, truth } = t;
  const name = `${r.artist ?? "?"} - ${r.title}`.slice(0, 56);
  const notes: string[] = [];

  const ctx: StageCtx = {
    row: r,
    truth,
    needTags: t.needTags,
    needGenre: t.needGenre,
    needArt: t.needArt,
    needYear: t.needYear,
    upgradeSc: t.upgradeSc,
    dry,
    stats,
    notes,
    aiGenreBatch,
    aiYearBatch,
    aiAllowed: aiFallback,
    bpBest: null,
    durationS: truth.durationS,
  };

  // ---- 1. tags (DB → file) ----
  stageTags(ctx);

  // ---- Beatport lookup (second source, behind SC) ----
  // One catalog search feeds genre AND year AND art AND identity. Runs
  // when any Beatport-fed field is needed; SC wins every field it covers.
  const wantsBp =
    !dry &&
    (t.needGenre ||
      t.needArt ||
      t.needYear ||
      (t.needTags &&
        (!truth.label || !truth.mixName || !truth.isrc || !truth.remixer)));
  ctx.bpBest = wantsBp
    ? await beatportLookup({
        artist: truth.artist ?? r.artist ?? null,
        title: truth.title ?? r.title,
        durationS: truth.durationS ?? undefined,
      })
    : null;

  // ---- 2+3+4. SC search feeds genre AND art AND year ----
  const wantsSc = t.needGenre || t.needArt || t.upgradeSc || t.needYear;
  const sc = wantsSc && !dry ? scSearch(r) : null;
  const best = sc?.[0] ?? null;

  stageGenreYear(ctx, best);
  stageBeatportIdentity(ctx);

  // ---- 3. artwork ladder (SC original-res first, then fallbacks) ----
  const artDone = await stageArt(ctx, best);
  if (t.needArt && !dry && !artDone) artless.push(r);

  if (progress) {
    progress.update(1);
    return;
  }
  if (jsonOut) return; // --json: no per-item milestones
  // plain mode (no progress bar): keep the classic per-item output
  if (notes.length)
    console.log(`  [${i + 1}/${total}] ${notes.join(" ")} — ${name}`);
  else if (dry)
    console.log(
      `  [${i + 1}/${total}] (dry) tags:${t.needTags} genre:${t.needGenre} art:${t.needArt} year:${t.needYear} — ${name}`,
    );
}

/** Run the pipeline in-process. Owns no DB handle — fetch-lib's shared
 *  connection stays open for the process lifetime, exactly as before;
 *  only the child-process seam around it is gone. */
export async function runFetch(opts: FetchAllOptions = {}): Promise<void> {
  const all = opts.all ?? false;
  const only = opts.only ?? "all";
  const dry = opts.onlyDryRun ?? false;
  const aiFallback = opts.aiFallback ?? false;
  const jobs = Math.max(1, opts.jobs ?? 6);
  jsonOut = opts.json ?? false;

  const files = archiveFiles();
  const rows = (
    db
      .query(
        "SELECT video_id, title, artist, album, genre, file_path, format_id FROM tracks WHERE status='downloaded' AND file_path LIKE ?",
      )
      .all(`${ARCH}/%`) as Row[]
  ).filter(
    // files now holds full paths (genre subfolders included), so match
    // file_path directly — the basename Set missed every organized track.
    (r) => files.has(r.file_path) && existsSync(r.file_path),
  );

  const tasks: Task[] = [];
  for (const r of rows) {
    const truth = groundTruth(r.file_path);
    const genreOk = truth.genre && truth.genre !== "Music";
    const needTags =
      (only === "all" || only === "tags") &&
      (!truth.title || !truth.artist || !truth.album || !genreOk);
    const needGenre = (only === "all" || only === "genres") && !genreOk;
    const needYear = (only === "all" || only === "years") && !truth.year;
    const upgradeSc = all && r.format_id?.startsWith("sc:") === true;
    const needArt =
      (only === "all" || only === "art") && (!truth.art || upgradeSc);
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

  if (!jsonOut) {
    console.log(
      `fetch-all: ${rows.length} tracks | tasks: ${tasks.length} (tags ${tasks.filter((t) => t.needTags).length}, genres ${tasks.filter((t) => t.needGenre).length}, art ${tasks.filter((t) => t.needArt).length}, years ${tasks.filter((t) => t.needYear).length}) | jobs: ${jobs}${all ? " [--all upgrade]" : ""}${dry ? " [DRY RUN]" : ""}\n`,
    );
  }

  const stats: Stats = {
    tags: 0,
    genreSc: 0,
    genreBp: 0,
    genreAi: 0,
    artSc: 0,
    artScOrig: 0,
    artBeatport: 0,
    artGateway: 0,
    artTwin: 0,
    artDeezer: 0,
    artItunes: 0,
    yearSc: 0,
    yearBp: 0,
    yearAi: 0,
    bpIdentity: 0,
  };
  const aiGenreBatch: Row[] = [];
  const aiYearBatch: Row[] = [];
  const artless: Row[] = [];

  // live progress bar (TTY bar + ETA; plain [n/total] milestones when piped)
  const progress = tasks.length ? new ProgressBar(tasks.length, "fetch") : null;
  if (progress) {
    activeBar = progress;
    activeBarTotal = tasks.length;
    progress.update(0);
  }

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
          dry,
          aiFallback,
          progress,
        );
      } catch (err) {
        progressLog(
          `  ✗ [${my + 1}/${tasks.length}] error: ${(err as Error).message?.slice(0, 80)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, () => worker()));
  activeBar = null;
  // ---- AI genre fallback (batched, after the parallel pass) ----
  // OPT-IN: batches stay empty unless --ai-fallback was passed (the stage
  // gate keeps them clean, so no filtering needed here).
  if (aiGenreBatch.length && !dry) {
    progressLog(`AI genre fallback for ${aiGenreBatch.length}…`);
    for (let k = 0; k < aiGenreBatch.length; k += 20) {
      const batch = aiGenreBatch.slice(k, k + 20);
      const res = await aiGenres(batch);
      for (const [vid, result] of res) {
        const genre = result[0];
        if (!genre) continue;
        const row = batch.find((b) => b.video_id === vid)!;
        db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(genre, vid);
        setFileTags(row.file_path, {
          genre,
          aiGenre: `${genre}|${result[2] ?? 1}`,
        });
        stats.genreAi++;
      }
    }
    if (!jsonOut)
      console.log(`  AI set: ${stats.genreAi}/${aiGenreBatch.length}`);
  }

  // ---- AI year fallback (single batched call: genre + year together) ----
  if (aiYearBatch.length && !dry) {
    if (!jsonOut) console.log(`\nAI year fallback for ${aiYearBatch.length}…`);
    for (let k = 0; k < aiYearBatch.length; k += 20) {
      const batch = aiYearBatch.slice(k, k + 20);
      const res = await aiGenres(batch, true);
      for (const [vid, result] of res) {
        const [genre, year, confidence] = result;
        const row = batch.find((b) => b.video_id === vid)!;
        const vals: TagValues = {};
        if (genre) {
          db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
            genre,
            vid,
          );
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
        `  AI years set: ${stats.yearAi}/${aiYearBatch.length} (genres too where missing: +${stats.genreAi})`,
      );
    }
  }

  // ---- AI cover queue append ----
  if (artless.length && !dry) {
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

  // ---- summary ----
  const summary = {
    command: "fetch",
    dryRun: dry,
    aiFallback,
    tracks: rows.length,
    tasks: tasks.length,
    tags: stats.tags,
    genreSc: stats.genreSc,
    genreBp: stats.genreBp,
    genreAi: stats.genreAi,
    yearSc: stats.yearSc,
    yearBp: stats.yearBp,
    yearAi: stats.yearAi,
    bpIdentity: stats.bpIdentity,
    artSc: stats.artSc,
    artScOrig: stats.artScOrig,
    artBeatport: stats.artBeatport,
    artGateway: stats.artGateway,
    artTwin: stats.artTwin,
    artDeezer: stats.artDeezer,
    artItunes: stats.artItunes,
    artQueued: artless.length,
    /** Unresolved WITHOUT AI (SC+BP both missed) — the bounded list a
     *  later `--ai-fallback` re-pass would cover. Visible in every mode. */
    genreUnresolvedNoAi: aiFallback ? 0 : aiGenreBatch.length,
    yearUnresolvedNoAi: aiFallback ? 0 : aiYearBatch.length,
  };
  if (jsonOut) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(JSON.stringify(summary));
  } else {
    progress?.close(
      `DONE${dry ? " (dry)" : ""} — tags: ${stats.tags} | genres: SC ${stats.genreSc} + BP ${stats.genreBp} + AI ${stats.genreAi} | years: SC ${stats.yearSc} + BP ${stats.yearBp} + AI ${stats.yearAi} | bp identity: ${stats.bpIdentity} | art: SC ${stats.artSc} (${stats.artScOrig} orig-res) + beatport ${stats.artBeatport} + gateway ${stats.artGateway} + twin ${stats.artTwin} + deezer ${stats.artDeezer} + itunes ${stats.artItunes} | artless→queue: ${artless.length}${aiFallback ? "" : ` | unresolved (AI off): genre ${aiGenreBatch.length}, year ${aiYearBatch.length}`}`,
    );
  }
}

// direct CLI entry (`megadj fetch` is the supported path; this shim stays
// for direct operator runs). argv parsing here ONLY under import.meta.main
// — importing this module must never read process.argv.
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const only = (
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
  const jobsArg = argv.indexOf("--jobs");
  const jobsRaw = jobsArg !== -1 ? Number(argv[jobsArg + 1]) : NaN;
  if ((jobsArg !== -1 && !Number.isFinite(jobsRaw)) || jobsRaw < 1) {
    console.error(`fetch-all: bad --jobs value ${argv[jobsArg + 1] ?? ""}`);
    process.exit(2);
  }
  await runFetch({
    all: argv.includes("--all"),
    only,
    aiFallback: argv.includes("--ai-fallback"),
    onlyDryRun: argv.includes("--dry-run"),
    jobs: Number.isFinite(jobsRaw) ? jobsRaw : 6,
    json: argv.includes("--json"),
  });
}
