/**
 * yt-dlp driver. One JSON-info probe per track (rate-limited), then the
 * download itself. Classifies failures into permanent vs transient so the
 * limiter can back off appropriately.
 */

import { $ } from "bun";
import { sanitizeGenreFolder } from "../fulltags/write/schema";
import type { YtdlpInfo } from "../fulltags/write/metadata-build";
import {
  SC_FORMAT,
  SC_SOURCE,
  classifyScFailure,
  scFormatKbps,
} from "./soundcloud";

/** Cookie flags for yt-dlp: explicit jar wins, then browser extraction,
 *  else nothing. Empty array when unconfigured — callers spread it.
 *  (#81) Cookie resolution order used to live twice: downloader.cookieArgs()
 *  and an inline twin in sync.ts whose comment admitted it was a
 *  hand-maintained mirror. The mirror had already cost one outage —
 *  skipping browser extraction made `megadj sync` 403 every
 *  auth-required liked list while the downloader worked. ONE builder;
 *  both call sites delegate. (#221: ytdlp.ts, 22L, merged into its
 *  only procedural host.) */
export function ytdlpCookieArgs(
  cookiesFile: string | null | undefined,
  cookiesFromBrowser: string | null | undefined,
): string[] {
  if (cookiesFile) return ["--cookies", cookiesFile];
  if (cookiesFromBrowser) return ["--cookies-from-browser", cookiesFromBrowser];
  return [];
}
export interface DownloadResult {
  status: "downloaded" | "already-had" | "gone" | "failed";
  filePath?: string | undefined;
  formatId?: string | undefined;
  info?: YtdlpInfo | undefined;
  error?: string | undefined;
}

/** The download target for one row. `video_id` remains the ledger PK:
 *  YT rows keep their 11-char video id, SC rows keep the numeric SC
 *  track id (no collision — disjoint shapes). `url` is the exact URL
 *  yt-dlp is fed (the source seam — #255 replaced the hardcoded
 *  music.youtube.com strings). */
export interface DownloadTarget {
  id: string;
  url: string;
  soundcloud: boolean;
}

/** Build the target from a ledger row id + its source column. The ONE
 *  place that knows how ids map to URLs (the old code hardcoded
 *  `https://music.youtube.com/watch?v=` in both probe and download). */
export function targetFor(trackId: string, source: string): DownloadTarget {
  if (source === SC_SOURCE) {
    return {
      id: trackId,
      url: `https://api.soundcloud.com/tracks/${trackId}`,
      soundcloud: true,
    };
  }
  return {
    id: trackId,
    url: `https://music.youtube.com/watch?v=${trackId}`,
    soundcloud: false,
  };
}

export interface DownloaderOptions {
  musicDir: string;
  /** yt-dlp binary to invoke (default "yt-dlp") — previously declared and
   * silently ignored; every spawn used a hardcoded "yt-dlp". */
  ytdlpBin?: string | undefined;
  cookiesFromBrowser?: string | null | undefined;
  /** Cookie jar file (netscape format) — preferred over browser extraction. */
  cookiesFile?: string | null | undefined;
  minBitrateKbps?: number | undefined;
  /** The ledger source of the rows being downloaded ("liked" | "liked-videos"
   *  | "soundcloud" | …) — decides the probe/download URL seam (#255). */
  source?: string | undefined;
}

/** Permanent SC failure (DRM/Go+): surfaced as its own error class so the
 *  sync loop can park the row WITHOUT the retry ladder and WITHOUT the
 *  gone-marking (the track exists; the stream is not acquirable). */
export class ScPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScPermanentError";
  }
}

/** Decode yt-dlp metadata at the process boundary with a useful failure. */
export function parseYtdlpInfo(stdout: string): YtdlpInfo {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("metadata root is not an object");
    }
    return parsed as YtdlpInfo;
  } catch (error) {
    throw new Error("yt-dlp metadata output was not valid JSON", {
      cause: error,
    });
  }
}

