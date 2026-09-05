/**
 * megadj sync — incremental archive of the YT Music liked-songs playlist.
 *
 * Every run: refresh playlist state, download pending tracks with rate
 * limiting, enrich metadata, update the tracker. Safe to re-run anytime;
 * already-downloaded tracks are skipped by video ID.
 */

import { $ } from "bun";
import type { ArchiveState } from "../state";
import type { RateLimiter } from "../ratelimit";
import { withRetry } from "../ratelimit";
import { Downloader } from "../downloader";
import { applyTags, buildMetadata, inferGenre } from "../metadata";
import { ProgressBar } from "../progress";

const isTty = process.stdout.isTTY ?? false;

export interface SyncOptions {
  state: ArchiveState;
  limiter: RateLimiter;
  musicDir: string;
  cookiesFromBrowser: string | null;
  cookiesFile?: string | null;
  limit?: number;
  dryRun?: boolean;
  requality?: boolean;
  sources?: PlaylistSource[];
  /** Only download tracks YouTube categorizes as Music. */
  musicOnly?: boolean;
  /** Stop once this many tracks are downloaded in total. */
  targetTotal?: number;
  onProgress?: (msg: string) => void;
}

/** A playlist source: id (e.g. "LM", "LL", "PL...") plus a label for state. */
interface PlaylistSource {
  id: string;
  label: string;
}

interface PlaylistEntry {
  id: string;
  title: string | null;
}

async function fetchPlaylist(
  playlistId: string,
  cookiesFile?: string | null,
): Promise<PlaylistEntry[]> {
  const url = `https://music.youtube.com/playlist?list=${playlistId}`;
  const proc = cookiesFile
    ? await $`yt-dlp --cookies ${cookiesFile} --flat-playlist -J ${url}`
        .quiet()
        .nothrow()
    : await $`yt-dlp --flat-playlist -J ${url}`.quiet().nothrow();
  if (proc.exitCode !== 0) {
    throw new Error(
      `playlist fetch failed (${playlistId}): ${new TextDecoder().decode(proc.stderr).slice(0, 300)}`,
    );
  }
  const data = JSON.parse(new TextDecoder().decode(proc.stdout)) as {
    entries?: Array<{ id?: string; title?: string }>;
  };
  return (data.entries ?? [])
    .filter((e) => e.id)
    .map((e) => ({ id: e.id as string, title: e.title ?? null }));
}

