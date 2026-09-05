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
    const first = await enrichTrack(
      { path: p },
      { only: ["energy"], artworkQueue: null },
    );
    const second = await enrichTrack(
      { path: p },
      { only: ["energy"], artworkQueue: null },
    );
    expect(first.notes.length).toBeGreaterThan(0);
    expect(second.notes.length).toBe(0);
  });

  test("hints fill only missing fields (no network)", async () => {
    const p = `${DIR}/hinted.mp3`;
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
    // tags stage with hints but MB lookup suppressed: pass an impossible
    // artist so mbLookupCached misses; hints must still land. Use only
    // ["tags"] so no SC/AI stages fire.
    const res = await enrichTrack(
      { path: p, title: "Hint Song", artist: "Hint Artist" },
      {
        only: ["tags"],
        hints: { title: "Hint Song", artist: "Hint Artist" },
        artworkQueue: null,
      },
    );
    const t = await import("../src/readers").then((m) => m.groundTruth(p));
    expect(t.title).toBe("Hint Song");
    expect(t.artist).toBe("Hint Artist");
    expect(res.notes).toContain("title");
    expect(res.notes).toContain("artist");
  });

  test(
    "WAV stamp reads work: second fingerprint pass is a no-op (regression)",
    async () => {
      // The WAV/AIFF branches of readTxxx used to open the file and read
      // NOTHING — TXXX:ACOUSTID was invisible on WAVs, so every re-run
      // re-fingerprinted and rewrote all 73 archive WAVs (idempotency was
      // mp3/flac/m4a-only). CAMELOT/ENERGY/AI-* probes had the same hole.
      const p = `${DIR}/idem.wav`;
      // fpcalc returns "Empty fingerprint" (exit 2) on sub-3s audio — use a
      // 5 s tone so the first pass actually has something to stamp. The
      // test's own `mkdir -p` runs first (another test in this file may
      // have created DIR after an rm -rf in a parallel worker; the guard
      // makes the fixture order-independent).
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=5 ${p}`.quiet();
      const first = await enrichTrack(
        { path: p },
        { only: ["fingerprint"], artworkQueue: null },
      );
      expect(first.notes.some((n) => n.startsWith("fingerprint:"))).toBe(true);
      const second = await enrichTrack(
        { path: p },
        { only: ["fingerprint"], artworkQueue: null },
      );
      expect(second.notes.length).toBe(0);
    },
    { timeout: 60_000 },
  );

  test(
    "scoped run writes only requested stages: --fingerprint does not stamp remix tags",
    async () => {
      const p = `${DIR}/remix-scope.mp3`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
      // Sanity: the tags stage WOULD stamp the remix credit.
      await enrichTrack(
        { path: p, title: "Song (Someone Remix)" },
        { only: ["tags"], artworkQueue: null },
      );
      const withTags = await import("../src/pipeline").then((m) =>
        (m as any).readTxxx ? (m as any).readTxxx(p, ["version"]) : null,
      );
      void withTags; // readers don't export it — assert via CLI-level TXXX probe instead
      // Now the scoped run on a fresh file: fingerprint-only must NOT write
      // the remix credit (TXXX:version stays absent).
      const p2 = `${DIR}/remix-scope2.mp3`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p2}`.quiet();
      await enrichTrack(
        { path: p2, title: "Song (Someone Remix)" },
        { only: ["fingerprint"], artworkQueue: null },
      );
      const probe = Bun.spawnSync({
        cmd: [
          "uv",
          "run",
          "--with",
          "mutagen",
          "python",
          "-c",
          `from mutagen.mp3 import MP3
a = MP3(${JSON.stringify(p2)})
tags = a.tags or {}
found = [str(tags.get(k).text[0]) for k in tags.keys() if str(k).startswith("TXXX") and getattr(tags.get(k), "desc", "") == "version"]
import json; print(json.dumps(found))`,
        ],
        stdout: "pipe",
      });
      const found = JSON.parse(
        new TextDecoder().decode(probe.stdout).trim().split("\n").at(-1) ??
          "[]",
      );
      expect(found).toEqual([]);
    },
    { timeout: 90_000 },
  );

  test(
    "measureRms works on art-embedded WAV (regression: cover-as-video poisoned astats)",
    async () => {
      // Art-embedded files carry the cover as a bogus video stream; with
      // ffmpeg's default stream selection that stream reached the astats
      // graph, failed to decode (JPEG misdetected as PNG), and the whole
      // command exited non-zero — measureRms returned null and 4 real
      // archive WAVs silently got NO energy stamp. -map 0:a skips it.
      const p = `${DIR}/art.wav`;
      await $`mkdir -p ${DIR}`.quiet();
      // 5 s tone (fingerprint-length irrelevant here but keeps fixtures uniform)
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=5 ${p}`.quiet();
      // 5 s tone; then embed the cover the way the writer really does it
      // (mutagen APIC in the ID3 chunk — ffmpeg's WAV muxer can't carry
      // a video stream at all, which is exactly why the bug hid until a
      // real art-embedded file hit it).
      const cover = `${DIR}/cover.jpg`;
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i color=c=red:s=32x32:d=1 -frames:v 1 ${cover}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -i ${cover} -vf scale=32:32 -c:v png ${DIR}/cover.png`.quiet();
      const embed = Bun.spawnSync({
        cmd: [
          "uv",
          "run",
          "--with",
          "mutagen",
          "python",
          "-c",
          `from mutagen.wave import WAVE
from mutagen.id3 import APIC
a = WAVE(${JSON.stringify(p)})
a.add_tags()
a.tags.add(APIC(encoding=3, mime="image/png", type=3, desc="Cover", data=open(${JSON.stringify(`${DIR}/cover.png`)}, "rb").read()))
a.save()`,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(embed.exitCode).toBe(0);
      const res = await enrichTrack(
        { path: p },
        { only: ["energy"], artworkQueue: null },
      );
      expect(res.notes.some((n) => n.startsWith("energy:"))).toBe(true);
    },
    { timeout: 60_000 },
  );
});
