/**
 * yt-dlp driver. One JSON-info probe per track (rate-limited), then the
 * download itself. Classifies failures into permanent vs transient so the
 * limiter can back off appropriately.
 */

import { $ } from "bun";
import type { RateLimiter } from "./ratelimit";
import type { YtdlpInfo } from "./metadata";
import { sanitizeGenreFolder } from "./metadata";

export interface DownloadResult {
  status: "downloaded" | "already-had" | "gone" | "failed";
  filePath?: string;
  formatId?: string;
  info?: YtdlpInfo;
  error?: string;
}

export interface DownloaderOptions {
  musicDir: string;
  ytdlpBin?: string;
  cookiesFromBrowser?: string | null;
  /** Cookie jar file (netscape format) — preferred over browser extraction. */
  cookiesFile?: string | null;
  minBitrateKbps?: number;
}

const GONE_PATTERNS = [
  /video unavailable/i,
  /account associated with this video has been terminated/i,
  /removed following a copyright removal request/i,
  /private video/i,
  /makes it unavailable in your country/i,
  /sign in to confirm/i,
];

const THROTTLE_PATTERNS = [
  /429|too many requests/i,
  /http error 5\d\d/i,
  /connection reset|timed out|ETIMEDOUT|ENOTFOUND|ECONNRESET/i,
  /premiere|live event/i,
];

export class Downloader {
  private readonly opts: Required<Pick<DownloaderOptions, "musicDir">> &
    DownloaderOptions;

  constructor(
    private readonly limiter: RateLimiter,
    opts: DownloaderOptions,
  ) {
    this.opts = opts;
  }

  classifyError(stderr: string): "gone" | "throttle" | "other" {
    if (GONE_PATTERNS.some((p) => p.test(stderr))) return "gone";
    if (THROTTLE_PATTERNS.some((p) => p.test(stderr))) return "throttle";
    return "other";
  }

  /** Common auth flags so probe and download see the same session. */
  private cookieArgs(): string[] {
    if (this.opts.cookiesFile) return ["--cookies", this.opts.cookiesFile];
    if (this.opts.cookiesFromBrowser)
      return ["--cookies-from-browser", this.opts.cookiesFromBrowser];
    return [];
  }

  /** Fetch metadata JSON without downloading. */
  async probe(videoId: string): Promise<YtdlpInfo> {
    const url = `https://music.youtube.com/watch?v=${videoId}`;
    const proc = await $`yt-dlp -J --no-playlist ${this.cookieArgs()} ${url}`
      .quiet()
      .nothrow();
    if (proc.exitCode !== 0) {
      const errText = new TextDecoder().decode(proc.stderr);
      const kind = this.classifyError(errText);
      if (kind === "gone") throw new Error("GONE");
      throw new Error(errText.split("\n").slice(-3).join(" ").slice(0, 300));
    }
    return JSON.parse(new TextDecoder().decode(proc.stdout)) as YtdlpInfo;
  }

/** Bitrate by known YouTube format ID. */
  static formatBitrateKbps(formatId: string | null | undefined): number | null {
    switch (formatId) {
      case "141": return 256;
      case "774": return 256;
      case "140": return 128;
      case "251": return 130;
      case "250": return 61;
      case "249": return 46;
      default: return null;
    }
  }

  /**
   * Parse yt-dlp's stdout after a download: --newline progress lines start
   * with "[" and must not shadow the printed filepath / format id.
   */
  static parseDownloadOutput(stdout: string): {
    filePath?: string;
    formatId?: string;
  } {
    const printed = stdout
      .trim()
      .split("\n")
      .filter((l) => !/^\[/.test(l));
    return {
      filePath: printed.find((l) => l.endsWith(".m4a")),
      formatId: printed.find((l) => /^[0-9]+$/.test(l.trim())),
    };
  }

  /** Download best audio; returns path of the landed file. */
  async download(
    videoId: string,
    info: YtdlpInfo,
    genre?: string | null,
  ): Promise<DownloadResult> {
    const url = `https://music.youtube.com/watch?v=${videoId}`;
    const folder = genre ? `/${sanitizeGenreFolder(genre)}` : "";
    const outTemplate = `${this.opts.musicDir}${folder}/%(title)s.%(ext)s`;

    const args = [
      // Audio-only, always. Never let format fallback pick a merged
      // video+audio format (that's how .webm/.mp4 strays happen).
      "-f", "141/bestaudio[ext=m4a]/bestaudio/bestaudio*",
      "-x", "--audio-format", "m4a", "--audio-quality", "0",
      "-o", outTemplate,
      "--no-playlist",
      "--embed-thumbnail", "--embed-metadata",
      "--no-overwrites",
      "--newline",
      "--progress",
      "--print", "after_move:%(filepath)s",
      "--print", "after_move:%(format_id)s",
    ];
    args.push(...this.cookieArgs());
    void info;
    const proc = await $`yt-dlp ${args} ${url}`.quiet().nothrow();
    const stderr = new TextDecoder().decode(proc.stderr);

    if (proc.exitCode !== 0) {
      const kind = this.classifyError(stderr);
      if (kind === "gone") return { status: "gone", error: "video unavailable" };
      return {
        status: "failed",
        error: stderr.split("\n").slice(-2).join(" ").slice(0, 300),
      };
    }

    // Filter out any [download]/[ExtractAudio] progress lines first so a
    // numeric-looking fragment of a filename can't shadow the format ID.
    const { filePath, formatId } = Downloader.parseDownloadOutput(
      new TextDecoder().decode(proc.stdout),
    );
    if (!filePath) {
      return { status: "failed", error: "no output path from yt-dlp" };
    }

    return {
      status: "downloaded",
      filePath,
      formatId,
      info,
    };
  }
}
