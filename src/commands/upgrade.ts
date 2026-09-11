// upgrade.ts — D24 LOWQ re-fetch: re-download below-floor tracks at best
// quality and swap ONLY when the new file proves itself.
//
// The safety rail (ideas.md D24's exact rule): the re-fetched file must
// (a) probe at a bitrate ≥ the current row's floor expectation, and
// (b) carry the SAME acoustic fingerprint (fpcalc) as the file it would
// replace — a different fingerprint means YouTube served a different
// recording (live version, remaster, wrong upload), and the swap is
// refused. The old file is never deleted on failure; the row keeps its
// provenance on success.
//
// Agent-first contract: --json (one summary object), --dry-run, contained
// per-file failures, meaningful exit code.
import { existsSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  applyTags,
  fingerprintFile,
  type EnrichedMetadata,
} from "../../fulltags/src/exports";
import { Downloader, type DownloadResult } from "../downloader";
import type { ArchiveState } from "../state";
import { commandLog } from "../progress";

export interface UpgradeOptions {
  state: ArchiveState;
  musicDir: string;
  cookiesFromBrowser?: string | null | undefined;
  cookiesFile?: string | null | undefined;
  limit?: number | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

interface UpgradeCandidate {
  video_id: string;
  title: string | null;
  file_path: string;
  bitrate_kbps: number | null;
  codec: string | null;
}

/** The same floor rule as CrateDeck's lowqQueue() — one quality bar. */
export function isLowq(row: {
  bitrate_kbps: number | null;
  codec: string | null;
}): boolean {
  if (row.bitrate_kbps === null) return false;
  if (row.codec === "mp4a" || row.codec === "aac")
    return row.bitrate_kbps < 256;
  if (row.codec === "mp3") return row.bitrate_kbps < 320;
  return false;
}

/** ffprobe the new file's bitrate (bits/s → kbps); null when unreadable. */
function ffprobeKbps(path: string): number | null {
  let pr: Bun.SyncSubprocess;
  try {
    pr = Bun.spawnSync({
      cmd: [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        path,
      ],
      stdout: "pipe",
      stderr: "ignore",
    });
  } catch {
    return null;
  }
  if (pr.exitCode !== 0) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(pr.stdout)) as {
      format?: { bit_rate?: string };
    };
    const bps = Number(j.format?.bit_rate);
    return Number.isFinite(bps) && bps > 0 ? Math.round(bps / 1000) : null;
  } catch {
    return null; // corrupt probe output — treat as unreadable
  }
}

/** Unique temp path beside the target (keeps the extension — ffmpeg/yt-dlp
 * infer muxers from filenames). */
function tmpPathFor(target: string): string {
  const d = dirname(target);
  const b = basename(target);
  const ext = extname(target) || ".m4a";
  return join(d, `.${b}.upgrade-${process.pid}${ext}`);
}

