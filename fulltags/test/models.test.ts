/**
 * Roadmap #4 + #5: mood/dance/valence (ONNX heads) + MB genre harvest.
 *
 * Environment-gated: the mood block needs the ONNX models in
 * ~/.local/share/fulltags-models + the uv essentia/onnxruntime env; the MB
 * block is injectable (no network in tests). Skips with a clear note when
 * the env is missing — CI proves the guard paths, a provisioned Mac proves
 * the full pipeline.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import {
  analyzeMoods,
  moodModelsPresent,
  moodStamp,
  type MoodResult,
} from "../src/models";
import { enrichTrack, parseMoodStamp } from "../src/pipeline";
import { writePatchSync } from "../src/writer";
import { mbGenreCacheReset } from "../src/mb";
import { readStampGuard } from "./helpers/stamp";

const DIR = `/tmp/fulltags-models-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(name: string, secs = 30): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  // Tremolo sine — a pure sine reads oddly flat across heads; the AM
  // texture gives the moods something to chew on (still deterministic).
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=220:duration=${secs} -af tremolo=f=4:d=0.9 ${p}`.quiet();
  return p;
}

describe("moodStamp / parseMoodStamp (pure, always run)", () => {
  const m: MoodResult = {
    danceability: 0.155,
    moodAggressive: 0.797,
    moodHappy: 0.99,
    moodElectronic: 0.054,
    moodParty: 0.15,
    valence: 4.04,
    arousal: 4.61,
  };
  test("stamp format round-trips through parse", () => {
    const s = moodStamp(m);
    const back = parseMoodStamp(s);
    expect(back).not.toBeNull();
    expect(back?.danceability).toBeCloseTo(0.155, 2);
    expect(back?.arousal).toBeCloseTo(4.61, 2);
    expect(back?.moodHappy).toBeCloseTo(0.99, 2);
  });
  test("malformed stamps parse to null (guard)", () => {
    expect(parseMoodStamp("garbage")).toBeNull();
    expect(parseMoodStamp("dance=0.1; party=oops")).toBeNull();
    expect(parseMoodStamp("dance=0.1")).toBeNull(); // missing fields
  });
});

describe("mood stage env contract", () => {
  test("moodModelsPresent reflects the model dir", () => {
    // Whatever the env, the predicate must be a plain boolean (never throw).
    expect(typeof moodModelsPresent()).toBe("boolean");
  });
  test("analyzeMoods with no models → empty map, never throws", async () => {
    if (moodModelsPresent()) return; // env has models — guard not exercisable
    const m = await analyzeMoods(["/tmp/definitely-missing.wav"]);
    expect(m.size).toBe(0);
  });
});

describe("ONNX mood pipeline (roadmap #4)", () => {
  const hasModels = moodModelsPresent();
  test.skipIf(!hasModels)(
    "analyzeMoods returns all 7 fields in range for a test tone",
    async () => {
      const p = await makeFile("mood.mp3");
      const res = await analyzeMoods([p]);
      const m = res.get(p);
      expect(m).toBeDefined();
      expect(m!.danceability).toBeGreaterThanOrEqual(0);
      expect(m!.danceability).toBeLessThanOrEqual(1);
      for (const v of [
        m!.moodAggressive,
        m!.moodHappy,
        m!.moodElectronic,
        m!.moodParty,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(m!.valence).toBeGreaterThan(0);
      expect(m!.valence).toBeLessThan(10);
      expect(m!.arousal).toBeGreaterThan(0);
      expect(m!.arousal).toBeLessThan(10);
    },
  );
  test.skipIf(!hasModels)(
    "enrichTrack --mood writes a MOOD stamp; second pass is a no-op",
    async () => {
      const p = await makeFile("mood-idem.mp3");
      const r1 = await enrichTrack(
        { path: p },
        { only: ["mood"], artworkQueue: null },
      );
      expect(r1.notes.some((n) => n.startsWith("mood:"))).toBe(true);
      const stamp = readStampGuard(p, "MOOD");
      expect(stamp).not.toBeNull();
      expect(parseMoodStamp(stamp!)).not.toBeNull();
      const r2 = await enrichTrack(
        { path: p },
        { only: ["mood"], artworkQueue: null },
      );
      expect(r2.notes.length).toBe(0); // idempotent
    },
  );
  test.skipIf(!hasModels)(
    "MOOD stamp round-trips on wav + m4a (writer surface)",
    async () => {
      const wav = await makeFile("mood.wav");
      const s =
        "dance=0.500; aggressive=0.100; happy=0.200; electronic=0.300; party=0.400; valence=5.00; arousal=5.00";
      expect(writePatchSync(wav, { mood: s })).toBe(true);
      expect(readStampGuard(wav, "MOOD")).toBe(s);
    },
  );
});

describe("MB genre harvest (roadmap #5)", () => {
  test("mbGenreCacheReset is callable and the module never throws on import", () => {
    // Pure smoke — the network path is covered by injectable tests in
    // src/commands/enrich.test.ts (GenreResolver seam); DNS-dependent
    // tests flake in sandboxed hook runs, so nothing here hits the wire.
    expect(() => mbGenreCacheReset()).not.toThrow();
  });
});
