import { describe, expect, test } from "bun:test";
import { Downloader, parseYtdlpInfo } from "./downloader";

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

// The sync pipeline used to mint `?? "Music"` before calling download;
// now null flows through and BOTH junk cases land in the ONE shared
// "Unknown Genre" bucket (sanitizeGenreFolder contract, #61 family).
// Captures the argv (no network) and reads the -o template — the folder
// choice IS the bug surface.
function downloadGenreOutTemplate(
  genre: string | null | undefined,
): Promise<string> {
  const d = new Downloader({ musicDir: "/M" });
  let captured: string[] = [];
  (
    d as unknown as {
      spawn: (args: string[]) => Promise<{ exitCode: number }>;
    }
  ).spawn = async (args: string[]) => {
    captured = args;
    return { exitCode: 1 };
  };
  // exit 1 → a `failed` result (not a throw) — the argv is captured
  // either way, which is all this probe needs.
  return d.download("x", {}, genre).then(() => {
    const i = captured.indexOf("-o");
    return i !== -1 ? (captured[i + 1] ?? "") : "";
  });
}

describe("download genre → output folder plumbing (Sep 17)", () => {
  test("null genre → archive root (no folder segment)", async () => {
    expect(await downloadGenreOutTemplate(null)).toBe("/M/%(title)s.%(ext)s");
  });

  test("'Music' junk → the shared Unknown Genre bucket, never a Music folder", async () => {
    expect(await downloadGenreOutTemplate("Music")).toBe(
      "/M/Unknown Genre/%(title)s.%(ext)s",
    );
  });

  test("real genre passes through to its own folder", async () => {
    expect(await downloadGenreOutTemplate("House")).toBe(
      "/M/House/%(title)s.%(ext)s",
    );
  });
});
