import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupeWithinFolderForTest } from "./ingest";

/**
 * Regression for the Play Hard trap (Sep 10 2026): pools ship mp3+wav
 * pairs with IDENTICAL stems. The wav→aiff conversion at ingest changes
 * the container, and lossy-vs-lossless fingerprints differ slightly, so
 * neither identity, MD5, nor acoustic-fp matching caught the pair — both
 * copies landed in the archive.
 *
 * Contract: within one intake folder, a same-stem mp3 next to a same-stem
 * lossless file is a dupe — the lossless side wins regardless of nominal
 * bitrate, and the mp3 quarantines.
 *
 * The fixtures are REAL tiny audio files (ffmpeg-generated silence, the
 * same pattern ingest.e2e uses) — probeFile must return ok:true for the
 * dedupe passes to see them.
 */

async function makeSilent(
  dir: string,
  name: string,
  codec: "wav" | "mp3",
  duration = 0.4,
): Promise<string> {
  const p = join(dir, name);
  const { $ } = await import("bun");
  if (codec === "wav") {
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i anullsrc=r=44100:cl=stereo -t ${duration} -c:a pcm_s16le ${p}`
      .quiet()
      .nothrow();
  } else {
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i anullsrc=r=44100:cl=stereo -t ${duration} -c:a libmp3lame -b:a 128k ${p}`
      .quiet()
      .nothrow();
  }
  return p;
}

describe("same-stem mp3+lossless pair dedupe", () => {
  test("mp3 twin of a same-stem wav quarantines; lossless survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-pair-test-"));
    try {
      await makeSilent(dir, "Play Hard (Remix).wav", "wav");
      await makeSilent(dir, "Play Hard (Remix).mp3", "mp3");
      const q = join(dir, ".ingest-duplicates");
      const { survivors, dupes } = await dedupeWithinFolderForTest(
        dir,
        q,
        false,
        () => {},
      );
      expect(dupes).toBe(1);
      expect(survivors.map((s) => s.file.split("/").pop())).toEqual([
        "Play Hard (Remix).wav",
      ]);
      expect(existsSync(join(dir, "Play Hard (Remix).mp3"))).toBe(false);
      expect(existsSync(join(q, "Play Hard (Remix).mp3"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("same-stem lossless vs lossless also collapses (identity pass), mp3 never preferred", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-pair-test2-"));
    try {
      // different durations → different bytes (md5 pass must not fire)
      await makeSilent(dir, "Track One.wav", "wav", 0.4);
      await makeSilent(dir, "Track One.aiff", "wav", 0.9);
      const q = join(dir, ".ingest-duplicates");
      const { survivors, dupes } = await dedupeWithinFolderForTest(
        dir,
        q,
        false,
        () => {},
      );
      // two lossless same-stem files collapse in the identity pass
      // (same normalized title) — exactly ONE survives either way
      expect(survivors.length).toBe(1);
      expect(dupes).toBe(1);
      // the invariant that matters: whatever survives is lossless
      expect(/\.(wav|aiff?|flac)$/i.test(survivors[0]!.file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
