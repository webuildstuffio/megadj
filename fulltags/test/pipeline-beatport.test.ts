import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { enrichTrack } from "../src/pipeline";
import {
  setBeatportSearchImpl,
  beatportReset,
  bpStamp,
  BP_STAMP_MAX,
} from "../src/beatport";
import { setScSearchImpl } from "../src/art-sources";
import { groundTruth } from "../src/readers";
import type { BpTrack } from "../src/beatport";
import type { SearchRow, ScHit } from "../src/art-sources";

const DIR = `/tmp/fulltags-bp-pipeline-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(name: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  // 60 s duration matches the fixture hit's lengthMs → the ±2 s duration
  // bonus fires (this exercises the durationS wiring end to end).
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=60 ${p}`.quiet();
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

/** Wire BOTH seams (Beatport catalog + SoundCloud search) and guarantee
 * restore even on assertion failure. The SC seam is what keeps these
 * tests hermetic: the real scSearch shells out to yt-dlp. */
async function withBp(
  impl: Parameters<typeof setBeatportSearchImpl>[0],
  fn: () => Promise<void>,
): Promise<void> {
  const restoreBp = setBeatportSearchImpl(impl);
  const restoreSc = setScSearchImpl((_r: SearchRow): ScHit[] => []);
  try {
    await fn();
  } finally {
    restoreBp();
    restoreSc();
    beatportReset();
  }
}

describe("enrichTrack × Beatport (second source, behind SC)", () => {
  test(
    "fills label/mix/isrc/remixer + provenance stamp + year when the file lacks them",
    async () => {
      await withBp(
        async () => [hit({ remixers: ["Official Remixer"], genre: "Techno" })],
        async () => {
          const p = await makeFile("fill.mp3");
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            // Genre/year ride the BP ladder (SC seam returns no hits);
            // identity fields ride the tags stage.
            { only: ["tags", "year", "genre"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.label).toBe("Ropeadope");
          expect(t.mixName).toBe("Club Mix");
          expect(t.isrc).toBe("US8JA1418001");
          expect(t.year).toBe("2017");
          expect(t.remixer).toBe("Official Remixer");
          expect(t.genre).toBe("Techno");
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
    "file remixer credit present → BP remixer never overwrites it",
    async () => {
      await withBp(
        async () => [hit({ remixers: ["Other Remixer"] })],
        async () => {
          const p = await makeFile("credited.mp3");
          const { writePatch } = await import("../src/writer");
          await writePatch(p, { remixer: "Existing Credit" });
          await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.remixer).toBe("Existing Credit");
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
    "durationS feeds the scorer: a 60 s file matching a 60 s row scores via the ±2 s bonus",
    async () => {
      await withBp(
        async () => [
          // Title overlap alone (1 shared word ×4) sits BELOW the floor;
          // only the ±2 s duration bonus (60 s file vs 60_000 ms row)
          // pushes this row over BP_MIN_SCORE — proves duration wiring.
          hit({ name: "Signal (Dub Plate Mix)" }),
        ],
        async () => {
          const p = await makeFile("dur.mp3");
          const res = await enrichTrack(
            { path: p, title: "Signal", artist: "Test Artist" },
            { only: ["tags"], artworkQueue: null },
          );
          const t = groundTruth(p);
          expect(t.label).toBe("Ropeadope");
          expect(t.isrc).toBe("US8JA1418001");
          expect(res.notes.some((n) => n.startsWith("bp:"))).toBe(true);
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

describe("bpStamp budget", () => {
  test("stays under the TagPatch 500-char guard even for huge fields", () => {
    const stamp = bpStamp([
      ["label", "L".repeat(300)],
      ["mix", "M".repeat(300)],
      ["isrc", "US8JA1418001"],
      ["remixer", "R".repeat(300)],
    ]);
    expect(stamp).not.toBeNull();
    expect(stamp!.length).toBeLessThanOrEqual(BP_STAMP_MAX);
    expect(stamp).toContain("+"); // records the cut honestly
  });

  test("null/empty fields never stamp", () => {
    expect(
      bpStamp([
        ["label", null],
        ["mix", ""],
      ]),
    ).toBeNull();
    expect(bpStamp([])).toBeNull();
  });
});
