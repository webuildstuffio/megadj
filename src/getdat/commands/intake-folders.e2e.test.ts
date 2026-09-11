import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../../archive/state";
import { ingest } from "./ingest";

/**
 * Per-batch intake folders (user request, Sep 10 2026): separate dumps must
 * land in SEPARATE dated subfolders of the archive — never mixed flat.
 */

const DB_DIR = mkdtempSync("/tmp/megadj-intake-folders-");
const ARCHIVE = join(DB_DIR, "DJ-Imports");

afterAll(async () => {
  await $`rm -rf ${DB_DIR}`.quiet().nothrow();
});

function makeWav(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=65",
    "-c:a",
    "pcm_s16le",
    "-metadata",
    `title=${name}`,
    p,
  ]);
  return p;
}

function archiveTopLevel(): { dirs: string[]; loose: string[] } {
  const entries = readdirSync(ARCHIVE, { withFileTypes: true });
  return {
    dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name),
    loose: entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name),
  };
}

async function runIngest(sourceFolder: string): Promise<void> {
  const state = new ArchiveState(join(DB_DIR, "archive.db"));
  await ingest({
    state,
    musicDir: ARCHIVE,
    folder: sourceFolder,
    minDuration: 10,
  });
  state.close();
}

describe("ingest lands each dump in its own dated subfolder", () => {
  test("two different source folders → two different archive subfolders", async () => {
    const dumpA = join(DB_DIR, "new dump sept 9");
    const dumpB = join(DB_DIR, "record pool haul");
    makeWav(dumpA, "Track One.wav");
    makeWav(dumpB, "Track Two.wav");

    await runIngest(dumpA);
    await runIngest(dumpB);

    const { dirs, loose } = archiveTopLevel();
    // The dump named for its date gets that date in the folder name.
    expect(dirs).toContain("2026-09-09 new dump");
    // The generic dump gets its own name too.
    expect(dirs.some((d) => d.endsWith("record pool haul"))).toBe(true);
    expect(readdirSync(join(ARCHIVE, "2026-09-09 new dump"))).toContain(
      "Track One.aiff",
    );
    // No loose files at the archive root — that's the whole point.
    expect(loose).toEqual([]);
  }, 240000);

  test("re-ingesting the SAME dump folder reuses its batch subfolder", async () => {
    const dump = join(DB_DIR, "same day dump");
    makeWav(dump, "First Drop.wav");
    await runIngest(dump);
    makeWav(dump, "Second Drop.wav");
    await runIngest(dump);
    // Both files in ONE folder (no "… - 2" sibling for the same dump), and
    // the first dump's folder was untouched by the second run.
    const dated = archiveTopLevel().dirs.filter((d) =>
      /^\d{4}-\d{2}-\d{2} same day dump$/.test(d),
    );
    expect(dated.length).toBe(1);
    expect(readdirSync(join(ARCHIVE, dated[0]!)).toSorted()).toEqual([
      "First Drop.aiff",
      "Second Drop.aiff",
    ]);
  }, 240000);
});
