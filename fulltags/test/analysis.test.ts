/**
 * Roadmap #1–#3 analysis stages: fingerprints (chromaprint), real BPM
 * (beat_this), harmonic key (OpenKeyScan analyzer).
 *
 * Environment-gated: each describe-block skips with a clear note when its
 * dependency is missing (fpcalc / uv beat-this / the analyzer clone) so
 * the suite runs everywhere — CI without deps proves the skip+guard
 * paths, a provisioned Mac proves the full pipeline.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { existsSync } from "node:fs";
import {
  fingerprintFile,
  fingerprintWithDuration,
  analyzeBeats,
  analyzeKey,
  analyzeKeys,
  foldTempo,
  keyscanDir,
} from "../src/analysis";
import { writePatchSync } from "../src/writer";
import { readStampGuard } from "./helpers/stamp";
import { enrichTrack } from "../src/pipeline";
const DIR = `/tmp/fulltags-analysis-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(name: string, secs = 3): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=${secs} ${p}`.quiet();
  return p;
}

const hasFpcalc =
  Bun.spawnSync({ cmd: ["fpcalc", "-version"], stdout: "pipe" }).exitCode === 0;
const hasBeatThis =
  Bun.spawnSync({
    cmd: ["uv", "run", "--with", "beat-this", "python", "-c", "import beat_this"],
    stdout: "pipe",
    stderr: "pipe",
  }).exitCode === 0;
const hasKeyscan = existsSync(
  `${keyscanDir()}/openkeyscan_analyzer_server.py`,
);

describe("foldTempo (DJ window folding)", () => {
  test("keeps in-window tempos, folds double/half", () => {
    expect(foldTempo(128)).toBe(128);
    expect(foldTempo(174)).toBe(174);
    expect(foldTempo(60)).toBe(120); // half-time → 120
    expect(foldTempo(200)).toBe(100); // double-time → 100
  });
});

describe("chromaprint fingerprints (roadmap #1)", () => {
  test.skipIf(!hasFpcalc)(
    "same content different containers → identical fingerprint",
    async () => {
      const a = await makeFile("fp-a.mp3");
      const b = `${DIR}/fp-b.wav`;
      await $`ffmpeg -y -hide_banner -loglevel error -i ${a} ${b}`.quiet();
      const fa = fingerprintFile(a);
      const fb = fingerprintFile(b);
      expect(fa).toBeTruthy();
      expect(fb).toBeTruthy();
      expect(fa).toBe(fb); // content identity, format-blind
    },
  );

  test.skipIf(!hasFpcalc)("different audio → different fingerprint", async () => {
    // Pure 440 vs 880 Hz sines hash identically (chromaprint's chroma
    // filter is octave-invariant — both are one flat tone). Use noise vs
    // tone for a real chroma difference.
    const a = await makeFile("fp-x.mp3");
    const b = `${DIR}/fp-y.mp3`;
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "anoisesrc=d=3:c=pink:a=0.8" ${b}`.quiet();
    const fa = fingerprintFile(a);
    const fb = fingerprintFile(b);
    expect(fa).toBeTruthy();
    expect(fb).toBeTruthy();
    expect(fa).not.toBe(fb);
  });

  test.skipIf(!hasFpcalc)("duration companion is sane", async () => {
    const p = await makeFile("fp-dur.mp3", 4);
    const { fingerprint, durationS } = fingerprintWithDuration(p);
    expect(fingerprint).toBeTruthy();
    expect(durationS).toBeGreaterThanOrEqual(3);
    expect(durationS).toBeLessThanOrEqual(5);
  });

  test.skipIf(!hasFpcalc)("pipeline stage writes TXXX:ACOUSTID, idempotent", async () => {
    const p = await makeFile("fp-stage.mp3");
    const r = await enrichTrack({ path: p }, { only: ["fingerprint"], artworkQueue: null });
    expect(r.notes.some((n) => n.startsWith("fingerprint:"))).toBe(true);
    expect(readStampGuard(p, "ACOUSTID")).toBeTruthy();
    const r2 = await enrichTrack({ path: p }, { only: ["fingerprint"], artworkQueue: null });
    expect(r2.notes).toEqual([]);
  });

  test.skipIf(hasFpcalc)("missing fpcalc → probe returns null (no throw)", () => {
    expect(fingerprintFile("/definitely/not/a/file.mp3")).toBeNull();
  });
});

describe("beat_this BPM (roadmap #2)", () => {
  test.skipIf(!hasBeatThis)(
    "pipeline stage writes TBPM, folds half-time, idempotent",
    async () => {
      // 2 Hz tremolo on a sine = a beat every second = 60 BPM (half of 120)
      const p = `${DIR}/bpm-t.mp3`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=30" -af "tremolo=f=2:d=0.9" ${p}`.quiet();
      const r = await enrichTrack({ path: p }, { only: ["bpm"], artworkQueue: null });
      const note = r.notes.find((n) => n.startsWith("bpm:"));
      expect(note).toBeTruthy();
      expect(note).not.toContain("SKIP");
      expect(r.notes.some((n) => n.includes("→120"))).toBe(true);
      const { groundTruth } = await import("../src/readers");
      expect(groundTruth(p).bpm).toBe(120);
      const r2 = await enrichTrack({ path: p }, { only: ["bpm"], artworkQueue: null });
      expect(r2.notes).toEqual([]); // TBPM present → skip, no rewrite
    },
    { timeout: 240_000 },
  );

  test.skipIf(!hasBeatThis)("analyzeBeats returns arrays + tempo", async () => {
    const p = `${DIR}/bpm-raw.mp3`;
    await $`mkdir -p ${DIR}`.quiet();
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=20" -af "tremolo=f=4:d=0.9" ${p}`.quiet();
    const res = await analyzeBeats(p);
    expect(res).toBeTruthy();
    expect(res!.bpm).toBeGreaterThan(0);
    expect(res!.beats.length).toBeGreaterThan(4);
    expect(res!.downbeats.length).toBeGreaterThan(1);
  }, 240_000);

  test.skipIf(hasBeatThis)("missing env → analyzeBeats null (no throw)", async () => {
    expect(await analyzeBeats("/definitely/not/a/file.mp3")).toBeNull();
  });
});

describe("OpenKeyScan key (roadmap #3)", () => {
  test.skipIf(!hasKeyscan)(
    "pipeline stage writes TKEY+TXXX:CAMELOT, idempotent",
    async () => {
      const p = await makeFile("key-t.mp3");
      const r = await enrichTrack({ path: p }, { only: ["key"], artworkQueue: null });
      const note = r.notes.find((n) => n.startsWith("key:"));
      expect(note).toBeTruthy();
      expect(note).toMatch(/key:\d{1,2}[AB]/);
      // Stamp round-trip: TXXX:CAMELOT readable in the container
      expect(readStampGuard(p, "CAMELOT")).toMatch(/^\d{1,2}[AB]$/);
      const r2 = await enrichTrack({ path: p }, { only: ["key"], artworkQueue: null });
      expect(r2.notes).toEqual([]); // stamp present → skip
    },
    { timeout: 180_000 },
  );

  test.skipIf(!hasKeyscan)("analyzeKeys amortizes the model load (batch)", async () => {
    const a = await makeFile("key-b1.mp3");
    const b = await makeFile("key-b2.mp3");
    const m = await analyzeKeys([a, b]);
    expect(m.size).toBe(2);
    expect(m.get(a)).toBeTruthy();
    expect(m.get(b)!.camelot).toMatch(/^\d{1,2}[AB]$/);
  }, 180_000);

  test.skipIf(hasKeyscan)("missing analyzer → analyzeKey null (no throw)", async () => {
    expect(await analyzeKey("/definitely/not/a/file.mp3")).toBeNull();
  });
});

describe("stamp plumbing for analysis stages", () => {
  test("writePatchSync fingerprint round-trips on m4a freeform", async () => {
    const p = await makeFile("fp-m4a.m4a");
    expect(writePatchSync(p, { fingerprint: "AQAAA0mUaEkSZSoA" })).toBe(true);
    expect(readStampGuard(p, "ACOUSTID")).toBe("AQAAA0mUaEkSZSoA");
  });

  test("writePatchSync camelot round-trips on aiff TXXX + mp3", async () => {
    const a = await makeFile("key-a.aiff");
    expect(writePatchSync(a, { camelot: "9A", key: "9A" })).toBe(true);
    expect(readStampGuard(a, "CAMELOT")).toBe("9A");
    const m = await makeFile("key-m.mp3");
    expect(writePatchSync(m, { camelot: "8B", key: "8B" })).toBe(true);
    expect(readStampGuard(m, "CAMELOT")).toBe("8B");
  });
});
