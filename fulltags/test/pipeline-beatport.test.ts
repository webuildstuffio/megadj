import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { enrichTrack } from "../src/pipeline";
import { setBeatportSearchImpl, beatportReset } from "../src/beatport";
import { groundTruth } from "../src/readers";
import type { BpTrack } from "../src/beatport";

const DIR = `/tmp/fulltags-bp-pipeline-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(name: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

function hit(over: Partial<BpTrack> = {}): BpTrack {
  return {
    id: 9440664,
    name: "Signal",
    mixName: "Club Mix",
    artists: ["Test Artist"],
    remixers: [],
    genre: "Techno",
    subGenre: "Peak Time / Driving",
    label: "Ropeadope",
    release: "Signal",
    bpm: 130,
    camelot: "5A",
    keyName: "C Minor",
    year: 2017,
    artUrl: null,
    lengthMs: 60_000,
    isrc: "US8JA1418001",
    catalogNumber: "SSD876",
    url: "https://www.beatport.com/track/signal/9440664",
    ...over,
  };
}

/** Wire the seam and guarantee restore even on assertion failure. */
async function withBp(
  impl: Parameters<typeof setBeatportSearchImpl>[0],
  fn: () => Promise<void>,
): Promise<void> {
  const restore = setBeatportSearchImpl(impl);
  try {
    await fn();
  } finally {
    restore();
    beatportReset();
  }
}

describe("enrichTrack × Beatport (second source, behind SC)", () => {
  test(
    "fills label/mix/isrc + provenance stamp + year when the file lacks them",
    async () => {
      await withBp(
        async () => [hit()],
        async () => {
          const p = await makeFile("fill.mp3");
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            // Only the stages Beatport feeds; SC search needs yt-dlp and
            // MUST NOT fire in tests — genre/year here come from BP.
            { only: ["tags", "year"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.label).toBe("Ropeadope");
          expect(t.mixName).toBe("Club Mix");
          expect(t.isrc).toBe("US8JA1418001");
          expect(t.year).toBe("2017");
          expect(res.notes.some((n) => n.startsWith("bp:"))).toBe(true);
        },
      );
    },
    { timeout: 60_000 },
  );

  test(
    "'Original Mix' is never written as a mix name (no-information value)",
    async () => {
      await withBp(
        async () => [hit({ mixName: "Original Mix" })],
        async () => {
          const p = await makeFile("origmix.mp3");
          await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.label).toBe("Ropeadope");
          expect(t.mixName).toBeNull();
        },
      );
    },
    { timeout: 60_000 },
  );

  test(
    "idempotent: bp-filled file gets no second bp note on re-run",
    async () => {
      await withBp(
        async () => [hit()],
        async () => {
          const p = await makeFile("idem.mp3");
          const opts = {
            only: ["tags" as const],
            artworkQueue: null,
          };
          await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            opts,
          );
          const second = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            opts,
          );
          expect(second.notes).not.toContain("artist");
          expect(second.notes.some((n) => n.startsWith("bp:"))).toBe(false);
        },
      );
    },
    { timeout: 60_000 },
  );

  test(
    "SC hit present → BP still fills identity fields (never genre: SC wins)",
    async () => {
      await withBp(
        async () => [hit({ genre: "Techno" })],
        async () => {
          const p = await makeFile("both.mp3");
          // Pre-seed genre from "SC" by writing it first; the pipeline must
          // keep it even though BP offers Techno.
          const { writePatch } = await import("../src/writer");
          await writePatch(p, { genre: "House" });
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags", "genre"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.genre).toBe("House");
          expect(t.label).toBe("Ropeadope");
          expect(res.notes.some((n) => n.startsWith("genre:"))).toBe(false);
        },
      );
    },
    { timeout: 60_000 },
  );

  test(
    "dry run stays fully offline (no BP search, no writes)",
    async () => {
      let searched = false;
      await withBp(
        async () => {
          searched = true;
          return [hit()];
        },
        async () => {
          const p = await makeFile("dry.mp3");
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags", "year"], dryRun: true, artworkQueue: null },
          );
          expect(searched).toBe(false);
          expect(res.notes.length).toBe(0);
          const t = groundTruth(p);
          expect(t.label).toBeNull();
        },
      );
    },
    { timeout: 60_000 },
  );

  test(
    "junk-class BP hit (different artist) fills nothing",
    async () => {
      await withBp(
        async () => [hit({ artists: ["Unrelated Artist"] })],
        async () => {
          const p = await makeFile("junk.mp3");
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags", "year"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.label).toBeNull();
          expect(t.isrc).toBeNull();
          expect(t.year).toBeNull();
          expect(res.notes.some((n) => n.startsWith("bp:"))).toBe(false);
        },
      );
    },
    { timeout: 60_000 },
  );
});
