// radar.test.ts — #148 new-music radar: the pure set-difference engine.
// Fixture-tested end to end per the acceptance criteria (delta = archive
// rows minus snapshot rows); the DB/route layers stay thin.
import { describe, it, expect } from "bun:test";
import { radar, archivePathKey, type RadarSource } from "./radar";

function arch(
  videoId: string,
  path: string | null,
  over: Partial<RadarSource> & { firstSeenAt?: string | null } = {},
): RadarSource & { videoId: string; firstSeenAt: string | null } {
  const title = path?.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "") ?? null;
  return {
    videoId,
    path,
    title,
    artist: "Artist",
    firstSeenAt: "2026-09-15T00:00:00Z",
    ...over,
  };
}

function driveRow(path: string, over: Partial<RadarSource> = {}): RadarSource {
  return { path, title: path, artist: "Artist", ...over };
}

describe("radar (#148)", () => {
  it("set difference: archive rows the drive lacks, COUNT from the full set", () => {
    const archive = [
      arch("a1", "/music/batch/Contents/On Drive.mp3"),
      arch("a2", "/music/batch/Contents/Missing One.mp3"),
      arch("a3", "/music/batch/Contents/Missing Two.mp3"),
    ];
    const drive = [driveRow("on drive.mp3")];
    const r = radar("d1", "Stick A", archive, drive);
    expect(r.missingCount).toBe(2); // COUNT truth, not the capped list
    expect(r.missing.map((m) => m.videoId).toSorted()).toEqual(["a2", "a3"]);
  });

  it("archivePathKey folds + strips through Contents/ (the fleet key)", () => {
    expect(archivePathKey("/x/batch/Contents/Artist/Track.mp3")).toBe(
      "artist/track.mp3",
    );
    // no Contents/ segment → the whole folded path
    expect(archivePathKey("/music/Artist/Track.mp3")).toBe(
      "/music/artist/track.mp3",
    );
    expect(archivePathKey(null)).toBeNull();
  });

  it("NFC+casefold: NFD drive names still match NFC archive names", () => {
    const nfd = "cafe\u0301 set.mp3";
    const archive = [arch("a1", "/music/Contents/Café Set.mp3")];
    const drive = [driveRow(nfd)];
    expect(radar("d", "D", archive, drive).missingCount).toBe(0);
  });

  it("meta fallback: a regrouped same-track still counts as present", () => {
    const archive = [
      arch("a1", "/music/Contents/Batch/Track One.mp3", {
        title: "Track One",
        artist: "DJ X",
      }),
    ];
    const drive = [
      // shelf regrouped it into artist folders → path key differs
      driveRow("dj x/track one.mp3", { title: "Track One", artist: "DJ X" }),
    ];
    expect(radar("d", "D", archive, drive).missingCount).toBe(0);
  });

  it("meta fallback never matches when BOTH sides lack identity", () => {
    const archive = [arch("a1", null, { title: null, artist: null })];
    const drive = [driveRow("some/other.mp3", { title: null, artist: null })];
    const r = radar("d", "D", archive, drive);
    expect(r.missingCount).toBe(1);
    expect(r.missing[0]!.videoId).toBe("a1");
  });

  it("newest-first preview order; preview capped but COUNT stays whole", () => {
    const archive = Array.from({ length: 60 }, (_, i) =>
      arch(`v${i}`, `/m/Contents/T${i}.mp3`, {
        firstSeenAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const r = radar("d", "D", archive, [], 50);
    expect(r.missingCount).toBe(60);
    expect(r.missing).toHaveLength(50);
    // newest first_seen leads
    expect(r.missing[0]!.firstSeenAt! >= r.missing[1]!.firstSeenAt!).toBe(true);
  });

  it("empty drive inventory = the whole archive is missing", () => {
    const r = radar("d", "D", [arch("a1", "/m/Contents/A.mp3")], []);
    expect(r.missingCount).toBe(1);
    expect(r.summary).toContain("not on this drive");
  });

  it("empty archive = drive matches, zero misses, no fake rows", () => {
    const r = radar("d", "D", [], [driveRow("a.mp3")]);
    expect(r.missingCount).toBe(0);
    expect(r.archiveTracks).toBe(0);
    expect(r.summary).toContain("matches the archive");
  });

  it("drive rows with null paths never crash the fold", () => {
    const r = radar(
      "d",
      "D",
      [arch("a1", "/m/Contents/A.mp3")],
      [{ path: null, title: "A", artist: "Artist" }],
    );
    // meta fallback still sees it: "artist - a" vs the archive row's
    // own meta key "artist - a" — same identity, different path shape
    expect(r.missingCount).toBe(0);
  });
});