const GONE_PATTERNS = [
  /video unavailable/i,
  /account associated with this video has been terminated/i,
  /removed following a copyright removal request/i,
  /private video/i,
  /makes it unavailable in your country/i,
];

const THROTTLE_PATTERNS = [
  /429|too many requests/i,
  /http error 5\d\d/i,
  /connection reset|timed out|ETIMEDOUT|ENOTFOUND|ECONNRESET/i,
  /premiere|live event/i,
  // Auth/bot-shield text is NOT a dead video: classifying it "gone" used
  // to permanently mark every live track gone when cookies expired
  // (markGone is permanent — nothing ever revisits gone rows). Backoff +
  // retry instead, and `megadj retry` can requeue a failed run.
  /sign in to confirm/i,
  /confirm you'?re not a bot/i,
];

export class Downloader {
  private readonly opts: DownloaderOptions & {
    musicDir: string;
    ytdlpBin: string;
  };

  constructor(opts: DownloaderOptions) {
    this.opts = {
      musicDir: opts.musicDir,
      ytdlpBin: opts.ytdlpBin ?? "yt-dlp",
      cookiesFromBrowser: opts.cookiesFromBrowser ?? null,
      cookiesFile: opts.cookiesFile ?? null,
      source: opts.source ?? "liked",
    };
  }
  classifyError(stderr: string): "gone" | "throttle" | "other" {
    if (GONE_PATTERNS.some((p) => p.test(stderr))) return "gone";
    if (THROTTLE_PATTERNS.some((p) => p.test(stderr))) return "throttle";
    return "other";
  }

  /** Common auth flags so probe and download see the same session —
   *  the shared builder (issue #81); resolution order lives in ytdlp.ts. */
  private cookieArgs(): string[] {
    return ytdlpCookieArgs(this.opts.cookiesFile, this.opts.cookiesFromBrowser);
  }

  /**
   * Spawn yt-dlp. The binary comes from this.opts.ytdlpBin and args are
   * passed as one array — Bun shell interpolates arrays as individually
   * quoted argv entries, so the command position is always the binary.
   */
  private spawn(args: string[]) {
    return $`${[this.opts.ytdlpBin, ...args]}`.quiet().nothrow();
  }

  /** Fetch metadata JSON without downloading. */
  async probe(videoId: string): Promise<YtdlpInfo> {
    const target = targetFor(videoId, this.opts.source ?? "liked");
    const proc = await this.spawn([
      "-J",
      "--no-playlist",
      ...this.cookieArgs(),
      target.url,
    ]);
    if (proc.exitCode !== 0) {
      const errText = new TextDecoder().decode(proc.stderr);
      if (target.soundcloud) {
        // SC failure classes first: a permalink 404 is permanent-gone,
        // DRM/Go+ is permanent — neither may fall into retry-backoff
        // (#255; the generic classifier retried 404 slugs forever).
        const sc = classifyScFailure(errText);
        if (sc === "gone") throw new Error("GONE");
        if (sc === "permanent") throw new ScPermanentError(errText);
      }
      const kind = this.classifyError(errText);
      if (kind === "gone") throw new Error("GONE");
      throw new Error(errText.split("\n").slice(-3).join(" ").slice(0, 300));
    }
    return parseYtdlpInfo(new TextDecoder().decode(proc.stdout));
  }

  /** Bitrate by known YouTube format ID. SC ids route through the SC map
   *  (soundcloud.ts) — one lookup per family, one caller seam. */
  static formatBitrateKbps(formatId: string | null | undefined): number | null {
    const sc = scFormatKbps(formatId);
    if (sc !== null) return sc;
    switch (formatId) {
      case "141":
        return 256;
      case "774":
        return 256;
      case "140":
        return 128;
      case "251":
        return 130;
      case "250":
        return 61;
      case "249":
        return 46;
      default:
        return null;
    }
  }

