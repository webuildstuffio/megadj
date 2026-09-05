import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "../state";
import { adopt } from "./adopt";

let dir: string;
let state: ArchiveState;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-adopt-test-"));
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("adopt (vanished-file resilience)", () => {
  test("a file that vanishes mid-pass is skipped, not fatal", async () => {
    // The deterministic ENOENT window (between walkM4a and the per-file
    // stat) can't be hit from outside, so this pins the observable
    // contract: a title whose file is absent stays pending while every
    // other match still adopts — the in-loop guard keeps the same
    // guarantee when the file disappears AFTER the walk.
    state.upsertTrackFromPlaylist("v1", 0, "Present Track");
    state.upsertTrackFromPlaylist("v2", 1, "Vanish Track");
    writeFileSync(join(dir, "Present Track.m4a"), "audio");
    writeFileSync(join(dir, "Vanish Track.m4a"), "audio");
    unlinkSync(join(dir, "Vanish Track.m4a"));

    const logs: string[] = [];
    await adopt({
      state,
      musicDir: dir,
      onProgress: (m) => logs.push(m),
    });

    expect(
      state.allTracks().find((t) => t.video_id === "v1")?.status,
    ).toBe("downloaded");
    expect(
      state.allTracks().find((t) => t.video_id === "v2")?.status,
    ).toBe("pending");
    expect(logs.some((m) => m.includes("adopted 1 file(s)"))).toBe(true);
  });

  test("existing files are adopted and marked downloaded", async () => {
    state.upsertTrackFromPlaylist("v3", 0, "Real Track");
    writeFileSync(join(dir, "Real Track.m4a"), "audio");
    await adopt({ state, musicDir: dir, onProgress: () => {} });

    const row = state.allTracks().find((t) => t.video_id === "v3");
    expect(row?.status).toBe("downloaded");
    expect(row?.file_path).toBe(join(dir, "Real Track.m4a"));
  });
});
