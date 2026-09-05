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
  sources?: PlaylistSource[];
  /** Only download tracks YouTube categorizes as Music. */
  musicOnly?: boolean;
  /** Stop once this many tracks are downloaded in total. */
  targetTotal?: number;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
  /** Injectable playlist fetcher for tests — defaults to the yt-dlp probe. */
  fetchPlaylistFn?: typeof fetchPlaylist;
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
  cookiesFromBrowser?: string | null,
): Promise<PlaylistEntry[]> {
  const url = `https://music.youtube.com/playlist?list=${playlistId}`;
  // Cookie resolution order mirrors the downloader: explicit jar file first,
  // then browser extraction. Skipping browser extraction here (the old
  // behavior) made `megadj sync` fail playlist fetch for every default
  // config (MEGADJ_COOKIES=chrome, no jar) — auth-required liked lists just
  // 403'd even though the downloader could have seen the session.
  const cookieArgs = cookiesFile
    ? ["--cookies", cookiesFile]
    : cookiesFromBrowser
      ? ["--cookies-from-browser", cookiesFromBrowser]
      : [];
  const proc = await $`yt-dlp ${[...cookieArgs, "--flat-playlist", "-J", url]}`
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
  // --json mode (P1): human logs go quiet — the summary object must be the
  // only stdout output so agents get parseable JSON (same contract as the
  // artwork/ingest commands).
  const rawLog = opts.onProgress ?? ((m: string) => console.log(m));
  const log = opts.json && !opts.onProgress ? () => {} : rawLog;
  const downloader = new Downloader({
    musicDir: opts.musicDir,
    cookiesFromBrowser: opts.cookiesFromBrowser,
    cookiesFile: opts.cookiesFile ?? null,
  });

  const sources: PlaylistSource[] = opts.sources ?? [
    { id: "LM", label: "liked" },
  ];

  const isDry = opts.dryRun === true;
  // A dry run reports what WOULD happen — it must not write to the state DB
  // (no playlist upserts, no run rows). The old dry-run recorded tracks and
  // a finished run row, so "dry" mutated the archive's memory.
  const runId = isDry ? null : opts.state.startRun();
  // Dry-run preview of playlist entries (in-memory only; filled below).
  const pendingPreview: Array<{
    video_id: string;
    title: string | null;
    liked_position: number | null;
    status: string;
  }> = [];
  let attempted = 0;
  let downloaded = 0;
  let gone = 0;
  let failed = 0;
  let notMusic = 0;
  let bytes = 0;

  for (const source of sources) {
    log(`fetching playlist ${source.id} (${source.label})…`);
    const entries = await (opts.fetchPlaylistFn ?? fetchPlaylist)(
      source.id,
      opts.cookiesFile,
      opts.cookiesFromBrowser,
    );
    log(`  ${entries.length} tracks`);
    if (!isDry) {
      entries.forEach((entry, index) => {
        opts.state.upsertTrackFromPlaylist(
          entry.id,
          index,
          entry.title,
          source.label,
        );
      });
    } else {
      // Dry-run on a fresh DB would otherwise report 0 tracks (the pending
      // queue is only populated by real runs). Project what WOULD be
      // tracked — in memory, nothing written — so `--dry-run` answers
      // "what would the next real run do?" on any database state.
      pendingPreview.push(
        ...entries.map((entry, index) => ({
          video_id: entry.id,
          title: entry.title,
          liked_position: index,
          status: "pending",
        })),
      );
    }
  }

  // Cross-source dedupe: a video already downloaded from one source stays put.
  // A dry run previews playlist entries in memory (nothing was upserted, so
  // the DB queue is blind to them); a real run reads only the DB queue.
  let queue: Array<{ video_id: string; title: string | null }> = isDry
    ? pendingPreview
    : opts.state.pendingTracks();
  // --limit 0 must mean "attempt nothing" (0 is falsy — the old check
  // silently treated it as unlimited); negative was already rejected by the CLI.
  if (opts.limit !== undefined && opts.limit >= 0) {
    queue = queue.slice(0, opts.limit);
  }
  log(`${queue.length} track(s) to attempt this run`);

  const bar = new ProgressBar(queue.length, "sync");
  for (const track of queue) {
    // Explicit !== undefined (not truthiness): --target-total 0 must mean
    // "stop immediately" — truthiness used to silently ignore it.
    if (
      opts.targetTotal !== undefined &&
      opts.state.downloadedCount() >= opts.targetTotal
    ) {
      log(`target of ${opts.targetTotal} downloaded reached — stopping`);
      break;
    }
    attempted++;
    if (isTty && !opts.json) process.stdout.write("\r\u001b[K");
    log(`[${attempted}/${queue.length}] ${track.title ?? track.video_id}`);

    if (isDry) {
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
        // stat() throws if yt-dlp's reported path vanished between the
        // download finishing and here (AV quarantine, race) — that must
        // fail this one track, not the whole run.
        let fileSize = 0;
        try {
          fileSize = (await Bun.file(dl.filePath).stat()).size;
        } catch {
          log(`  ⚠ landed file not statable: ${dl.filePath}`);
        }
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
      } else {
        // yt-dlp exited 0 but no usable path/info came back (output drift,
        // odd filename): count the track and burn the attempt — silence
        // here shrank every run summary while consuming retry budget.
        failed++;
        opts.state.markFailed(
          track.video_id,
          "download reported success but no file path was parsed",
        );
        log(`  ↳ failed: no file path parsed from downloader output`);
        bar.update();
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
  if (runId !== null) {
    opts.state.finishRun(runId, {
      attempted,
      downloaded,
      gone,
      failed,
      bytesDownloaded: bytes,
    });
  }
  log(
    `\nrun complete: ${downloaded} downloaded, ${notMusic} not-music, ${gone} gone, ${failed} failed, ${(bytes / 1e6).toFixed(1)} MB`,
  );
  const counts = opts.state.statusCounts();
  log(
    `archive: ${counts["downloaded"] ?? 0} downloaded / ${counts["gone"] ?? 0} gone / ${counts["failed"] ?? 0} failed / ${counts["pending"] ?? 0} pending / ${counts["skipped_not_music"] ?? 0} not-music`,
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "sync",
        dryRun: opts.dryRun ?? false,
        runId,
        attempted,
        downloaded,
        notMusic,
        gone,
        failed,
        bytesDownloaded: bytes,
        // Dry runs only ever "would download" — give agents the queue size
        // a real run would have attempted.
        wouldAttempt: opts.dryRun ? attempted : undefined,
        archive: {
          downloaded: counts["downloaded"] ?? 0,
          gone: counts["gone"] ?? 0,
          failed: counts["failed"] ?? 0,
          pending: counts["pending"] ?? 0,
          skippedNotMusic: counts["skipped_not_music"] ?? 0,
        },
      }),
    );
  }
}