export async function upgrade(opts: UpgradeOptions): Promise<void> {
  const log = commandLog(opts);

  const candidates = (
    opts.state.allTracks() as Array<{
      video_id: string;
      title: string | null;
      file_path: string | null;
      bitrate_kbps: number | null;
      codec: string | null;
      status: string;
    }>
  )
    .filter(
      (t) =>
        t.status === "downloaded" &&
        t.file_path &&
        existsSync(t.file_path) &&
        isLowq(t),
    )
    .slice(0, opts.limit ?? 20) as UpgradeCandidate[];

  log(
    `upgrade: ${candidates.length} below-floor candidate(s)${opts.dryRun ? " (dry run)" : ""}`,
  );

  const totals = { attempted: 0, upgraded: 0, refused: 0, failed: 0 };
  const details: Array<{
    video_id: string;
    title: string | null;
    outcome: "upgraded" | "refused" | "failed";
    detail: string;
  }> = [];

  if (!opts.dryRun && candidates.length) {
    const downloader = new Downloader({
      musicDir: opts.musicDir,
      cookiesFromBrowser: opts.cookiesFromBrowser ?? null,
      cookiesFile: opts.cookiesFile ?? null,
    });

    for (const c of candidates) {
      totals.attempted++;
      log(
        `[upd ${totals.attempted}/${candidates.length}] ${c.title ?? c.video_id} (was ${c.bitrate_kbps} kbps ${c.codec})`,
      );
      const oldPath = c.file_path;
      const tmp = tmpPathFor(oldPath);

      try {
        // 1. Fingerprint the incumbent FIRST — no swap can happen without it.
        const oldFp = fingerprintFile(oldPath);
        if (!oldFp) {
          totals.refused++;
          details.push({
            video_id: c.video_id,
            title: c.title,
            outcome: "refused",
            detail:
              "old file not fingerprintable (fpcalc missing or unreadable)",
          });
          log(`  ↳ refused: old file not fingerprintable`);
          continue;
        }

        // 2. Re-download to the temp path (same formats as sync's driver).
        const info = await downloader.probe(c.video_id);
        const dl: DownloadResult = await downloader.download(c.video_id, info);
        if (
          dl.status !== "downloaded" ||
          !dl.filePath ||
          !existsSync(dl.filePath)
        ) {
          totals.failed++;
          details.push({
            video_id: c.video_id,
            title: c.title,
            outcome: "failed",
            detail: dl.error ?? "download failed",
          });
          log(`  ↳ failed: ${dl.error?.slice(0, 120)}`);
          continue;
        }
        // Move the fresh file to the hidden tmp slot so the ORIGINAL stays
        // in place until every gate passes (yt-dlp wrote to its own path).
        renameSync(dl.filePath, tmp);

        // 3. Gate A: the new file must fingerprint IDENTICALLY.
        const newFp = fingerprintFile(tmp);
        if (!newFp || newFp !== oldFp) {
          rmSync(tmp, { force: true });
          totals.refused++;
          details.push({
            video_id: c.video_id,
            title: c.title,
            outcome: "refused",
            detail: newFp
              ? "different recording (fingerprint mismatch — live/remaster/wrong upload)"
              : "new file not fingerprintable",
          });
          log(`  ↳ refused: fingerprint mismatch — different recording`);
          continue;
        }

        // 4. Gate B: the new file must probe at ≥ the old bitrate.
        const newKbps = ffprobeKbps(tmp);
        if (
          newKbps === null ||
          (c.bitrate_kbps !== null && newKbps < (c.bitrate_kbps ?? 0))
        ) {
          rmSync(tmp, { force: true });
          totals.refused++;
          details.push({
            video_id: c.video_id,
            title: c.title,
            outcome: "refused",
            detail: `new file ${newKbps ?? "?"} kbps — no better than the current ${c.bitrate_kbps}`,
          });
          log(`  ↳ refused: ${newKbps ?? "?"} kbps is not an upgrade`);
          continue;
        }

        // 5. All gates passed: carry the OLD file's ground-truth tags onto
        // the new file (yt-dlp's fresh embed only knows YouTube's tags),
        // swap atomically, update the row.
        const oldMeta: EnrichedMetadata = {
          title: c.title,
          artist: null,
          albumArtist: null,
          album: null,
          genre: null,
          date: null,
          composer: null,
          comment: null,
          bpm: null,
        };
        await applyTags(tmp, oldMeta);
        unlinkSync(oldPath);
        renameSync(tmp, oldPath);
        const newFormatId = dl.formatId ?? null;
        const newSize = statSync(oldPath).size;
        opts.state.markDownloaded(c.video_id, {
          title: c.title,
          artist: null,
          album: null,
          genre: undefined,
          formatId: newFormatId,
          bitrateKbps: Downloader.formatBitrateKbps(newFormatId),
          codec: "aac",
          filePath: oldPath,
          fileSizeBytes: newSize,
          durationS: info.duration ?? null,
          energy: undefined,
          artworkStatus: undefined,
        });
        totals.upgraded++;
        details.push({
          video_id: c.video_id,
          title: c.title,
          outcome: "upgraded",
          detail: `${c.bitrate_kbps} → ${newKbps} kbps (fingerprint verified)`,
        });
        log(`  ↳ upgraded: ${c.bitrate_kbps} → ${newKbps} kbps`);
      } catch (error) {
        // containment: one bad file never kills the pass; tmp never litters
        try {
          if (existsSync(tmp)) rmSync(tmp, { force: true });
        } catch {
          // best-effort cleanup — the original refusal stands either way
        }
        totals.failed++;
        details.push({
          video_id: c.video_id,
          title: c.title,
          outcome: "failed",
          detail: (error as Error).message.slice(0, 200),
        });
        log(`  ↳ failed: ${(error as Error).message.slice(0, 120)}`);
      }
    }
  } else if (opts.dryRun) {
    for (const c of candidates)
      details.push({
        video_id: c.video_id,
        title: c.title,
        outcome: "failed",
        detail: "dry run — not attempted",
      });
    totals.attempted = candidates.length;
  }

  log(
    `upgrade done: ${totals.upgraded} upgraded, ${totals.refused} refused (different recording/no gain), ${totals.failed} failed${opts.dryRun ? " (dry run)" : ""}`,
  );
  console.log(
    JSON.stringify({
      command: "upgrade",
      candidates: candidates.length,
      ...totals,
      dryRun: opts.dryRun === true,
      details,
    }),
  );
}
