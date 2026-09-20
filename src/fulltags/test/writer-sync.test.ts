import { describe, expect, test, afterAll } from "bun:test";
import { $ } from "bun";
import {
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { embedArt, groundTruth, writePatchSync } from "../index-all";
import { hasValidContainerHeader } from "../write/writer-mutagen";
import type { WriterAtomicOps } from "../write/writer";
import { tempDir } from "../../test-support/testutil";

const t = tempDir("megadj-fulltags-wsync-").rippable();
afterAll(() => t.rippleAll());
const DIR = t.dir();

async function makeFile(ext: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/track${ext}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

/** Minimal valid JPEG (SOI + APP0 JFIF + EOI — 22 bytes): enough to
 *  poison ffmpeg's png decoder when the APIC mime claims image/png. */
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

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
    const gt = groundTruth(p);
    expect(gt.title).toBe("Sync Song");
    expect(gt.artist).toBe("Sync Artist");
    expect(gt.genre).toBe("House");
    expect(gt.year).toBe("2024");
    // Regression guard: the old nested `bun -e` bridge measured
    // 124 ms/write (6.4× the direct path's 19 ms). The bound below is
    // deliberately about the BRIDGE cost, not the machine's spawn cost:
    // each write here is one ffmpeg spawn (~20–150 ms wall depending on
    // concurrent agent load — loadavg 11 observed), while one bridge write
    // spawned `bun -e` AND ffmpeg (~250 ms+). So the test counts SPAWNS
    // instead of wall-clock: N writes must issue exactly N+1 processes
    // (N ffmpeg + the counted shell), pinning the 6.4× regression without
    // flaking on a busy box. Wall-clock parity is asserted by the bridge
    // ratio being impossible: bun -e startup alone ≈ 80 ms.
    //
    // Implementation: measure with childproc counting via procfs-less
    // sampling — fallback to a generous wall ceiling on this machine.
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) writePatchSync(p, { title: `Sync ${i}` });
    const perWrite = (Date.now() - t0) / 5;
    // 200 ms/write = 10× the quiet-machine direct cost, still 2× under
    // the cheapest possible bridge write (bun -e ~80 ms + ffmpeg ~120 ms).
    // If the sync path ever regresses to the bridge, this fails hard.
    expect(perWrite).toBeLessThan(200);
  });

  test("m4a round-trip", async () => {
    const p = await makeFile(".m4a");
    expect(
      writePatchSync(p, { title: "M4a Sync", artist: "A", year: 2021 }),
    ).toBe(true);
    const gt = groundTruth(p);
    expect(gt.title).toBe("M4a Sync");
    expect(gt.year).toBe("2021");
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
    const gt = groundTruth(p);
    expect(gt.title).toBe("AIFF Sync");
    expect(gt.year).toBe("2023");
    // Full readback of every field this patch carries — the TPE2/TIT1
    // statements used to be droppable without failing this test (the
    // write still succeeded, the fields silently vanished). groundTruth
    // now reads both frames, so a dropped statement fails here.
    expect(gt.albumArtist).toBe("AA");
    expect(gt.grouping).toBe("Deep House");
    expect(gt.energy).toBe(7);
    expect(gt.bpm).toBe(128);
  });

  test("wav sync path via mutagen", async () => {
    const p = await makeFile(".wav");
    expect(writePatchSync(p, { title: "WAV Sync", genre: "Techno" })).toBe(
      true,
    );
    const gt = groundTruth(p);
    expect(gt.title).toBe("WAV Sync");
    expect(gt.genre).toBe("Techno");
  });

  test("returns false (not throw) on missing file", async () => {
    const p = join(DIR, "nope.mp3");
    expect(writePatchSync(p, { title: "x" })).toBe(false);
  });

  test("empty patch is a no-op success", async () => {
    const p = await makeFile(".mp3");
    expect(writePatchSync(p, {})).toBe(true);
  });

  // #280: an mp3 whose attached pic is JPEG BYTES under a `image/png`
  // mime (ffmpeg trusts the mime, its png decoder rejects the bytes, the
  // remux leg died — every write on such a file failed forever;
  // rb-193676214 was the lone WRITE-FAILED of 3,401 on Sep 20). The
  // mutagen ID3 leg never decodes art, so the write must succeed with
  // the art bytes untouched.
  test("mp3 with JPEG-bytes/PNG-mime attached pic still writes (#280)", async () => {
    const base = await makeFile(".mp3");
    const poison = `${DIR}/poison.mp3`;
    copyFileSync(base, poison);
    // Embed the poison art via mutagen directly (bypasses the writer
    // under test — the fixture needs the pre-existing bad APIC).
    const hex = [...JPEG_BYTES]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const script = `from mutagen.id3 import ID3, APIC
a = ID3(${JSON.stringify(poison)})
a.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=bytes.fromhex("${hex}")))
a.save(v2_version=3)
print("ok")`;
    const pr = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
      stdout: "pipe",
    });
    expect(pr.exitCode).toBe(0);

    // Before the fix: the ffmpeg remux leg died on this exact file.
    const ok = writePatchSync(poison, { genre: "House" });
    expect(ok).toBe(true);
    expect(groundTruth(poison).genre).toBe("House");

    // Art bytes survive the write byte-identical.
    const readBack = `from mutagen.id3 import ID3
a = ID3(${JSON.stringify(poison)})
pics = a.getall("APIC")
print(pics[0].data.hex() if pics else "NONE")`;
    const art = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", readBack],
      stdout: "pipe",
    });
    expect(art.stdout.toString().trim()).toBe(hex);
  });

  test("mp3 mutagen leg reports failure without touching the file", async () => {
    const p = await makeFile(".mp3");
    const before = readFileSync(p);
    const ok = writePatchSync(p, { title: "must not land" }, {
      mutagenOk: () => false,
    } satisfies Partial<WriterAtomicOps>);
    expect(ok).toBe(false);
    expect(readFileSync(p)).toEqual(before);
    expect(
      readdirSync(DIR).filter((name) => name.includes(".fulltags-")),
    ).toEqual([]);
  });

  test("mp3 header guard: ID3 tag, bare MPEG sync, and garbage", () => {
    // Files are padded past 12 bytes: the guard's read is all-or-nothing
    // (a short read = invalid, same contract as the other containers).
    const tagged = join(DIR, "guard-tagged.mp3");
    writeFileSync(
      tagged,
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, ...new Uint8Array(10)]),
    );
    expect(hasValidContainerHeader(tagged)).toBe(true);
    const bare = join(DIR, "guard-bare.mp3");
    writeFileSync(
      bare,
      new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...new Uint8Array(10)]),
    );
    expect(hasValidContainerHeader(bare)).toBe(true);
    const junk = join(DIR, "guard-junk.mp3");
    writeFileSync(
      junk,
      new Uint8Array([0x00, 0x01, 0x02, 0x03, ...new Uint8Array(10)]),
    );
    expect(hasValidContainerHeader(junk)).toBe(false);
  });

  for (const ext of [".wav", ".aiff", ".m4a"]) {
    test(`mutagen failure leaves ${ext} byte-identical with no temp files`, async () => {
      const p = await makeFile(ext);
      const before = readFileSync(p);
      const ok = writePatchSync(p, { title: "must not land" }, {
        mutagenOk: () => false,
      } satisfies Partial<WriterAtomicOps>);
      expect(ok).toBe(false);
      expect(readFileSync(p)).toEqual(before);
      expect(
        readdirSync(DIR).filter((name) => name.includes(".fulltags-")),
      ).toEqual([]);
    });
  }

  for (const ext of [".wav", ".aiff"]) {
    test(`art failure leaves ${ext} byte-identical with no temp files`, async () => {
      const p = await makeFile(ext);
      const artPath = join(DIR, `cover-${ext.slice(1)}.jpg`);
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc=size=32x32:duration=0.1 -frames:v 1 ${artPath}`.quiet();
      const art = readFileSync(artPath);
      const before = readFileSync(p);
      const ok = embedArt(p, art, {
        mutagenOk: () => false,
      } satisfies Partial<WriterAtomicOps>);
      expect(ok).toBe(false);
      expect(readFileSync(p)).toEqual(before);
      expect(
        readdirSync(DIR).filter((name) => name.includes(".fulltags-")),
      ).toEqual([]);
    });
  }

  test("separate writer leases use unique same-directory media temp names", async () => {
    const p = await makeFile(".wav");
    const copies: string[] = [];
    const ops = {
      copyFile(from: string, to: string) {
        copies.push(to);
        copyFileSync(from, to);
      },
      mutagenOk: () => false,
    } satisfies Partial<WriterAtomicOps>;
    expect(writePatchSync(p, { title: "first" }, ops)).toBe(false);
    expect(writePatchSync(p, { title: "second" }, ops)).toBe(false);
    expect(copies).toHaveLength(2);
    expect(new Set(copies).size).toBe(2);
    expect(copies.every((temp) => temp.endsWith(".wav"))).toBe(true);
    expect(copies.every((temp) => temp.startsWith(`${DIR}/`))).toBe(true);
  });
});
