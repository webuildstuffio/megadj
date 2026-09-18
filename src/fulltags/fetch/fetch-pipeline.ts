/**
 * fetch-pipeline.ts — THE one-shot fetch pipeline (#184, re-homed from
 * tools/fetch-all.ts): metadata + genre + artwork for every archive
 * track. Ground-truth verified (reads files, not the DB), parallel,
 * idempotent — safe to re-run any time.
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
 * Flags (--art/--genres/--tags/--years/--jobs/--all/--dry-run/
 * --ai-fallback/--json) belong to `megadj fetch` — the only front door
 * (the `bun tools/fetch-all.ts` shim was retired with the re-home, the
 * megaset precedent: one name everywhere, no shims). AI fallback stays
 * opt-in — remix years default "2023".
 *
 * env: OPENROUTER_API_KEY (only needed for AI genre/year fallback + covers)
 *
 * Shared archive plumbing lives in archive-ledger.ts; stage runners in
 * fetch-stages.ts; AI fallbacks come from ai.ts (via exports).
 *
 * Callers: `megadj fetch` (src/fulltags/fetch.ts) runs runFetch()
 * IN-PROCESS through the exports leaf — one Bun boot, no 6.4s overhead.
 */
import {
  ARCH,
  db,
  groundTruth,
  archiveFiles,
  cleanArtist,
  type Row,
} from "../archive-ledger";
import { existsSync } from "node:fs";
import { ProgressBar } from "../../progress";
import { writeJson } from "../../shared/cli-output";
import {
  aiGenreFallback,
  aiYearFallback,
  queueArtless,
} from "./fetch-ai-fallback";
import {
  cleanTitle,
  fanOutBandcamp,
  fanOutBeatport,
  fanOutSoundcloud,
  stageBeatportIdentity,
  stageBandcamp,
  stageGenreElection,
  stageGenreYear,
  stageTags,
  type StageCtx,
  type Stats,
} from "./fetch-stages";
// #89/#90 diet: the art family (SC hit path + fallback ladder) lives in
// fetch-art.ts; the genre/year rungs live in the genre stage only (the
// old art-stage piggyback double-voted SC — fixed with #215's election
// visibility pass).
import { stageArt } from "./fetch-art";
import type { GenreVote } from "../genre-vote";

/** Pipeline options. `megadj fetch` passes these from parsed
 * FetchOptions — the CLI argv shim went with the old front door. */
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

/** Build the per-track task list: one pass over the downloaded rows,
 *  deciding which stages each row needs (the fetch stage gates). */
function buildTasks(rows: Row[], only: string, all: boolean): Task[] {
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
  return tasks;
}

function emptyStats(): Stats {
  return {
    tags: 0,
    genreSc: 0,
    genreBp: 0,
    genreAi: 0,
    artSc: 0,
    artScOrig: 0,
    artBeatport: 0,
    artBandcamp: 0,
    artGateway: 0,
    artTwin: 0,
    artDeezer: 0,
    artItunes: 0,
    yearSc: 0,
    yearBp: 0,
    yearAi: 0,
    bpIdentity: 0,
    genreBc: 0,
    yearBc: 0,
    bcFilled: 0,
    genreImprint: 0,
    genreElected: 0,
    votesCast: 0,
  };
}

interface ProcessTaskInput {
  task: Task;
  dry: boolean;
  aiFallback: boolean;
  progress: ProgressBar | null;
}

interface ProcessTaskResult {
  stats: Stats;
  aiGenreBatch: Row[];
  aiYearBatch: Row[];
  artless: Row[];
  notes: string[];
  name: string;
  dry: boolean;
}
// Stats shape lives in fetch-stages.ts (the stage runners' shared currency).

async function processTask({
  task: t,
  dry,
  aiFallback,
  progress,
}: ProcessTaskInput): Promise<ProcessTaskResult> {
  const { row: r } = t;
  const name = `${cleanArtist(r.artist) ?? "?"} - ${cleanTitle(r.title)}`.slice(
    0,
    56,
  );
  const notes: string[] = [];
  const stats = emptyStats();
  const aiGenreBatch: Row[] = [];
  const aiYearBatch: Row[] = [];
  const artless: Row[] = [];

  // #173 vote ladder: when the genre leg is live (and not a dry run),
  // every rung COLLECTS a vote and the ONE election writes at the end.
  const genreVotes: GenreVote[] = [];
  const ctx: StageCtx = {
    row: r,
    truth: t.truth,
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
    bcBest: null,
    durationS: t.truth.durationS,
    genreVotes: t.needGenre && !dry ? genreVotes : undefined,
  };

  // ---- 1. tags (DB → file) ----
  stageTags(ctx);

  // ---- fan-out: Beatport (second source, behind SC) ----
  await fanOutBeatport(ctx);

  // ---- 2+3+4. SC search feeds genre AND art AND year ----
  const best = await fanOutSoundcloud(ctx);

  stageGenreYear(ctx, best);
  stageBeatportIdentity(ctx);

  // ---- fan-out: Bandcamp vote (third source, behind SC + BP) ----
  await fanOutBandcamp(ctx, Boolean(best?.genre), Boolean(best?.year));

  // ---- 2b. Bandcamp vote fills what SC and BP both missed ----
  if (ctx.bcBest) {
    await stageBandcamp(
      ctx,
      t.needGenre && !best?.genre,
      t.needYear && !best?.year,
      t.needTags && !t.truth.label,
    );
  }

  // ---- #173 the ONE genre election + write (vote mode only) ----
  if (t.needGenre && !dry && genreVotes.length > 0) {
    stageGenreElection(ctx, (vid, genre, serialized) => {
      db.query(
        "UPDATE tracks SET genre = COALESCE(?, genre), genre_votes = ? WHERE video_id = ?",
      ).run(genre, serialized, vid);
    });
  }

  // ---- 3. artwork ladder (SC original-res first, then fallbacks) ----
  const artDone = await stageArt(ctx, best);
  if (t.needArt && !dry && !artDone) artless.push(r);

  progress?.update(1);
  return { stats, aiGenreBatch, aiYearBatch, artless, notes, name, dry };
}

