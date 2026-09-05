import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { writePatch, embedArt, groundTruth } from "../src/index-all";

const DIR = `/tmp/fulltags-writer-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(ext: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/track${ext}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

describe("writePatch round-trips (mp3, m4a, aiff)", () => {
  for (const ext of [".mp3", ".m4a", ".aiff"]) {
    test(
      `writes full tag set into ${ext} and reads back`,
      async () => {
        const p = await makeFile(ext);
        await writePatch(p, {
          title: "Song (Flozone Remix)",
          artist: "Test Artist",
          albumArtist: "Album Artist",
          album: "Test Album",
          genre: "House",
          year: 2024,
          composer: "Producer X",
          grouping: "House",
          remixer: "Flozone Remix",
          comment: "https://soundcloud.com/test/song",
          energy: 7,
        });
        const t = groundTruth(p);
        expect(t.title).toBe("Song (Flozone Remix)");
        expect(t.artist).toBe("Test Artist");
        expect(t.album).toBe("Test Album");
        expect(t.genre).toBe("House");
        expect(t.year).toBe("2024");
        expect(t.comment).toContain("soundcloud.com");
      },
      { timeout: 60_000 },
    );
  }
});

describe("embedArt", () => {
  test(
    "embeds a jpeg cover on m4a and groundTruth sees it",
    async () => {
      const p = await makeFile(".m4a");
      const art = `${DIR}/art.jpg`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc=size=64x64:duration=0.1 -frames:v 1 ${art}`.quiet();
      const bytes = new Uint8Array(await Bun.file(art).arrayBuffer());
      expect(embedArt(p, bytes)).toBe(true);
      expect(groundTruth(p).art).toBe(true);
    },
    { timeout: 60_000 },
  );
});
