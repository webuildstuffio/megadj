import { describe, expect, it, afterEach } from "bun:test";
import { discogsApiAvailable, discogsApiCacheReset } from "./discogs-api";

describe("discogs-api", () => {
  afterEach(() => {
    discogsApiCacheReset();
    delete process.env["MEGADJ_DISCOGS_KEY"];
    delete process.env["MEGADJ_DISCOGS_SECRET"];
  });

  it("discogsApiAvailable returns false without env vars", () => {
    delete process.env["MEGADJ_DISCOGS_KEY"];
    delete process.env["MEGADJ_DISCOGS_SECRET"];
    discogsApiCacheReset();
    expect(discogsApiAvailable()).toBe(false);
  });

  it("discogsApiAvailable returns true with both env vars", () => {
    process.env["MEGADJ_DISCOGS_KEY"] = "test-key";
    process.env["MEGADJ_DISCOGS_SECRET"] = "test-secret";
    discogsApiCacheReset();
    expect(discogsApiAvailable()).toBe(true);
  });

  it("discogsApiAvailable returns false with only key", () => {
    process.env["MEGADJ_DISCOGS_KEY"] = "test-key";
    delete process.env["MEGADJ_DISCOGS_SECRET"];
    discogsApiCacheReset();
    expect(discogsApiAvailable()).toBe(false);
  });
});
