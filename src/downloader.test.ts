import { describe, expect, test } from "bun:test";
import { Downloader } from "./downloader";
import type { RateLimiter } from "./ratelimit";

function makeDownloader(): Downloader {
  const limiter = {} as RateLimiter;
  return new Downloader(limiter, { musicDir: "/tmp/megadj-test" });
}

describe("Downloader.parseDownloadOutput", () => {
  test("extracts filepath and format id from clean output", () => {
    const out = [
      "[download] Destination: foo.m4a",
      "[download] 100% of 6.5MiB",
      "[ExtractAudio] Not a music file 1999 - some song.m4a",
      "/tmp/megadj-test/House/Track A.m4a",
      "141",
    ].join("\n");
    const r = Downloader.parseDownloadOutput(out);
    expect(r.filePath).toBe("/tmp/megadj-test/House/Track A.m4a");
    expect(r.formatId).toBe("141");
  });

  test("progress lines never shadow the format id", () => {
    const out = [
      "[download] 100% of 6.5MiB",
      "/tmp/x/1999 Remaster.m4a",
      "[ExtractAudio] 1999 Remaster.m4a",
      "251",
    ].join("\n");
    const r = Downloader.parseDownloadOutput(out);
    expect(r.formatId).toBe("251");
    expect(r.filePath).toBe("/tmp/x/1999 Remaster.m4a");
  });

  test("missing filepath returns undefined", () => {
    const r = Downloader.parseDownloadOutput("[download] 100%\n");
    expect(r.filePath).toBeUndefined();
  });
});

describe("Downloader.formatBitrateKbps", () => {
  test("maps known formats", () => {
    expect(Downloader.formatBitrateKbps("141")).toBe(256);
    expect(Downloader.formatBitrateKbps("140")).toBe(128);
    expect(Downloader.formatBitrateKbps("999")).toBeNull();
  });
});

describe("Downloader.classifyError", () => {
  test("gone patterns", () => {
    const d = makeDownloader();
    expect(d.classifyError("Video unavailable")).toBe("gone");
    expect(d.classifyError("Private video")).toBe("gone");
  });
  test("throttle patterns", () => {
    const d = makeDownloader();
    expect(d.classifyError("HTTP Error 429")).toBe("throttle");
    expect(d.classifyError("Connection reset by peer")).toBe("throttle");
  });
  test("other", () => {
    expect(makeDownloader().classifyError("some random failure")).toBe("other");
  });
});
