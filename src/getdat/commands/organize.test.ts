import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArchiveState } from "../../core/state";
import { organize } from "./organize";
import { downloadBatchDir } from "./intake-folder";
import { tempState } from "../../test-support/testutil";
import { writeFakeAudio } from "../../test-support/audio-fixtures";

let dir: string;
let musicDir: string;
let state: ArchiveState;
const ts = tempState("megadj-organize-test-");

beforeEach(() => {
  ({ dir, state } = ts.next());
  musicDir = join(dir, "music");
  mkdirSync(musicDir, { recursive: true });
});

afterEach(() => {
  ts.done({ dir, state });
});

function seedDownloaded(videoId: string, title: string, filePath: string) {
  writeFakeAudio(filePath, "fake audio");
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
    // Loose at the MUSIC ROOT (the real "unorganized download" shape) —
    // earlier this sat in the temp dir OUTSIDE musicDir; the Sep 19 scope
    // guard rightly skips outside-scope rows, so the fixture moved inside.
    const src = join(musicDir, "Track X.m4a");
    seedDownloaded("v2", "Track X", src);
    const { chmodSync } = await import("node:fs");
    // The batch folder is mkdir'd by organize INSIDE musicDir — make THAT
    // the read-only failure point (a read-only musicDir itself would break
    // the fixture-seam cleanup that rm's the temp dir).
    const batchDir = downloadBatchDir(musicDir, "organized");
    mkdirSync(batchDir, { recursive: true });
    chmodSync(batchDir, 0o555); // read-only target: mv inside it fails

    const logs: string[] = [];
    await organize({
      state,
      musicDir,
      onProgress: (m) => logs.push(m),
    });
    chmodSync(batchDir, 0o755); // restore so cleanup can delete

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

  test("a loose root file lands in the dated batch folder (never genre, never loose)", async () => {
    const src = join(musicDir, "Track Y.m4a");
    seedDownloaded("v3", "Track Y", src);
    await organize({ state, musicDir, onProgress: () => {} });

    const row = state.allTracks().find((t) => t.video_id === "v3");
    // The batch folder is `<date> organized downloads/` — genre is metadata
    // in the ledger, never a destination folder (Sep 19 policy).
    const batchDir = downloadBatchDir(musicDir, "organized");
    expect(row?.file_path).toBe(join(batchDir, "Track Y.m4a"));
    expect(basename(batchDir)).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });
});

describe("organize F5 move-or-merge", () => {
  test("a byte-identical destination MERGES: source removed, row repointed, no [id] twin born", async () => {
    // The destination is an EXISTING batch folder (the one organize itself
    // sweeps into) — the twin already sits there.
    const destDir = downloadBatchDir(musicDir, "organized");
    mkdirSync(destDir, { recursive: true });
    // the destination already holds the organized copy
    writeFakeAudio(join(destDir, "Track M.m4a"), "same-bytes");
    // a second row whose loose root copy has IDENTICAL bytes (the
    // case-variant download twin the merge exists for)
    const src = join(musicDir, "loose", "track m.m4a");
    mkdirSync(join(musicDir, "loose"), { recursive: true });
    writeFakeAudio(src, "same-bytes");
    state.upsertTrackFromPlaylist("vm", 0, "Track M");
    state.markDownloaded("vm", {
      title: "Track M",
      artist: "A",
      album: null,
      genre: "House",
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: src,
      fileSizeBytes: 10,
      durationS: 200,
    });

    const logs: string[] = [];
    await organize({ state, musicDir, onProgress: (m) => logs.push(m) });

    const { existsSync } = await import("node:fs");
    expect(existsSync(src)).toBe(false); // merged away
    expect(existsSync(join(destDir, "Track M.m4a"))).toBe(true);
    expect(existsSync(join(destDir, "track m [vm].m4a"))).toBe(false); // no twin born
    const row = state.allTracks().find((t) => t.video_id === "vm");
    // the row repoints at the destination — compared case-insensitively
    // (the row keeps its own case-spelling of the same APFS file, which
    // is exactly the F5 rule: byte identity, not string identity)
    expect(row?.file_path?.toLowerCase()).toBe(
      join(destDir, "Track M.m4a").toLowerCase(),
    );
    expect(logs.some((m) => m.includes("merged into"))).toBe(true);
  });

  test("a different-bytes destination keeps the disambiguating rename (no data loss)", async () => {
    const destDir = downloadBatchDir(musicDir, "organized");
    mkdirSync(destDir, { recursive: true });
    writeFakeAudio(join(destDir, "Track D.m4a"), "the-organized-rip");
    const src = join(musicDir, "loose2", "Track D.m4a");
    mkdirSync(join(musicDir, "loose2"), { recursive: true });
    writeFakeAudio(src, "a-different-rip");
    state.upsertTrackFromPlaylist("vd", 0, "Track D");
    state.markDownloaded("vd", {
      title: "Track D",
      artist: "A",
      album: null,
      genre: "House",
      formatId: null,
      bitrateKbps: 256,
      codec: "aac",
      filePath: src,
      fileSizeBytes: 10,
      durationS: 200,
    });

    await organize({ state, musicDir, onProgress: () => {} });

    const { existsSync } = await import("node:fs");
    // BOTH rips survive: destination untouched + the [id] twin
    expect(existsSync(join(destDir, "Track D.m4a"))).toBe(true);
    expect(existsSync(join(destDir, "Track D [vd].m4a"))).toBe(true);
    const row = state.allTracks().find((t) => t.video_id === "vd");
    expect(row?.file_path).toBe(join(destDir, "Track D [vd].m4a"));
  });
});
