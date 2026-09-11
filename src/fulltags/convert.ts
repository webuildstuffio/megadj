/**
 * convert — archive-wide WAV → AIFF pass for `megadj convert`.
 *
 * Legacy WAVs (pre-Sep-10 ingests) still sit in the archive: rekordbox and
 * the booth players show NO embedded art for WAVs, and some are float/32-bit
 * PCM the players reject outright. This command walks the whole archive,
 * converts every WAV with the safe `wavToAiff` (BE re-map, mutagen ID3 copy,
 * ffprobe-validated BEFORE the source is removed — see fulltags/convert.ts),
 * then runs the same artwork ladder ingest uses (embedded → SoundCloud →
 * iTunes → AI queue) on each new AIFF, follows the DB file_path, and
 * player-compat-verifies the outputs.
 *
 * Per-WAV failure keeps the source WAV (converter is failure-safe); the
 * summary names every straggler so a re-run can retry them.
 */
import { basename } from "node:path";
import {
  walkAudioFiles,
  probeFile,
  playerCompat,
  isHiresOnly,
} from "../../fulltags/src/exports";
import { wavToAiff } from "../../fulltags/src/convert";
import { fetchAndEmbedArtwork } from "../getdat/commands/ingest-art";
import { flushArtworkQueue } from "../getdat/commands/ingest-art";
import type { QueueEntry } from "../getdat/commands/queue";
import { commandLog } from "../progress";
import type { ArchiveState } from "../archive/state";

export interface ConvertOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean;
  json?: boolean;
  /** Skip the artwork ladder (tags already on the WAV ride along). */
  noArtwork?: boolean;
  log?: (m: string) => void;
}

export interface ConvertResult {
  /** WAVs found in the archive. */
  total: number;
  converted: number;
  /** Artwork embedded during this pass (WAV tags rarely carry art). */
  artAdded: number;
  /** Files queued for AI cover generation (no source found). */
  artQueued: number;
  /** Already booth-playable before this pass. */
  hiresOnly: number;
  /** Conversion failed — WAV left in place, named in the summary. */
  failed: { file: string; reason: string }[];
  /** Converted but NOT universal-floor playable (e.g. 96 kHz source). */
  hiresWarnings: string[];
}

export async function convertArchive(
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const log = commandLog(opts);
  const res: ConvertResult = {
    total: 0,
    converted: 0,
    artAdded: 0,
    artQueued: 0,
    hiresOnly: 0,
    failed: [],
    hiresWarnings: [],
  };

  // Whole-archive walk (batch subfolders included; hidden quarantine dirs
  // are skipped by the shared walker).
  const wavs = walkAudioFiles(opts.musicDir).filter((p) => /\.wav$/i.test(p));
  res.total = wavs.length;
  if (wavs.length === 0) {
    log("no WAVs in the archive — nothing to convert");
    return res;
  }
  log(`${wavs.length} wav file(s) in the archive`);

  // DB lookup: video_id per file path (paths were migrated to batch folders).
  const byPath = new Map<string, string>();
  for (const t of opts.state.downloadedWithFiles()) {
    if (t.file_path) byPath.set(t.file_path, t.video_id);
  }

  const queueEntries: QueueEntry[] = [];
  for (const wav of wavs) {
    log(`wav: ${basename(wav)}`);
    if (opts.dryRun) {
      log(`  [convert] would convert to aiff (+ art ladder)`);
      continue;
    }
    const aiff = await wavToAiff(wav);
    if (!aiff) {
      res.failed.push({ file: wav, reason: "conversion failed — wav kept" });
      log(`  ✗ conversion failed — wav kept in place`);
      continue;
    }
    res.converted++;

    // DB path follows the file (row may not exist for strays — fine).
    const videoId = byPath.get(wav);
    if (videoId) opts.state.updateFilePath(videoId, aiff);

    // Artwork ladder on the new AIFF: the WAV's tags rode along via
    // mutagen, but WAV tags rarely carry embedded art.
    const probe = await probeFile(aiff);
    if (probe.ok) {
      const title =
        probe.tags["title"] ?? basename(aiff).replace(/\.aiff$/i, "");
      const artist = probe.tags["artist"] ?? null;
      const album = probe.tags["album"] ?? null;
      const art = await fetchAndEmbedArtwork(aiff, {
        tags: probe.tags,
        hasArt: probe.hasArt,
        noArtwork: opts.noArtwork,
        artist,
        album,
        title,
      });
      if (art.source) {
        res.artAdded++;
        log(`  ✓ art: ${art.source}`);
      }
      if (art.queued) {
        queueEntries.push({
          path: aiff,
          title,
          artist,
          album,
          reason: "no-source-found",
          remixOf: null,
        });
        res.artQueued++;
        if (videoId) opts.state.updateArtworkStatus(videoId, "queued");
        log(`  ~ art: queued for image-maker`);
      }
      // Player-compat verdict on what the booth will actually load.
      const compat = playerCompat(probe);
      if (isHiresOnly(compat)) {
        res.hiresOnly++;
        res.hiresWarnings.push(`${basename(aiff)} — ${compat.detail}`);
        log(`  ⚠ hires-only: ${compat.detail}`);
      } else if (!compat.ok) {
        res.failed.push({ file: aiff, reason: compat.detail });
        log(`  ⛔ player-incompatible even as aiff: ${compat.detail}`);
      } else {
        log(`  ✓ booth-playable`);
      }
    } else {
      res.failed.push({
        file: aiff,
        reason: "post-conversion probe failed",
      });
    }
  }

  if (queueEntries.length > 0 && !opts.dryRun) {
    await flushArtworkQueue(opts.state.dbDir, queueEntries);
  }
  return res;
}
