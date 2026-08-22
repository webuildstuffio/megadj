/**
 * megadj sync — incremental archive of the YT Music liked-songs playlist.
 *
 * Every run: refresh playlist state, download pending tracks with rate
 * limiting, enrich metadata, update the tracker. Safe to re-run anytime;
 * already-downloaded tracks are skipped by video ID.
 */

import { $ } from "bun";
import type { RateLimiter } from "../ratelimit";
import { withRetry } from "../ratelimit";
import type { ArchiveState } from "../state";
import { Downloader } from "../downloader";import { buildMetadata, applyTags } from "../metadata";

export interface SyncOptions {
  state: ArchiveState;
  limiter: RateLimiter;
  musicDir: string;
  cookiesFromBrowser: string | null;
  limit?: number;
  dryRun?: boolean;
  requality?: boolean;
  sources?: PlaylistSource[];
  onProgress?: (msg: string) => void;
}

/** A playlist source: id (e.g. "LM", "LL", "PL...") plus a label for state. */
export interface PlaylistSource {
  id: string;
  label: string;
}

interface PlaylistEntry {
  id: string;
  title: string | null;
}

async function fetchPlaylist(playlistId: string): Promise<PlaylistEntry[]> {
  const proc = await $`yt-dlp --flat-playlist -J "https://music.youtube.com/playlist?list=${playlistId}"`
    .quiet()
    .nothrow();
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
  const downloader = new Downloader(opts.limiter, {
    musicDir: opts.musicDir,
    cookiesFromBrowser: opts.cookiesFromBrowser,
  });

  const sources: PlaylistSource[] = opts.sources ?? [
    { id: "LM", label: "liked" },
  ];

  const runId = opts.state.startRun();
  let attempted = 0;
  let downloaded = 0;
  let gone = 0;
  let failed = 0;
  let bytes = 0;

  for (const source of sources) {
    log(`fetching playlist ${source.id} (${source.label})…`);
    const entries = await fetchPlaylist(source.id);
    log(`  ${entries.length} tracks`);
    entries.forEach((entry, index) => {
      opts.state.upsertTrackFromPlaylist(entry.id, index, entry.title, source.label);
    });
  }

  // Cross-source dedupe: a video already downloaded from one source stays put.
  let queue = opts.state.pendingTracks();
  if (opts.limit) {
    queue = queue.slice(0, opts.limit);
  }
  log(`${queue.length} track(s) to attempt this run`);

  for (const track of queue) {
    attempted++;
    log(`[${attempted}/${queue.length}] ${track.title ?? track.video_id}`);
    opts.state.markAttempt(track.video_id, null);

    if (opts.dryRun) {
      log(`  ↳ would download (dry-run)`);
      continue;
    }

    try {
      const result = await withRetry(
        opts.limiter,
        () => downloader.probe(track.video_id),
        { maxRetries: 2 },
      );

      const dl = await downloader.download(track.video_id, result);
      if (dl.status === "gone") {
        gone++;
        opts.state.markGone(track.video_id, "video unavailable");
        log(`  ↳ gone (unavailable)`);
        continue;
      }
      if (dl.status === "failed") {
        failed++;
        opts.state.markFailed(track.video_id, dl.error ?? "unknown");
        log(`  ↳ failed: ${dl.error?.slice(0, 120)}`);
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
          formatId: dl.formatId ?? null,
          bitrateKbps: Downloader.formatBitrateKbps(dl.formatId),
          codec: "aac",
          filePath: dl.filePath,
          fileSizeBytes: fileSize,
          durationS: dl.info.duration ?? null,
        });
        downloaded++;
        log(`  ↳ downloaded → ${meta.title ?? track.video_id}`);
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
    }
  }

  opts.state.finishRun(runId, { attempted, downloaded, gone, failed, bytesDownloaded: bytes });
  log(
    `\nrun complete: ${downloaded} downloaded, ${gone} gone, ${failed} failed, ${(bytes / 1e6).toFixed(1)} MB`,
  );
  const counts = opts.state.statusCounts();
  log(
    `archive: ${counts["downloaded"] ?? 0} downloaded / ${counts["gone"] ?? 0} gone / ${counts["failed"] ?? 0} failed / ${counts["pending"] ?? 0} pending`,
  );
}
