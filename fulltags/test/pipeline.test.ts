import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { enrichTrack } from "../src/pipeline";

const DIR = `/tmp/fulltags-pipeline-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

describe("enrichTrack (offline stages)", () => {
  test(
    "energy stage writes TXXX/TBPM and reports completeness gaps",
    async () => {
      const p = `${DIR}/track.mp3`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
      // Only local stages: energy. No network (no genre/art/tags/year).
      const res = await enrichTrack(
        { path: p },
        { only: ["energy"], artworkQueue: null },
      );
      expect(res.notes.some((n) => n.startsWith("energy:"))).toBe(true);
      // No metadata was filled — must be reported missing.
      expect(res.complete).toBe(false);
      expect(res.missing).toContain("artist");
      expect(res.missing).toContain("genre");
    },
    { timeout: 60_000 },
  );

  test(
    "dry-run writes nothing",
    async () => {
      const p = `${DIR}/dry.aiff`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
      const before = await Bun.file(p).stat();
      const res = await enrichTrack(
        { path: p },
        { only: ["energy"], dryRun: true, artworkQueue: null },
      );
      const after = await Bun.file(p).stat();
      expect(res.notes.length).toBe(0);
      expect(after!.size).toBe(before!.size);
    },
    { timeout: 60_000 },
  );

  test("idempotent: second pass changes nothing", async () => {
    const p = `${DIR}/idem.mp3`;
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
    const first = await enrichTrack({ path: p }, { only: ["energy"], artworkQueue: null });
    const second = await enrichTrack({ path: p }, { only: ["energy"], artworkQueue: null });
    expect(first.notes.length).toBeGreaterThan(0);
    expect(second.notes.length).toBe(0);
  });
});
