import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../test-support/testutil";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../archive/state";
import {
  findCaseCollisions,
  intakeStatus,
  pathKey,
  walkAudioFiles,
} from "./intake-status";

const t = tempDir("megadj-intake-status-").rippable();
afterAll(() => t.rippleAll());

describe("pathKey (#238)", () => {
  test("NFC and NFD spellings of the same name collide to one key", () => {
    const nfc = "Caf\u00e9 Set.wav".normalize("NFC");
    const nfd = "Caf\u00e9 Set.wav".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(pathKey(nfc)).toBe(pathKey(nfd));
  });

  test("case differences fold away", () => {
    expect(pathKey("Track A.WAV")).toBe(pathKey("track a.wav"));
  });
});

describe("findCaseCollisions", () => {
  test("case-variant twins group under one key; singletons never appear", () => {
    const collisions = findCaseCollisions([
      "/m/House/Track A.wav",
      "/m/House/track a.wav",
      "/m/House/Other.wav",
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.paths).toHaveLength(2);
  });
});

describe("walkAudioFiles", () => {
  test("finds audio at depth, skips non-audio, absent dir = empty", () => {
    const dir = t.dir();
    mkdirSync(join(dir, "2026-09-18 intake"), { recursive: true });
    writeFileSync(join(dir, "root.mp3"), "x");
    writeFileSync(join(dir, "2026-09-18 intake", "deep.aiff"), "x");
    writeFileSync(join(dir, "cover.jpg"), "x");
    const files = walkAudioFiles(dir);
    expect(files).toHaveLength(2);
    expect(walkAudioFiles(join(dir, "nope"))).toEqual([]);
  });
});

describe("intakeStatus", () => {
  test("reconciled tree reads clean (exit-0 shape)", () => {
    const dir = t.dir();
    const dbPath = join(t.dir(), "state.db");
    const state = new ArchiveState(dbPath);
    writeFileSync(join(dir, "t1.m4a"), "abc");
    state.upsertTrackFromPlaylist("v1", 1, "T1");
    state.markDownloaded("v1", {
      title: "T1",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: join(dir, "t1.m4a"),
      fileSizeBytes: 3,
      durationS: null,
    });
    const r = intakeStatus({
      state,
      musicDir: dir,
      json: true,
      log: () => {},
    });
    expect(r.rowsMissingOnDisk).toBe(0);
    expect(r.filesWithoutDbRow).toBe(0);
    expect(r.caseCollisions).toEqual([]);
    state.close();
  });

  test("a row whose file vanished lands in missing-on-disk; an unrowed file lands in filesWithoutDbRow", () => {
    const dir = t.dir();
    const dbPath = join(t.dir(), "state.db");
    const state = new ArchiveState(dbPath);
    writeFileSync(join(dir, "present.m4a"), "abc");
    state.upsertTrackFromPlaylist("v1", 1, "gone");
    state.markDownloaded("v1", {
      title: "gone",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: join(dir, "gone.m4a"),
      fileSizeBytes: null,
      durationS: null,
    });
    state.upsertTrackFromPlaylist("v2", 2, "present");
    state.markDownloaded("v2", {
      title: "present",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: join(dir, "present.m4a"),
      fileSizeBytes: 3,
      durationS: null,
    });
    const r = intakeStatus({
      state,
      musicDir: dir,
      json: false,
      log: () => {},
    });
    expect(r.rowsMissingOnDisk).toBe(1);
    expect(r.mismatches[0]!.videoId).toBe("v1");
    expect(r.filesWithoutDbRow).toBe(0);
    state.close();
  });

  test("THE F5 INVARIANT: a db row stored with case-variant casing claims its file", () => {
    const dir = t.dir();
    const dbPath = join(t.dir(), "state.db");
    const state = new ArchiveState(dbPath);
    writeFileSync(join(dir, "Track A.WAV"), "abc");
    state.upsertTrackFromPlaylist("v1", 1, "A");
    state.markDownloaded("v1", {
      title: "A",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      // the row disagrees with the disk only by case — the old
      // raw-string compare read this as a stray file + missing row
      // and the unreferenced-strays sweep ATE the file (postmortem F5)
      filePath: join(dir, "track a.wav"),
      fileSizeBytes: 3,
      durationS: null,
    });
    const r = intakeStatus({
      state,
      musicDir: dir,
      json: true,
      log: () => {},
    });
    expect(r.rowsMissingOnDisk).toBe(0);
    expect(r.filesWithoutDbRow).toBe(0);
    state.close();
  });

  test("a TRUE case-variant twin (two DB ROWS claiming one key) reports as a collision", () => {
    const dir = t.dir();
    const dbPath = join(t.dir(), "state.db");
    const state = new ArchiveState(dbPath);
    // one file on disk, TWO rows whose stored paths fold to the same
    // key but differ as strings — exactly the divergent-ledger shape
    // the census must surface (a same-dir case-variant file pair is
    // impossible on APFS; the corruptable ledger is the db side)
    writeFileSync(join(dir, "Track A.wav"), "1");
    state.upsertTrackFromPlaylist("v1", 1, "A");
    state.markDownloaded("v1", {
      title: "A",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: join(dir, "Track A.wav"),
      fileSizeBytes: 1,
      durationS: null,
    });
    state.upsertTrackFromPlaylist("v2", 2, "A2");
    state.markDownloaded("v2", {
      title: "A2",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: null,
      codec: null,
      filePath: join(dir, "track A.wav"),
      fileSizeBytes: 1,
      durationS: null,
    });
    const r = intakeStatus({
      state,
      musicDir: dir,
      json: true,
      log: () => {},
    });
    expect(r.caseCollisions).toHaveLength(1);
    expect(r.caseCollisions[0]!.paths).toHaveLength(2);
    state.close();
  });

  test("master leg without a drive degrades honestly (available: false, never zero-truth)", () => {
    const dir = t.dir();
    const dbPath = join(t.dir(), "state.db");
    const state = new ArchiveState(dbPath);
    const r = intakeStatus({
      state,
      musicDir: dir,
      driveMount: "/Volumes/DOES-NOT-EXIST",
      json: true,
      log: () => {},
    });
    expect(r.masterDb.available).toBe(false);
    expect(r.masterDb.note).toContain("no master.db found");
    state.close();
  });
});