/** Run the pipeline in-process. Owns no DB handle — fetch-lib's shared
 *  connection stays open for the process lifetime, exactly as before;
 *  only the child-process seam around it is gone. */
export async function runFetch(opts: FetchAllOptions = {}): Promise<void> {
  const all = opts.all ?? false;
  const only = opts.only ?? "all";
  const dry = opts.onlyDryRun ?? false;
  const aiFallback = opts.aiFallback ?? false;
  const jobs = Math.max(1, opts.jobs ?? 6); // 0 workers is meaningless → clamp to 1
  jsonOut = opts.json ?? false;

  const files = archiveFiles();
  const rows = (
    db
      .query(
        "SELECT video_id, title, artist, album, genre, label, file_path, format_id FROM tracks WHERE status='downloaded' AND file_path LIKE ?",
      )
      .all(`${ARCH}/%`) as Row[]
  ).filter(
    // files now holds full paths (genre subfolders included), so match
    // file_path directly — the basename Set missed every organized track.
    (r) => files.has(r.file_path) && existsSync(r.file_path),
  );

  const tasks = buildTasks(rows, only, all);

  if (!jsonOut) {
    console.log(
      `megadj fetch: ${rows.length} tracks | tasks: ${tasks.length} (tags ${tasks.filter((t) => t.needTags).length}, genres ${tasks.filter((t) => t.needGenre).length}, art ${tasks.filter((t) => t.needArt).length}, years ${tasks.filter((t) => t.needYear).length}) | jobs: ${jobs}${all ? " [--all upgrade]" : ""}${dry ? " [DRY RUN]" : ""}\n`,
    );
  }

  const stats = emptyStats();
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
        const result = await processTask({
          task: tasks[my]!,
          dry,
          aiFallback,
          progress,
        });
        for (const key of Object.keys(stats) as (keyof Stats)[])
          stats[key] += result.stats[key];
        aiGenreBatch.push(...result.aiGenreBatch);
        aiYearBatch.push(...result.aiYearBatch);
        artless.push(...result.artless);
        if (!progress && !jsonOut) {
          if (result.notes.length)
            console.log(
              `  [${my + 1}/${tasks.length}] ${result.notes.join(" ")} — ${result.name}`,
            );
          else if (result.dry)
            console.log(
              `  [${my + 1}/${tasks.length}] (dry) tags:${tasks[my]!.needTags} genre:${tasks[my]!.needGenre} art:${tasks[my]!.needArt} year:${tasks[my]!.needYear} — ${result.name}`,
            );
        }
      } catch (err) {
        progressLog(
          `  ✗ [${my + 1}/${tasks.length}] error: ${(err as Error).message?.slice(0, 80)}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, () => worker()));
  activeBar = null;
  // ---- AI fallbacks + cover queue (extracted, #88 item 1) ----
  // OPT-IN: batches stay empty unless --ai-fallback was passed (the stage
  // gate keeps them clean, so no filtering needed here).
  await aiGenreFallback(aiGenreBatch, stats, dry, jsonOut);
  await aiYearFallback(aiYearBatch, stats, dry, jsonOut);
  await queueArtless(artless, dry);

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
    /** #128 imprint-prior votes that decided a genre (SC+BP both missed). */
    genreImprint: stats.genreImprint,
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
    genreBc: stats.genreBc,
    yearBc: stats.yearBc,
    bcFilled: stats.bcFilled,
    artBandcamp: stats.artBandcamp,
    /** #215 election visibility: votes cast vs elections landed — the
     *  ladder's live output is measurable from every summary, not just
     *  the notes stream. */
    votesCast: stats.votesCast,
    genreElected: stats.genreElected,
  };
  if (jsonOut) {
    // P1 (--json on every command): one summary object on stdout, last.
    await writeJson(summary);
  } else {
    progress?.close(
      `DONE${dry ? " (dry)" : ""} — tags: ${stats.tags} | genres: SC ${stats.genreSc} + BP ${stats.genreBp} + imprint ${stats.genreImprint} + BC ${stats.genreBc} + AI ${stats.genreAi} | vote ladder: ${stats.votesCast} votes → ${stats.genreElected} elected | years: SC ${stats.yearSc} + BP ${stats.yearBp} + BC ${stats.yearBc} + AI ${stats.yearAi} | bp identity: ${stats.bpIdentity} | bandcamp filled: ${stats.bcFilled} | art: SC ${stats.artSc} (${stats.artScOrig} orig-res) + beatport ${stats.artBeatport} + bandcamp ${stats.artBandcamp} + gateway ${stats.artGateway} + twin ${stats.artTwin} + deezer ${stats.artDeezer} + itunes ${stats.artItunes} | artless→queue: ${artless.length}${aiFallback ? "" : ` | unresolved (AI off): genre ${aiGenreBatch.length}, year ${aiYearBatch.length}`}`,
    );
  }
}
