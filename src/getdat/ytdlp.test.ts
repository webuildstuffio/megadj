import { describe, expect, test } from "bun:test";
import { ytdlpCookieArgs } from "./ytdlp";

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
