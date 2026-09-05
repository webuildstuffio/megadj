import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groundTruth, writePatchSync } from "../src/index-all";

const DIR = `/tmp/fulltags-wsync-test-${process.pid}`;

async function makeFile(ext: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/track${ext}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

describe("writePatchSync", () => {
  test("mp3 round-trip + perf parity with direct ffmpeg", async () => {
    const p = await makeFile(".mp3");
    expect(
      writePatchSync(p, {
        title: "Sync Song",
        artist: "Sync Artist",
        genre: "House",
        year: 2024,
      }),
    ).toBe(true);
    const t = groundTruth(p);
    expect(t.title).toBe("Sync Song");
    expect(t.artist).toBe("Sync Artist");
    expect(t.genre).toBe("House");
    expect(t.year).toBe("2024");
    // Regression guard: the old nested `bun -e` bridge measured
    // 124 ms/write (6.4× the direct path's 19 ms). The sync path must
    // stay well under the bridge cost; 60 ms is generous headroom.
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) writePatchSync(p, { title: `Sync ${i}` });
    const perWrite = (Date.now() - t0) / 5;
    expect(perWrite).toBeLessThan(60);
    rmSync(p);
  });

  test("m4a round-trip", async () => {
    const p = await makeFile(".m4a");
    expect(
      writePatchSync(p, { title: "M4a Sync", artist: "A", year: 2021 }),
    ).toBe(true);
    const t = groundTruth(p);
    expect(t.title).toBe("M4a Sync");
    expect(t.year).toBe("2021");
    rmSync(p);
  });

  test("aiff sync path via mutagen (incl albumArtist/grouping/energy/bpm)", async () => {
    const p = await makeFile(".aiff");
    expect(
      writePatchSync(p, {
        title: "AIFF Sync",
        artist: "B",
        albumArtist: "AA",
        grouping: "Deep House",
        energy: 7,
        bpm: 128,
        year: 2023,
      }),
    ).toBe(true);
    const t = groundTruth(p);
    expect(t.title).toBe("AIFF Sync");
    expect(t.year).toBe("2023");
    rmSync(p);
  });

  test("wav sync path via mutagen", async () => {
    const p = await makeFile(".wav");
    expect(writePatchSync(p, { title: "WAV Sync", genre: "Techno" })).toBe(
      true,
    );
    const t = groundTruth(p);
    expect(t.title).toBe("WAV Sync");
    expect(t.genre).toBe("Techno");
    rmSync(p);
  });

  test("returns false (not throw) on missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-"));
    const p = join(dir, "nope.mp3");
    expect(writePatchSync(p, { title: "x" })).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty patch is a no-op success", async () => {
    const p = await makeFile(".mp3");
    expect(writePatchSync(p, {})).toBe(true);
    rmSync(p);
  });
});
