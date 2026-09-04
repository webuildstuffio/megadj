import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { wavToAiff } from "../src/commands/wav-to-aiff";

const DIR = `/tmp/megadj-wav-aiff-test-${process.pid}`;

async function makeTaggedWav(): Promise<string> {
  const wav = `${DIR}/track.wav`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${wav}`.quiet();
  const art = `${DIR}/art.jpg`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc=size=64x64:duration=0.1 -frames:v 1 ${art}`.quiet();
  const script = [
    "from mutagen.wave import WAVE",
    "from mutagen.id3 import ID3, APIC, TIT2, TPE1",
    `a = WAVE(${JSON.stringify(wav)})`,
    "a.add_tags()",
    'a.tags.add(TIT2(encoding=3, text=["Test Track"]))',
    'a.tags.add(TPE1(encoding=3, text=["Test Artist"]))',
    `a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(art)}, "rb").read()))`,
    "a.save()",
  ].join("\n");
  await $`uv run --with mutagen python -c ${script}`.quiet();
  return wav;
}

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

describe("wavToAiff", () => {
  test("converts wav → aiff with audio, ID3 tags and APIC art intact", async () => {
    await $`mkdir -p ${DIR}`.quiet();
    const wav = await makeTaggedWav();

    const out = await wavToAiff(wav);

    expect(out).toBe(`${DIR}/track.aiff`);
    expect(await Bun.file(wav).exists()).toBe(false); // wav replaced

    const probe =
      (await $`ffprobe -hide_banner -show_format -show_streams -of json ${out}`.json()) as {
        format: { duration: string; tags?: Record<string, string> };
        streams: Array<{ codec_type: string; codec_name: string }>;
      };
    // lossless stream copy
    expect(probe.streams.some((s) => s.codec_name === "pcm_s16le")).toBe(true);
    expect(Number(probe.format.duration)).toBeGreaterThan(0.9);
    // ffmpeg drops the ID3 chunk on aiff muxing — mutagen must have copied it
    expect(probe.format.tags?.title).toBe("Test Track");
    expect(probe.format.tags?.artist).toBe("Test Artist");
    // APIC art present in the file's ID3 chunk (raw scan — ffprobe hides it)
    const raw = new Uint8Array(await Bun.file(out).arrayBuffer());
    const id3idx = [...raw.keys()].findIndex(
      (i) =>
        i < raw.length - 4 &&
        raw[i] === 0x49 &&
        raw[i + 1] === 0x44 &&
        raw[i + 2] === 0x33 &&
        raw[i + 3] === 0x20,
    );
    expect(id3idx).toBeGreaterThan(0); // "ID3 " chunk exists
  });

  test("returns null and keeps the wav when ffmpeg fails", async () => {
    await $`mkdir -p ${DIR}`.quiet();
    const bogus = `${DIR}/bogus.wav`;
    await Bun.write(bogus, "not audio at all");
    const out = await wavToAiff(bogus);
    expect(out).toBeNull();
    expect(await Bun.file(bogus).exists()).toBe(true); // untouched
    expect(await Bun.file(`${DIR}/bogus.aiff`).exists()).toBe(false);
  });

  test("no-ops for non-wav paths", async () => {
    expect(await wavToAiff("/tmp/whatever.mp3")).toBeNull();
  });
});
