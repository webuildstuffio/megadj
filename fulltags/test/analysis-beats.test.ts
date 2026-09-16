/**
 * Roadmap analysis stages, part 2 of 3 (speed split): real BPM via
 * beat_this (uv env). Split from the former monolithic analysis.test.ts
 * so `bun test --parallel` can spread the roadmap stages across worker
 * cores instead of one 11.5s file.
 *
 * Environment-gated: the block skips with a clear note when the uv
 * beat-this env is missing, so the suite runs everywhere.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { existsSync } from "node:fs";
import { analyzeBeats, parseBeatThisJson } from "../src/analysis";
import { enrichTrack } from "../src/pipeline";

const DIR = `/tmp/fulltags-analysis-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

const hasBeatThis =
  Bun.spawnSync({
    cmd: [
      "uv",
      "run",
      "--with",
      "beat-this",
      "python",
      "-c",
      "import beat_this",
    ],
    stdout: "pipe",
    stderr: "pipe",
  }).exitCode === 0;

describe("beat_this BPM (roadmap #2)", () => {
  test("malformed and structurally invalid worker JSON returns null", () => {
    expect(parseBeatThisJson("beat_this log noise\n{not-json")).toBeNull();
    expect(
      parseBeatThisJson(
        '{"bpm":128,"beats":[0,0.5,"bad",1.5],"downbeats":[0]}',
      ),
    ).toBeNull();
    expect(parseBeatThisJson('{"bpm":128}')).toBeNull();
    expect(parseBeatThisJson('{"bpm":128,"beats":[]}')).toBeNull();
    expect(
      parseBeatThisJson('{"bpm":128,"beats":[],"downbeats":[]}'),
    ).toBeNull();
    expect(
      parseBeatThisJson('{"bpm":128,"beats":[0,0.5,1],"downbeats":[0]}'),
    ).toBeNull();
    expect(parseBeatThisJson('{"bpm":0,"beats":[],"downbeats":[]}')).toBeNull();
  });

  test.skipIf(!hasBeatThis)(
    "pipeline stage writes TBPM, folds half-time, idempotent",
    async () => {
      // 2 Hz tremolo on a sine = a beat every second = 60 BPM (half of 120)
      const p = `${DIR}/bpm-t.mp3`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=30" -af "tremolo=f=2:d=0.9" ${p}`.quiet();
      const r = await enrichTrack(
        { path: p },
        { only: ["bpm"], artworkQueue: null },
      );
      const note = r.notes.find((n) => n.startsWith("bpm:"));
      expect(note).toBeTruthy();
      expect(note).not.toContain("SKIP");
      expect(r.notes.some((n) => n.includes("→120"))).toBe(true);
      const { groundTruth } = await import("../src/readers");
      expect(groundTruth(p).bpm).toBe(120);
      const r2 = await enrichTrack(
        { path: p },
        { only: ["bpm"], artworkQueue: null },
      );
      expect(r2.notes).toEqual([]); // TBPM present → skip, no rewrite
    },
    { timeout: 240_000 },
  );

  test.skipIf(!hasBeatThis)(
    "analyzeBeats returns arrays + tempo",
    async () => {
      const p = `${DIR}/bpm-raw.mp3`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=20" -af "tremolo=f=4:d=0.9" ${p}`.quiet();
      const res = await analyzeBeats(p);
      expect(res).toBeTruthy();
      expect(res!.bpm).toBeGreaterThan(0);
      expect(res!.beats.length).toBeGreaterThan(4);
      expect(res!.downbeats.length).toBeGreaterThan(1);
    },
    240_000,
  );

  test.skipIf(!hasBeatThis)(
    "m4a decode: analyzed IN-PROCESS via PyAV — no temp wav ever (regression)",
    async () => {
      // beat_this's own loader (torchaudio→soundfile→madmom) can't demux
      // m4a/aac in this env (torchcodec needs FFmpeg ≤ 8, brew is on 9).
      // The stage must decode IN-PROCESS via PyAV inside the worker script
      // — the old ffmpeg-to-temp-wav bridge (Sep 5–15 2026) wrote a hidden
      // `.name.beats-<pid>.wav` beside the source; that must stay dead.
      const p = `${DIR}/bpm-c.m4a`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=20" -af "tremolo=f=4:d=0.9" ${p}`.quiet();
      const res = await analyzeBeats(p);
      expect(res).toBeTruthy();
      expect(res!.bpm).toBeGreaterThan(0);
      // no temp wav beside the source — then or ever
      expect(existsSync(`${DIR}/.bpm-c.m4a.beats-${process.pid}.wav`)).toBe(
        false,
      );
      expect(existsSync(`${p}.beats-${process.pid}.wav`)).toBe(false);
      // pipeline stage end-to-end on the same file
      const r = await enrichTrack(
        { path: p },
        { only: ["bpm"], artworkQueue: null },
      );
      expect(r.notes.some((n) => n.startsWith("bpm:"))).toBe(true);
    },
    240_000,
  );

  test.skipIf(hasBeatThis)(
    "missing env → analyzeBeats null (no throw)",
    async () => {
      expect(await analyzeBeats("/definitely/not/a/file.mp3")).toBeNull();
    },
  );
});
