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

describe("writePatch on freshly wav-converted AIFF (empty ID3 chunk trap)", () => {
  test(
    "tags a fresh ffmpeg AIFF whose ID3 chunk exists but is empty — " +
      "ffmpeg's aiff muxer emits an empty ID3 chunk; mutagen's _IFFID3 " +
      "is FALSY when frameless, so the old `if not a.tags: a.add_tags( + ` " +
      "called add_tags() on an EXISTING chunk and mutagen threw " +
      "`)an ID3 tag already exists` — every wav→aiff ingest failed at " +
      "first tag write (Sep 10 2026 fix: test `a.tags is None`).",
    async () => {
      await $`mkdir -p ${DIR}`.quiet();
      // Fresh ffmpeg AIFF with zero tags — the exact state wavToAiff
      // hands to the tag writer (frameless-but-present ID3 chunk).
      const aiff = `${DIR}/fresh.aiff`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${aiff}`.quiet();
      // The ingest-shaped patch on the fresh AIFF — this threw before.
      await writePatch(aiff, {
        title: "Offshore (Jerome Robins 2026 Remix)",
        artist: "Chicane",
        albumArtist: "Chicane",
        album: "Chicane — Offshore (Remixes)",
        genre: "Trance",
        year: 2026,
        grouping: "Trance",
        remixer: "Jerome Robins",
        mbid: "5f1a2b3c-1234-5678-9abc-def012345678",
      });
      const t = groundTruth(aiff);
      expect(t.title).toBe("Offshore (Jerome Robins 2026 Remix)");
      expect(t.artist).toBe("Chicane");
      expect(t.year).toBe("2026");
    },
    { timeout: 60_000 },
  );
});

describe("wavToAiff output validity", () => {
  test(
    "24-bit LE WAV converts to an ffprobe-VALID AIFF (malformed AIFC-COMM " +
      "regression) — `-c:a copy` of LE PCM made ffmpeg's aiff muxer emit " +
      "a 24-byte AIFC-style COMM inside a FORM declared `AIFF`; ffprobe " +
      "(and booth hardware) reject it. The fix re-maps to big-endian.",
    async () => {
      await $`mkdir -p ${DIR}`.quiet();
      const wav = `${DIR}/hi24.wav`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 -c:a pcm_s24le -metadata title=Original ${wav}`.quiet();
      const { wavToAiff } = await import("../src/index-all");
      const aiff = await wavToAiff(wav);
      expect(aiff).not.toBeNull();
      // The output MUST parse as valid audio — ffprobe is the gate.
      const pr =
        await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${aiff}`
          .quiet()
          .nothrow();
      expect(pr.exitCode).toBe(0);
      expect(pr.stdout.toString().trim()).toBeTruthy();
      // Big-endian PCM (spec AIFF), right bit depth.
      const codec =
        await $`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 ${aiff}`
          .quiet()
          .nothrow();
      expect(codec.stdout.toString().trim()).toBe("pcm_s24be");
    },
    { timeout: 60_000 },
  );
});
