/**
 * megadj stems — Demucs stem separation into the archive DB ledger.
 *
 * Runs htdemucs_ft (fine-tuned Hybrid Transformer Demucs) to separate
 * every track into 4 stems: vocals, drums, bass, other.  Results cache
 * in `stem_cache` so downstream consumers (#429 VOX/HOOK, #555 XZ Mods
 * OverCue export, grid audit) read from the shared cache.
 *
 * ~30 s/track on Apple Silicon MPS.  Idempotent: tracks with an
 * existing stem record are skipped unless --force.
 */
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { ArchiveState, TrackRow } from "../../core/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";
import { nonEmptyEnv } from "../../shared/leaf/guards";
import { openStemSession, type StemSession } from "./stems-session";

export const STEM_MODEL = "htdemucs_ft";

/** Default stems cache.  Override with MEGADJ_STEM_DIR. */
function defaultStemDir(): string {
  return join(homedir(), ".local", "state", "megadj", "stems");
}

export interface StemsOptions {
  state: ArchiveState;
  musicDir: string;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  maxSeconds?: number | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

/** The default ceiling — stems for sets/mixes are huge and slow; target
 *  DJ tracks (same policy as beats/mood). 0 disables the cap. */
const DEFAULT_MAX_STEM_SECONDS = 10 * 60;

/** Minimum duration — jingles, sound effects, and sub-10s clips are not
 *  worth separating (Demucs overhead exceeds the audio length). */
const MIN_STEM_SECONDS = 10;

export async function stems(opts: StemsOptions): Promise<void> {
  const log = commandLog(opts);
  const stemDir = nonEmptyEnv("MEGADJ_STEM_DIR") ?? defaultStemDir();
  const maxSeconds = opts.maxSeconds === undefined ? DEFAULT_MAX_STEM_SECONDS : opts.maxSeconds;

  mkdirSync(stemDir, { recursive: true });
  log(`stems: cache dir ${stemDir}`);

  const candidates = opts.state
    .allTracks()
    .filter((t) => t.status === "downloaded" && t.file_path !== null && existsSync(t.file_path));
  log(`  queue: ${candidates.length} downloaded file(s) on disk`);

  const todo: TrackRow[] = [];
  let skipped = 0;
  let tooLong = 0;
  let tooShort = 0;
  for (const t of candidates) {
    if (!opts.force && opts.state.stemRecord(t.video_id)) {
      skipped++;
      continue;
    }
    const dur = t.duration_s ?? 0;
    if (maxSeconds > 0 && dur > maxSeconds) {
      tooLong++;
      log(
        `  ⏭ over ${Math.round(maxSeconds / 60)}min cap (${Math.round(dur / 60)}min) — stems skipped: ${basename(t.file_path ?? "")}`,
      );
      continue;
    }
    if (dur > 0 && dur < MIN_STEM_SECONDS) {
      tooShort++;
      log(
        `  ⏭ under ${MIN_STEM_SECONDS}s (${Math.round(dur)}s) — stems skipped: ${basename(t.file_path ?? "")}`,
      );
      continue;
    }
    todo.push(t);
  }

  const limit = opts.limit ?? todo.length;
  const queue = todo.slice(0, Math.max(0, limit));

  log(
    `  ${queue.length} to separate (${skipped} cached, ${tooLong} over cap, ${tooShort} under ${MIN_STEM_SECONDS}s, limit ${limit})`,
  );

  if (queue.length === 0) {
    if (opts.json)
      await writeJson({ command: "stems", separated: 0, skipped, tooLong, tooShort, failed: 0 });
    return;
  }

  if (opts.dryRun) {
    log(`dry run: would separate ${queue.length} tracks`);
    if (opts.json)
      await writeJson({
        command: "stems",
        dryRun: true,
        wouldSeparate: queue.length,
        skipped,
        tooLong,
        tooShort,
      });
    return;
  }

  let session: StemSession | null = null;
  try {
    log("  loading Demucs model…");
    session = await openStemSession();
    if (session === null) {
      log("  ❌ failed to start Demucs worker (is torch/demucs installed via uv?)");
      if (opts.json)
        await writeJson({
          command: "stems",
          error: "demucs worker failed to start",
          separated: 0,
          failed: queue.length,
        });
      return;
    }
    log(
      `  model ${session.info.model} on ${session.info.device} (${session.info.sources.join(", ")})`,
    );
  } catch (error) {
    log(`  ❌ worker start error: ${error}`);
    if (opts.json)
      await writeJson({
        command: "stems",
        error: String(error),
        separated: 0,
        failed: queue.length,
      });
    return;
  }

  let separated = 0;
  let failed = 0;
  let workerRestarts = 0;
  const batchStart = Date.now();
  const elapsedTimes: number[] = [];
  const errors: { label: string; error: string }[] = [];

  try {
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i]!;
      const outputDir = join(stemDir, t.video_id);
      const label = basename(t.file_path ?? t.video_id);
      const remaining = queue.length - i;
      const avgS =
        elapsedTimes.length > 0 ? elapsedTimes.reduce((a, b) => a + b, 0) / elapsedTimes.length : 0;
      const etaMin = avgS > 0 ? Math.round((remaining * avgS) / 60) : 0;
      const etaStr = etaMin > 0 ? ` ETA ~${etaMin}min` : "";
      log(`  [${i + 1}/${queue.length}] separating ${label}…${etaStr}`);
      opts.onProgress?.(`stems ${i + 1}/${queue.length}: ${label}`);

      const result = await session.analyze({ path: t.file_path!, outputDir });

      if (result === null) {
        failed++;
        errors.push({ label, error: "worker returned null (timeout or crash)" });
        log(`  ❌ separation failed: ${label}`);
        session.close();
        session = await openStemSession();
        workerRestarts++;
        if (session === null) {
          log("  ❌ worker died after restart; aborting remaining queue");
          failed += queue.length - i - 1;
          break;
        }
        log("  ♻️  worker restarted — continuing");
        continue;
      }

      opts.state.setStemRecord({
        videoId: t.video_id,
        model: STEM_MODEL,
        stemDir: outputDir,
        vocalsPath: result.stems.vocals ?? null,
        drumsPath: result.stems.drums ?? null,
        bassPath: result.stems.bass ?? null,
        otherPath: result.stems.other ?? null,
        sampleRate: 44100,
        sourcePath: t.file_path!,
        elapsedS: result.elapsedS,
      });

      elapsedTimes.push(result.elapsedS);
      separated++;
      log(`  ✅ ${label} — ${result.elapsedS}s (${separated}/${queue.length})`);
    }
  } finally {
    session?.close();
  }

  const batchElapsedMin = Math.round((Date.now() - batchStart) / 60000);
  const avgTrackS =
    elapsedTimes.length > 0
      ? Math.round(elapsedTimes.reduce((a, b) => a + b, 0) / elapsedTimes.length)
      : 0;

  log(
    `\nstems: ${separated} separated, ${failed} failed, ${skipped} cached, ${tooLong} over cap, ${tooShort} under ${MIN_STEM_SECONDS}s`,
  );
  if (batchElapsedMin > 0) {
    log(`  batch: ${batchElapsedMin}min total, ~${avgTrackS}s/track avg`);
  }
  if (workerRestarts > 0) {
    log(`  ⚠️  ${workerRestarts} worker restart(s) during batch`);
  }
  if (errors.length > 0) {
    log(`  errors:`);
    for (const e of errors.slice(0, 10)) log(`    ${e.label}: ${e.error}`);
    if (errors.length > 10) log(`    … and ${errors.length - 10} more`);
  }

  if (opts.json) {
    await writeJson({
      command: "stems",
      separated,
      failed,
      skipped,
      tooLong,
      tooShort,
      stemDir,
      model: STEM_MODEL,
      batchElapsedMin,
      avgTrackS,
      workerRestarts,
      errors: errors.slice(0, 20),
    });
  }
}
