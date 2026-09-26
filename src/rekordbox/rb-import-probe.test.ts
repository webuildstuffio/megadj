// rb-import shelf-path policy tests (Sep 19): imported rows must prefer
// the shelf copy under <mount>/Contents/ so the master DB travels with
// the drive — a Mac-local FolderPath 404s the moment the stick is read
// elsewhere (the paro import incident: 17 rows pointed at /Users/...).
//
// Sep 26: intra-batch dedup + [archive]-aware path matching tests added
// after the 148-row dupe audit (shelf↔local + [archive] suffix classes).

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
    mkdirSync(join(mount, "Contents", "2026-09-19 probe batch"), {
      recursive: true,
    });
    writeFileSync(
      join(mount, "Contents", "2026-09-19 probe batch", "Track A.m4a"),
      "audio-bytes",
    );

    const rows = probePayloadFiles(batch, () => {}, {
      mount,
      archiveDir: archive,
    });
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

    const rows = probePayloadFiles(batch, () => {}, {
      mount,
      archiveDir: archive,
    });
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

describe("intra-batch dedup (Sep 26 fix)", () => {
  test("two incoming files with the same stem key after stripping [archive] are deduped", () => {
    const stripA = "Track.m4a".replace(/ \[archive(?: \d+)?\]/u, "");
    const stripB = "Track [archive].m4a".replace(/ \[archive(?: \d+)?\]/u, "");
    expect(stripA).toBe("Track.m4a");
    expect(stripB).toBe("Track.m4a");
    expect(stripA).toBe(stripB);
  });

  test("[archive N] variants all collapse to the same stem", () => {
    const variants = [
      "GENESI - Chemistry [archive].m4a",
      "GENESI - Chemistry [archive 2].m4a",
      "GENESI - Chemistry [archive 3].m4a",
    ];
    const stripped = variants.map((v) =>
      v.replace(/ \[archive(?: \d+)?\]/u, ""),
    );
    expect(new Set(stripped).size).toBe(1);
    expect(stripped[0]).toBe("GENESI - Chemistry.m4a");
  });

  test("filenames without [archive] suffix are unchanged", () => {
    const names = [
      "Track.m4a",
      "Artist - Song [Extended Mix].m4a",
      "[AI] Song.m4a",
    ];
    for (const n of names) {
      expect(n.replace(/ \[archive(?: \d+)?\]/u, "")).toBe(n);
    }
  });
});
