/**
 * Roadmap analysis stages, part 3 of 3 (speed split): harmonic key via
 * the OpenKeyScan analyzer + stamp plumbing round-trips. Split from the
 * former monolithic analysis.test.ts so `bun test --parallel` can spread
 * the roadmap stages across worker cores instead of one 11.5s file.
 *
 * Environment-gated: the key block skips with a clear note when the
 * analyzer clone is missing, so the suite runs everywhere.
 */
import { describe, test, expect } from "bun:test";
import { $ } from "bun";
import { existsSync } from "node:fs";
import { analyzeKey, analyzeKeys, keyscanDir } from "../src/analysis";
import { writePatchSync } from "../src/writer";
import { readStampGuard } from "./helpers/stamp";
import { enrichTrack } from "../src/pipeline";
import { DIR, makeFile } from "./helpers/analysis";

const hasKeyscan = existsSync(`${keyscanDir()}/openkeyscan_analyzer_server.py`);

describe("OpenKeyScan key (roadmap #3)", () => {
  test.skipIf(!hasKeyscan)(
    "pipeline stage writes TKEY+TXXX:CAMELOT, idempotent",
    async () => {
      const p = await makeFile("key-t.mp3");
      const r = await enrichTrack(
        { path: p },
        { only: ["key"], artworkQueue: null },
      );
      const note = r.notes.find((n) => n.startsWith("key:"));
      expect(note).toBeTruthy();
      expect(note).toMatch(/key:\d{1,2}[AB]/);
      // Stamp round-trip: TXXX:CAMELOT readable in the container
      expect(readStampGuard(p, "CAMELOT")).toMatch(/^\d{1,2}[AB]$/);
      const r2 = await enrichTrack(
        { path: p },
        { only: ["key"], artworkQueue: null },
      );
      expect(r2.notes).toEqual([]); // stamp present → skip
    },
    { timeout: 180_000 },
  );

  test.skipIf(!hasKeyscan)(
    "analyzeKeys amortizes the model load (batch)",
    async () => {
      const a = await makeFile("key-b1.mp3");
      const b = await makeFile("key-b2.mp3");
      const m = await analyzeKeys([a, b]);
      expect(m.size).toBe(2);
      expect(m.get(a)).toBeTruthy();
      expect(m.get(b)!.camelot).toMatch(/^\d{1,2}[AB]$/);
    },
    180_000,
  );

  test.skipIf(!hasKeyscan)(
    "m4a decode: key analysis via tmp wav, id maps to original (regression)",
    async () => {
      // The analyzer's librosa/libsndfile loader can't demux m4a. The
      // stage must decode via ffmpeg and return results keyed by the
      // ORIGINAL path (not the temp wav's).
      const p = `${DIR}/key-c.m4a`;
      await $`mkdir -p ${DIR}`.quiet();
      await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=8 ${p}`.quiet();
      const m = await analyzeKeys([p]);
      expect(m.get(p)).toBeTruthy(); // keyed by original path
      expect(m.get(p)!.camelot).toMatch(/^\d{1,2}[AB]$/);
      // tmp wav cleaned up
      expect(existsSync(`${DIR}/.key-c.m4a.key-${process.pid}.wav`)).toBe(
        false,
      );
    },
    180_000,
  );

  test.skipIf(hasKeyscan)(
    "missing analyzer → analyzeKey null (no throw)",
    async () => {
      expect(await analyzeKey("/definitely/not/a/file.mp3")).toBeNull();
    },
  );
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
