import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { applyTags, type EnrichedMetadata } from "./metadata";
import { wavToAiff } from "./commands/wav-to-aiff";

const DIR = `/tmp/megadj-aiff-tags-test-${process.pid}`;
const WAV = `${DIR}/track.wav`;
const AIFF = `${DIR}/track.aiff`;

const META: EnrichedMetadata = {
  title: "Song (Remixer Remix)",
  artist: "Test Artist",
  albumArtist: "Test Artist",
  album: "Test Artist — Test (Remixes)",
  genre: "House",
  date: "2024",
  composer: "Original Artist",
  comment: "https://soundcloud.com/test/song",
  bpm: null,
  grouping: "House",
  remixer: "Remixer",
  mbid: null,
};

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function id3Chunks(path: string): Promise<string[]> {
  const data = new Uint8Array(await Bun.file(path).arrayBuffer());
  const chunks: string[] = [];
  let pos = 12;
  const dec = new TextDecoder("latin1");
  while (pos < data.length - 8) {
    chunks.push(dec.decode(data.slice(pos, pos + 4)));
    const size =
      data[pos + 4]! * 2 ** 24 +
      data[pos + 5]! * 2 ** 16 +
      data[pos + 6]! * 2 ** 8 +
      data[pos + 7]!;
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

describe("AIFF tag pipeline (rekordbox covers)", () => {
  test(
    "wavToAiff + applyTags keeps the ID3 chunk with tags+art intact",
    async () => {
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${WAV}`.quiet();
      // embed art on the WAV first (as ingest's fetchAndEmbedArtwork would)
      const art = `${DIR}/art.jpg`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc=size=64x64:duration=0.1 -frames:v 1 ${art}`.quiet();
      const embed = [
        "from mutagen.wave import WAVE",
        "from mutagen.id3 import ID3, APIC",
        `a = WAVE(${JSON.stringify(WAV)})`,
        "a.add_tags()",
        `a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(art)}, "rb").read()))`,
        "a.save()",
      ].join("\n");
      await $`uv run --with mutagen python -c ${embed}`.quiet();

      const out = await wavToAiff(WAV);
      expect(out).toBe(AIFF);
      expect(await id3Chunks(AIFF)).toContain("ID3 ");

      // applyTags (post-conversion enrichment) must NOT drop the ID3 chunk
      // — ffmpeg would; mutagen edits it in place.
      await applyTags(AIFF, META);
      const chunks = await id3Chunks(AIFF);
      expect(chunks).toContain("ID3 "); // art + tags still there

      const probe =
        await $`ffprobe -v error -show_entries format_tags=title,artist,album,genre,date -of json ${AIFF}`.json();
      const tags = (probe.format as { tags: Record<string, string> }).tags;
      expect(tags.title).toBe("Song (Remixer Remix)");
      expect(tags.artist).toBe("Test Artist");
      expect(tags.album).toContain("Remixes");
      expect(tags.genre).toBe("House");
    },
    { timeout: 60_000 },
  );
});
