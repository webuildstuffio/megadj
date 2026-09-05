import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "../state";
import { organize } from "./organize";

let dir: string;
let musicDir: string;
let state: ArchiveState;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-organize-test-"));
  musicDir = join(dir, "music");
  mkdirSync(musicDir, { recursive: true });
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedDownloaded(videoId: string, title: string, filePath: string) {
  writeFileSync(filePath, "fake audio");
  state.upsertTrackFromPlaylist(videoId, 0, title);
  state.markDownloaded(videoId, {
    title,
    artist: "A",
    album: null,
    genre: "House",
    formatId: null,
    bitrateKbps: 256,
    codec: "aac",
    filePath,
    fileSizeBytes: 10,
    durationS: 200,
  });
}

describe("organize (move-failure honesty)", () => {
  test("failed mv leaves the DB path unchanged and is reported", async () => {
    // Organize's "missing on disk" pre-check would swallow a deleted source,
    // so force the mv itself to fail: a read-only TARGET dir (exists() still
    // works, writes fail) — exactly like EXDEV/permission failures in prod.
    mkdirSync(join(musicDir), { recursive: true });
    const src = join(dir, "Track X.m4a");
    seedDownloaded("v2", "Track X", src);
    const { chmodSync } = await import("node:fs");
    chmodSync(musicDir, 0o555); // read-only target: mv inside it fails

    const logs: string[] = [];
    await organize({
      state,
      musicDir,
      onProgress: (m) => logs.push(m),
    });
    chmodSync(musicDir, 0o755); // restore so cleanup can delete

    const row = state.allTracks().find((t) => t.video_id === "v2");
    expect(row?.file_path).toBe(src); // unchanged — no phantom path
    // The hardened mkdir skips before mv; either way the move must be
    // reported as failed, never silently "succeed" in the DB.
    expect(
      logs.some(
        (m) => m.includes("move failed") || m.includes("cannot create"),
      ),
    ).toBe(true);
    expect(logs.some((m) => m.includes("move-failed"))).toBe(true);
  }, 20_000);

  test("successful move updates the DB path and lands in the genre folder", async () => {
    const src = join(dir, "Track Y.m4a");
    seedDownloaded("v3", "Track Y", src);
    await organize({ state, musicDir, onProgress: () => {} });

    const row = state.allTracks().find((t) => t.video_id === "v3");
    expect(row?.file_path).toBe(join(musicDir, "House", "Track Y.m4a"));
  });
});
