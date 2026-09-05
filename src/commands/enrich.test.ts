import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "../state";
import { enrich } from "./enrich";

let dir: string;
let state: ArchiveState;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-enrich-test-"));
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedDownloaded(videoId: string, title: string, artist: string) {
  const file = join(dir, `${title}.m4a`);
  writeFileSync(file, "fake audio");
  state.upsertTrackFromPlaylist(videoId, 0, title);
  state.markDownloaded(videoId, {
    title,
    artist,
    album: null,
    formatId: null,
    bitrateKbps: 256,
    codec: "aac",
    filePath: file,
    fileSizeBytes: 10,
    durationS: 200,
  });
  return file;
}

describe("enrich (DB/file genre agreement)", () => {
  test("tag-write failure keeps the DB genre unchanged (no divergence)", async () => {
    const file = seedDownloaded("v1", "Track One", "Artist One");
    const logs: string[] = [];
    await enrich({
      state,
      musicDir: dir,
      json: true,
      onProgress: (m) => logs.push(m),
      genreResolver: async () => "Techno",
      tagWriter: async () => false, // file write fails (e.g. corrupt input)
    });

    // The DB must NOT record a genre the file never received — a diverged
    // row is invisible to every later enrich pass (genre no longer weak)
    // and organizes the track into a folder its tag doesn't mention.
    const row = state.allTracks().find((t) => t.video_id === "v1");
    expect(row?.genre).toBeNull();

    // And the run must report the failure instead of counting it "upgraded".
    expect(logs.some((m) => m.includes("tag write failed"))).toBe(true);
    expect(logs.some((m) => m.includes("write-failed"))).toBe(true);
    void file;
  });

  test("successful write updates both file and DB", async () => {
    seedDownloaded("v2", "Track Two", "Artist Two");
    const written: Array<[string, string]> = [];
    await enrich({
      state,
      musicDir: dir,
      onProgress: () => {},
      genreResolver: async () => "House",
      tagWriter: async (p, g) => {
        written.push([p, g]);
        return true;
      },
    });

    const row = state.allTracks().find((t) => t.video_id === "v2");
    expect(row?.genre).toBe("House");
    expect(written).toEqual([
      [join(dir, "Track Two.m4a"), "House"],
    ]);
  });
});
