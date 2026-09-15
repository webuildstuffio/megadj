/**
 * ytdlp — the yt-dlp spawn-argument seams (issue #81).
 *
 * Cookie resolution order (explicit jar first, then browser extraction)
 * used to live twice: downloader.cookieArgs() and an inline twin in
 * sync.ts whose comment admitted it was a hand-maintained mirror
 * ("Cookie resolution order mirrors the downloader"). The mirror had
 * already cost one outage — skipping browser extraction made
 * `megadj sync` 403 every auth-required liked list while the downloader
 * worked. ONE builder now; both call sites delegate.
 */

/** Cookie flags for yt-dlp: explicit jar wins, then browser extraction,
 *  else nothing. Empty array when unconfigured — callers spread it. */
export function ytdlpCookieArgs(
  cookiesFile: string | null | undefined,
  cookiesFromBrowser: string | null | undefined,
): string[] {
  if (cookiesFile) return ["--cookies", cookiesFile];
  if (cookiesFromBrowser) return ["--cookies-from-browser", cookiesFromBrowser];
  return [];
}
