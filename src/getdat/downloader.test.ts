import { describe, expect, test } from "bun:test";
import { parseYtdlpInfo } from "./downloader";

describe("yt-dlp metadata boundary", () => {
  test("malformed JSON is classified as invalid downloader output", () => {
    expect(() => parseYtdlpInfo("{not-json")).toThrow(
      "yt-dlp metadata output was not valid JSON",
    );
    expect(() => parseYtdlpInfo("[]")).toThrow(
      "yt-dlp metadata output was not valid JSON",
    );
  });
});
