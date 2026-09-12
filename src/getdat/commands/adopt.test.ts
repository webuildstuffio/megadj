import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { adopt, adoptFromShelf } from "./adopt";
import { tempState } from "../../testutil";

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-adopt-test-");

/** Sibling root next to the state temp dir for fake shelf trees. */
function tempRoot(): string {
  return join(import.meta.dir, "../../../../.tmp-test");
}

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
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

    expect(state.allTracks().find((t) => t.video_id === "v1")?.status).toBe(
      "downloaded",
    );
    expect(state.allTracks().find((t) => t.video_id === "v2")?.status).toBe(
      "pending",
    );
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

describe("adoptFromShelf (--shelf repoint)", () => {
  let shelfDir: string;

  beforeEach(() => {
    shelfDir = join(tempRoot(), "shelf-test");
    mkdirSync(join(shelfDir, "Contents/Artist/Album"), { recursive: true });
  });

  afterEach(() => {
    rmSync(shelfDir, { recursive: true, force: true });
  });

  test("repoints a stale local path at the shelf copy (dry-run leaves DB alone)", async () => {
    const { state: s, dir: d } = ts.next();
    s.upsertTrackFromPlaylist("m1", 0, "Moved Track");
    const stalePath = join(d, "Moved Track.m4a"); // never created — stale by construction
    s.markDownloaded("m1", {
      title: "Moved Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: stalePath,
      fileSizeBytes: 5,
      durationS: null,
    });
    // shelf copy with a decomposed (NFD) byte encoding of the same name —
    // macOS HFS+/APFS report NFD; the NFC+casefold index must still match.
    const nfdName = "Moved Track.m4a".normalize("NFD");
    writeFileSync(join(shelfDir, "Contents/Artist/Album", nfdName), "audio");

    const logs: string[] = [];
    await adoptFromShelf({
      state: s,
      musicDir: d,
      shelfVolume: shelfDir,
      dryRun: true,
      onProgress: (m) => logs.push(m),
    });
    expect(s.allTracks().find((t) => t.video_id === "m1")?.file_path).toBe(
      stalePath,
    ); // dry-run: unchanged

    await adoptFromShelf({
      state: s,
      musicDir: d,
      shelfVolume: shelfDir,
      dryRun: false,
      onProgress: () => {},
    });
    const repointed = s.allTracks().find((t) => t.video_id === "m1");
    expect(repointed?.file_path?.startsWith(shelfDir)).toBe(true);
    expect(repointed?.status).toBe("downloaded");
    ts.done({ dir: d, state: s });
  });

  test("repointing migrates the TKEY cache row (no re-read cost)", async () => {
    const { state: s, dir: d } = ts.next();
    s.upsertTrackFromPlaylist("m2", 0, "Cached Track");
    const stalePath = join(d, "Cached Track.m4a");
    s.markDownloaded("m2", {
      title: "Cached Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: stalePath,
      fileSizeBytes: 5,
      durationS: null,
    });
    s.setKeyRecord({ videoId: "m2", key: "8A", sourcePath: stalePath });
    const shelfFile = join(shelfDir, "Contents", "Cached Track.m4a");
    writeFileSync(shelfFile, "audio");
    // Backdate the mtime so the reader's mtime<=analyzed_at freshness check
    // is deterministic (a just-written file can race the analyzed_at stamp).
    const past = new Date(Date.now() - 60_000);
    utimesSync(shelfFile, past, past);

    await adoptFromShelf({
      state: s,
      musicDir: d,
      shelfVolume: shelfDir,
      dryRun: false,
      onProgress: () => {},
    });
    const row2 = s.allTracks().find((t) => t.video_id === "m2");
    const shelfPath = row2?.file_path;
    if (typeof shelfPath !== "string") throw new Error("not repointed");
    // the cached key must follow the file: readable at the NEW path
    expect(s.keyRecord("m2", shelfPath)?.key).toBe("8A");
    // and the old path entry is gone (path is the PK's twin — updated in place)
    expect(s.keyRecord("m2", stalePath)).toBeNull();
    ts.done({ dir: d, state: s });
  });

  test("healthy local rows are never touched; nowhere rows are counted honestly", async () => {
    const { state: s, dir: d } = ts.next();
    s.upsertTrackFromPlaylist("h1", 0, "Healthy Track");
    s.upsertTrackFromPlaylist("g1", 1, "Ghost Track");
    const localPath = join(d, "Healthy Track.m4a");
    writeFileSync(localPath, "audio");
    s.markDownloaded("h1", {
      title: "Healthy Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: localPath,
      fileSizeBytes: 5,
      durationS: null,
    });
    s.markDownloaded("g1", {
      title: "Ghost Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: join(d, "Ghost Track.m4a"),
      fileSizeBytes: 5,
      durationS: null,
    });

    const logs: string[] = [];
    await adoptFromShelf({
      state: s,
      musicDir: d,
      shelfVolume: shelfDir,
      dryRun: false,
      onProgress: (m) => logs.push(m),
    });
    expect(s.allTracks().find((t) => t.video_id === "h1")?.file_path).toBe(
      localPath,
    ); // untouched
    expect(logs.some((m) => m.includes("1 row(s) repointed"))).toBe(false);
    expect(logs.some((m) => m.includes("no shelf copy: Ghost Track.m4a"))).toBe(
      true,
    );
    ts.done({ dir: d, state: s });
  });
});
