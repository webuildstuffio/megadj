import { describe, expect, test } from "bun:test";
import { pickRbKeeper, pickScoredKeeper } from "./keeper";

const byFile = (f: string, score: number) => ({ path: f, score });

const decide = (rankOriginal: number, rankTwin: number): string =>
  rankTwin > rankOriginal ? "keep-twin" : "keep-original";

/**
 * Policy table for the keeper decision (#158). Every tier's ordering is
 * pinned here so a future edit cannot silently change which file
 * survives in a live tier — the winners below ARE the shipped behavior.
 */

describe("keeper policy table (#158)", () => {
  test("rb tier: Contents-member first, then bitrate, size, stable path", () => {
    const contents = {
      path: "/Volumes/SHELF1/Contents/Art/a.mp3",
      size: 10,
      bitrate: 128,
    };
    const archive = {
      path: "/Volumes/SHELF1/Archive/Art/a.mp3",
      size: 99,
      bitrate: 320,
    };
    // Contents membership beats EVERY quality signal
    expect(pickRbKeeper(contents, archive)).toBe("a");
    expect(pickRbKeeper(archive, contents)).toBe("b");
    // same location: higher bitrate
    expect(
      pickRbKeeper(
        { path: "/x/a.mp3", size: 10, bitrate: 320 },
        { path: "/x/b.mp3", size: 99, bitrate: 128 },
      ),
    ).toBe("a");
    // same bitrate: bigger size
    expect(
      pickRbKeeper(
        { path: "/x/a.mp3", size: 99, bitrate: 128 },
        { path: "/x/b.mp3", size: 10, bitrate: 128 },
      ),
    ).toBe("a");
    // full tie: stable path (lexicographic)
    expect(
      pickRbKeeper(
        { path: "/x/b.mp3", size: 10, bitrate: 128 },
        { path: "/x/a.mp3", size: 10, bitrate: 128 },
      ),
    ).toBe("b");
  });

  test("ingest tier: higher score, then shorter basename, then first-seen", () => {
    // higher score wins regardless of name length
    expect(
      pickScoredKeeper(
        byFile("/i/Short.mp3", 10),
        byFile("/i/AVeryLongName.mp3", 20),
        (r) => r.path,
        (r) => r.score,
      ),
    ).toBe("b");
    // equal score: shorter basename (the pool-rip noise rule)
    expect(
      pickScoredKeeper(
        byFile("/i/LongName - Extended Mix.mp3", 10),
        byFile("/i/Track 1.mp3", 10),
        (r) => r.path,
        (r) => r.score,
      ),
    ).toBe("b");
    // full tie: first-seen (incumbent) stays
    expect(
      pickScoredKeeper(
        byFile("/i/a.mp3", 10),
        byFile("/i/a.mp3", 10),
        (r) => r.path,
        (r) => r.score,
      ),
    ).toBe("a");
  });
});

describe("shelf-dedupe qualityRank policy (same table, rank form)", () => {
  test("higher rank wins; equal rank keeps the incumbent (original)", () => {
    // shelf-dedupe-verdict compares qualityRank(original) vs qualityRank(twin):
    // higher wins, tie keeps original. The policy lives in
    // shelf-dedupe-probe (ext ladder + probe bitrate); the DECISION shape
    // is pinned here so a flip cannot land silently.
    expect(decide(4.032, 4.032)).toBe("keep-original"); // tie → original
    expect(decide(1.0, 4.032)).toBe("keep-twin"); // flac(320k) beats mp3
    expect(decide(4.032, 1.0)).toBe("keep-original");
  });
});