export async function sync(opts: SyncOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const downloader = new Downloader({
    musicDir: opts.musicDir,
    cookiesFromBrowser: opts.cookiesFromBrowser,
    cookiesFile: opts.cookiesFile ?? null,
  });

  const sources: PlaylistSource[] = opts.sources ?? [
    { id: "LM", label: "liked" },
  ];

  const runId = opts.state.startRun();
  let attempted = 0;
  let downloaded = 0;
  let gone = 0;
  let failed = 0;
  let notMusic = 0;
  let bytes = 0;

  for (const source of sources) {
    log(`fetching playlist ${source.id} (${source.label})…`);
    const entries = await fetchPlaylist(source.id, opts.cookiesFile);
    log(`  ${entries.length} tracks`);
    entries.forEach((entry, index) => {
      opts.state.upsertTrackFromPlaylist(
        entry.id,
        index,
        entry.title,
        source.label,
      );
    });
  }

  // Cross-source dedupe: a video already downloaded from one source stays put.
  let queue = opts.state.pendingTracks();
  if (opts.limit) {
    queue = queue.slice(0, opts.limit);
  }
  log(`${queue.length} track(s) to attempt this run`);

  const startTotal = opts.state.downloadedCount();
  const bar = new ProgressBar(queue.length, "sync");
  for (const track of queue) {
    if (opts.targetTotal && opts.state.downloadedCount() >= opts.targetTotal) {
      log(`target of ${opts.targetTotal} downloaded reached — stopping`);
      break;
    }
    attempted++;
    if (isTty) process.stdout.write("\r\u001b[K");
    log(`[${attempted}/${queue.length}] ${track.title ?? track.video_id}`);

    if (opts.dryRun) {
      log(`  ↳ would download (dry-run)`);
      bar.update(0);
      continue;
    }

    opts.state.markAttempt(track.video_id, null);

    try {
      const result = await withRetry(
        opts.limiter,
        () => downloader.probe(track.video_id),
        { maxRetries: 2 },
      );

      // Music-only gate: reject anything YouTube doesn't categorize as Music.
      if (opts.musicOnly) {
        const cats = result.categories ?? [];
        const uploader = (
          result.uploader ??
          result.channel ??
          ""
        ).toLowerCase();
        const isMusic =
          cats.some((c) => c.toLowerCase() === "music") ||
          uploader.includes(" - topic") ||
          uploader.includes("- topic") ||
          (result.artist !== undefined && result.artist !== null);
        if (!isMusic) {
          notMusic++;
          opts.state.markNotMusic(track.video_id, cats[0] ?? null);
          log(`  ↳ skipped (not music: ${cats[0] ?? "no category"})`);
          bar.update();
          continue;
        }
      }

      // Genre decides the destination folder for this download.
      const downloadGenre =
        inferGenre([result.genre, result.artist, result.album, result.title]) ??
        "Music";

      const dl = await downloader.download(
        track.video_id,
        result,
        downloadGenre,
      );
      if (dl.status === "gone") {
        gone++;
        opts.state.markGone(track.video_id, "video unavailable");
        log(`  ↳ gone (unavailable)`);
        bar.update();
        continue;
      }
      if (dl.status === "failed") {
        failed++;
        opts.state.markFailed(track.video_id, dl.error ?? "unknown");
        log(`  ↳ failed: ${dl.error?.slice(0, 120)}`);
        bar.update();
        continue;
      }

      if (dl.filePath && dl.info) {
        const meta = buildMetadata(dl.info);
        await applyTags(dl.filePath, meta);
        const fileSize = dl.filePath
          ? (await Bun.file(dl.filePath).stat()).size
          : 0;
        bytes += fileSize;

        opts.state.markDownloaded(track.video_id, {
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          genre: meta.genre,
          formatId: dl.formatId ?? null,
          bitrateKbps: Downloader.formatBitrateKbps(dl.formatId),
          codec: "aac",
          filePath: dl.filePath,
          fileSizeBytes: fileSize,
          durationS: dl.info.duration ?? null,
        });
        opts.state.updateGenre(track.video_id, meta.genre);
        downloaded++;
        log(`  ↳ downloaded → ${meta.title ?? track.video_id}`);
        bar.update(1, fileSize);
      }
    } catch (error) {
      const message = (error as Error).message;
      if (message === "GONE") {
        gone++;
        opts.state.markGone(track.video_id, "video unavailable");
        log(`  ↳ gone (unavailable)`);
      } else {
        failed++;
        opts.state.markFailed(track.video_id, message.slice(0, 300));
        log(`  ↳ failed after retries: ${message.slice(0, 120)}`);
      }
      bar.update();
    }
  }
  bar.close();
  opts.state.finishRun(runId, {
    attempted,
    downloaded,
    gone,
    failed,
    bytesDownloaded: bytes,
  });
  log(
    `\nrun complete: ${downloaded} downloaded, ${notMusic} not-music, ${gone} gone, ${failed} failed, ${(bytes / 1e6).toFixed(1)} MB`,
  );
  const counts = opts.state.statusCounts();
  log(
    `archive: ${counts["downloaded"] ?? 0} downloaded / ${counts["gone"] ?? 0} gone / ${counts["failed"] ?? 0} failed / ${counts["pending"] ?? 0} pending / ${counts["skipped_not_music"] ?? 0} not-music`,
  );
  void startTotal;
}
