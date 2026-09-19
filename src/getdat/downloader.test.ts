import { describe, expect, test } from "bun:test";
import { Downloader, ytdlpCookieArgs } from "./downloader";

describe("ytdlpCookieArgs — the ONE cookie-order seam (#81)", () => {
  test("explicit jar wins over browser extraction", () => {
    expect(ytdlpCookieArgs("/tmp/jar.txt", "chrome")).toEqual([
      "--cookies",
      "/tmp/jar.txt",
    ]);
  });

  test("browser extraction when no jar", () => {
    expect(ytdlpCookieArgs(null, "chrome")).toEqual([
      "--cookies-from-browser",
      "chrome",
    ]);
  });

  test("empty when unconfigured — callers spread it", () => {
    expect(ytdlpCookieArgs(null, null)).toEqual([]);
    expect(ytdlpCookieArgs(undefined, undefined)).toEqual([]);
    expect(ytdlpCookieArgs("", "")).toEqual([]);
  });

  test("empty-string jar does not shadow a browser config (falsy = absent)", () => {
    expect(ytdlpCookieArgs("", "firefox")).toEqual([
      "--cookies-from-browser",
      "firefox",
    ]);
  });

  test("MEGADJ_COOKIES default shape (chrome, no jar) — the sync 403 case", () => {
    // Regression pin: the old inline twin skipped browser extraction and
    // made `megadj sync` fail every auth-required liked list.
    expect(ytdlpCookieArgs(undefined, "chrome")).toEqual([
      "--cookies-from-browser",
      "chrome",
    ]);
  });
});

describe("parseDownloadOutput — SC mp3 fallback shapes (#258-superfix)", () => {
  test("the mp3 fallback path parses positionally (no extraction run)", () => {
    // When scExtractionArgs returns [], yt-dlp lands the ORIGINAL .mp3 —
    // no [ExtractAudio] line exists, so the after_move prints are the
    // last two lines exactly.
    const out = [
      "[download] 100% of 4.20MiB",
      "https://example.com/music/Track.mp3 has already been downloaded",
      "/music/House/Artist - Track.mp3",
      "hls_mp3_0_1",
    ].join("\n");
    const parsed = Downloader.parseDownloadOutput(out, { soundcloud: true });
    expect(parsed.filePath).toBe("/music/House/Artist - Track.mp3");
    expect(parsed.formatId).toBe("hls_mp3_0_1");
  });

  test("the m4a extraction path still parses (ExtractAudio line filtered)", () => {
    const out = [
      "[download] Destination: /music/Artist - Track.mp4",
      "[download] 100% of 4.20MiB",
      "[ExtractAudio] Destination: /music/House/Artist - Track.m4a",
      "/music/House/Artist - Track.m4a",
      "hls_aac_160k",
    ].join("\n");
    const parsed = Downloader.parseDownloadOutput(out, { soundcloud: true });
    expect(parsed.filePath).toBe("/music/House/Artist - Track.m4a");
    expect(parsed.formatId).toBe("hls_aac_160k");
  });

  test("a title with brackets still lands positionally (the #256 regression)", () => {
    const out = [
      "[download] 100%",
      "/music/Unknown Genre/Artist - [EP] Title.m4a",
      "hls_aac_160k",
    ].join("\n");
    const parsed = Downloader.parseDownloadOutput(out, { soundcloud: true });
    expect(parsed.filePath).toBe(
      "/music/Unknown Genre/Artist - [EP] Title.m4a",
    );
  });
});