  /**
   * Parse yt-dlp's stdout after a download: --newline progress lines start
   * with "[" and must not shadow the printed filepath / format id.
   * `soundcloud` selects the SC output shapes (the SC mp3 path lands a
   * .mp3; SC format ids are not numeric).
   */
  static parseDownloadOutput(
    stdout: string,
    opts: { soundcloud?: boolean } = {},
  ): {
    filePath?: string | undefined;
    formatId?: string | undefined;
  } {
    // The after_move prints (path, then format id) are the LAST two
    // non-progress lines — grabbing them positionally is immune to a
    // filename that starts with "[" (Artist - [EP] Title.m4a), which the
    // old filter-then-scan dropped entirely for SC titles.
    const lines = stdout.trim().split("\n");
    const printed = lines.filter(
      (l) =>
        !/^\[(download|ExtractAudio|Metadata|EmbedThumbnail|Merger|move)/.test(
          l,
        ),
    );
    const filePath = printed.filter((l) => l !== "").at(-2);
    const formatId = printed.at(-1);
    if (
      filePath === undefined ||
      formatId === undefined ||
      !filePath.includes("/")
    ) {
      // Fallback: the legacy scan (non-bracket lines ending in the ext).
      const legacy = stdout
        .trim()
        .split("\n")
        .filter((l) => !l.startsWith("["));
      const ext = opts.soundcloud ? "mp3" : "m4a";
      return {
        filePath: legacy.find((l) => l.endsWith(`.${ext}`)),
        formatId: opts.soundcloud
          ? legacy.find((l) => /^hls_[a-z0-9_]+$/.test(l.trim()))
          : legacy.find((l) => /^[0-9]+$/.test(l.trim())),
      };
    }
    return { filePath, formatId };
  }

  /** Download best audio; returns path of the landed file. */
  async download(
    videoId: string,
    info: YtdlpInfo,
    genre?: string | null,
  ): Promise<DownloadResult> {
    const target = targetFor(videoId, this.opts.source ?? "liked");
    // No "Music" mint (#61): junk genres bucket to "Unknown Genre" here;
    // NULL genre sits at the archive root until `organize` moves it into
    // the same bucket (sanitizeGenreFolder(null)). Never a fake genre.
    const folder = genre ? `/${sanitizeGenreFolder(genre)}` : "";
    const outTemplate = `${this.opts.musicDir}${folder}/%(title)s.%(ext)s`;

    const args = [
      // Audio-only, always. Never let format fallback pick a merged
      // video+audio format (that's how .webm/.mp4 strays happen).
      // SC picks its own ladder: hls_aac_160k is the ceiling (#255).
      "-f",
      target.soundcloud
        ? SC_FORMAT
        : "141/bestaudio[ext=m4a]/bestaudio/bestaudio*",
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
      "-o",
      outTemplate,
      "--no-playlist",
      "--embed-thumbnail",
      "--embed-metadata",
      "--no-overwrites",
      "--newline",
      "--progress",
      "--print",
      "after_move:%(filepath)s",
      "--print",
      "after_move:%(format_id)s",
    ];
    args.push(...this.cookieArgs());
    void info;
    const proc = await this.spawn([...args, target.url]);
    const stderr = new TextDecoder().decode(proc.stderr);

    if (proc.exitCode !== 0) {
      if (target.soundcloud) {
        const sc = classifyScFailure(stderr);
        if (sc === "gone")
          return { status: "gone", error: "track unavailable" };
        if (sc === "permanent")
          return {
            status: "failed",
            error: `permanent (DRM/Go+ or unavailable stream): ${stderr.split("\n").slice(-1).join(" ").slice(0, 200)}`,
          };
      }
      const kind = this.classifyError(stderr);
      if (kind === "gone")
        return { status: "gone", error: "video unavailable" };
      return {
        status: "failed",
        error: stderr.split("\n").slice(-2).join(" ").slice(0, 300),
      };
    }

    // Filter out any [download]/[ExtractAudio] progress lines first so a
    // numeric-looking fragment of a filename can't shadow the format ID.
    const { filePath, formatId } = Downloader.parseDownloadOutput(
      new TextDecoder().decode(proc.stdout),
      { soundcloud: target.soundcloud },
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
