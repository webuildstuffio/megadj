// rb-import shelf-path policy tests (Sep 19): imported rows must prefer
// the shelf copy under <mount>/Contents/ so the master DB travels with
// the drive — a Mac-local FolderPath 404s the moment the stick is read
// elsewhere (the paro import incident: 17 rows pointed at /Users/...).
//
// Sep 26: intra-batch dedup + dupe-suffix-aware path matching tests added
// after the 148-row dupe audit (shelf↔local + [archive] + [BACKUP2] classes).

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probePayloadFiles } from "./rb-import-probe";
import { tempDir } from "../test-support/testutil";

const t = tempDir("megadj-rb-import-shelf-path-").rippable();

describe("rb-import shelf-path preference", () => {
  test("a file with a shelf twin under Contents/ imports with the shelf path", () => {
    // Layout: <archive>/<batch>/Track.m4a locally, mirrored on the mount.
    const archive = t.dir();
    const batch = join(archive, "2026-09-19 probe batch");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Track A.m4a"), "audio-bytes");
    const mount = t.dir();
    mkdirSync(join(mount, "Contents", "2026-09-19 probe batch"), { recursive: true });
    writeFileSync(join(mount, "Contents", "2026-09-19 probe batch", "Track A.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {}, { mount, archiveDir: archive });
    expect(rows.length).toBe(1);
    expect(String(rows[0]?.[0])).toBe(
      join(mount, "Contents", "2026-09-19 probe batch", "Track A.m4a"),
    );
  });

  test("a file without a shelf twin keeps its local path", () => {
    const archive = t.dir();
    const batch = join(archive, "2026-09-19 probe batch 2");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Track B.m4a"), "audio-bytes");
    const mount = t.dir();
    mkdirSync(join(mount, "Contents"), { recursive: true });

    const rows = probePayloadFiles(batch, () => {}, { mount, archiveDir: archive });
    expect(rows.length).toBe(1);
    expect(String(rows[0]?.[0])).toBe(join(batch, "Track B.m4a"));
  });

  test("without shelf context the local path is kept (legacy callers)", () => {
    const archive = t.dir();
    const batch = join(archive, "2026-09-19 probe batch 3");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Track C.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {});
    expect(rows.length).toBe(1);
    expect(String(rows[0]?.[0])).toBe(join(batch, "Track C.m4a"));
  });
});

/** Mirror of the production stripDupeSuffix for test assertions. */
function stripDupeSuffix(name: string): string {
  return name.replace(/ \[archive(?: \d+)?\]/u, "").replace(/ \[BACKUP2\]/u, "");
}

describe("intra-batch dedup (Sep 26 fix)", () => {
  test("[archive] variants collapse to the same stem", () => {
    expect(stripDupeSuffix("Track.m4a")).toBe("Track.m4a");
    expect(stripDupeSuffix("Track [archive].m4a")).toBe("Track.m4a");
    expect(stripDupeSuffix("Track [archive 2].m4a")).toBe("Track.m4a");
    expect(stripDupeSuffix("Track [archive 3].m4a")).toBe("Track.m4a");
  });

  test("[BACKUP2] variants collapse to the same stem", () => {
    expect(stripDupeSuffix("milkshake (davis edit) [BACKUP2].mp3")).toBe(
      "milkshake (davis edit).mp3",
    );
    expect(stripDupeSuffix("slashy disco - the bomb (edit) [BACKUP2].mp3")).toBe(
      "slashy disco - the bomb (edit).mp3",
    );
  });

  test("filenames without dupe suffixes are unchanged", () => {
    const names = ["Track.m4a", "Artist - Song [Extended Mix].m4a", "[AI] Song.m4a"];
    for (const n of names) {
      expect(stripDupeSuffix(n)).toBe(n);
    }
  });
});

describe("filename stem parsing (#321 title contamination)", () => {
  test("yt-dlp 'Artist - Track.ext' splits into artist + clean title", () => {
    const archive = t.dir();
    const batch = join(archive, "batch-parse");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Skrillex - Bangarang.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {});
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe("Bangarang"); // title
    expect(rows[0]?.[3]).toBe("Skrillex"); // artist
  });

  test("archive convention 'Artist · Album · Title.ext' parses correctly", () => {
    const archive = t.dir();
    const batch = join(archive, "batch-dot");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Mau P · Doing It Right · TESLA.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {});
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe("TESLA"); // title
    expect(rows[0]?.[3]).toBe("Mau P"); // artist
  });

  test("plain 'Track Name.ext' gets null artist (not the stem as artist)", () => {
    const archive = t.dir();
    const batch = join(archive, "batch-plain");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "My Great Song.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {});
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe("My Great Song"); // title
    expect(rows[0]?.[3]).toBeNull(); // artist — NOT the stem
  });

  test("multiple dashes: only first split separates artist from title", () => {
    const archive = t.dir();
    const batch = join(archive, "batch-multi-dash");
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, "Miss Monique - Melodic Techno Mix - Session 5.m4a"), "audio-bytes");

    const rows = probePayloadFiles(batch, () => {});
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe("Melodic Techno Mix - Session 5"); // title
    expect(rows[0]?.[3]).toBe("Miss Monique"); // artist
  });
});
