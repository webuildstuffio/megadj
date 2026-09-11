/**
 * Roadmap #1–#3 analysis stages, part 1 of 3 (speed split): pure tempo
 * folding + chromaprint fingerprints (chromaprint/fpcalc). Split from the
 * former monolithic analysis.test.ts so `bun test --parallel` can spread
 * the roadmap stages across worker cores instead of one 11.5s file.
 *
 * Environment-gated: each describe-block skips with a clear note when its
 * dependency is missing (fpcalc) so the suite runs everywhere.
 */
import { describe, test, expect } from "bun:test";
import { $ } from "bun";
import {
  fingerprintFile,
  fingerprintWithDuration,
  foldTempo,
} from "../src/analysis";
import { readStampGuard } from "./helpers/stamp";
import { enrichTrack } from "../src/pipeline";
import { DIR, makeFile } from "./helpers/analysis";

const hasFpcalc =
  Bun.spawnSync({ cmd: ["fpcalc", "-version"], stdout: "pipe" }).exitCode === 0;

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

  test.skipIf(!hasFpcalc)(
    "different audio → different fingerprint",
    async () => {
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
    },
  );

  test.skipIf(!hasFpcalc)("duration companion is sane", async () => {
    const p = await makeFile("fp-dur.mp3", 4);
    const { fingerprint, durationS } = fingerprintWithDuration(p);
    expect(fingerprint).toBeTruthy();
    expect(durationS).toBeGreaterThanOrEqual(3);
    expect(durationS).toBeLessThanOrEqual(5);
  });

  test.skipIf(!hasFpcalc)(
    "pipeline stage writes TXXX:ACOUSTID, idempotent",
    async () => {
      const p = await makeFile("fp-stage.mp3");
      const r = await enrichTrack(
        { path: p },
        { only: ["fingerprint"], artworkQueue: null },
      );
      expect(r.notes.some((n) => n.startsWith("fingerprint:"))).toBe(true);
      expect(readStampGuard(p, "ACOUSTID")).toBeTruthy();
      const r2 = await enrichTrack(
        { path: p },
        { only: ["fingerprint"], artworkQueue: null },
      );
      expect(r2.notes).toEqual([]);
    },
  );

  test.skipIf(hasFpcalc)(
    "missing fpcalc → probe returns null (no throw)",
    () => {
      expect(fingerprintFile("/definitely/not/a/file.mp3")).toBeNull();
    },
  );

  test.skipIf(!hasFpcalc)(
    "missing fpcalc from PATH → null, never ENOENT throw (regression)",
    () => {
      // Regression: Bun.spawnSync THROWS ENOENT when the binary is absent;
      // the probe contract is degrade-to-null (the CLI masks it, in-process
      // callers like `megadj fetch` would otherwise abort the whole pass).
      // Re-spawn THIS bun with a PATH that has no fpcalc and import the
      // probe there — runs even on machines where fpcalc IS installed.
      const script = `
const { fingerprintFile, fingerprintWithDuration } = await import(${JSON.stringify(`${import.meta.dir}/../src/analysis.ts`)});
const r1 = fingerprintFile(${JSON.stringify(`${DIR}/fp-t.mp3`)});
if (r1 !== null) throw new Error("expected null, got " + r1);
const r2 = fingerprintWithDuration(${JSON.stringify(`${DIR}/fp-t.mp3`)});
if (r2.fingerprint !== null || r2.durationS !== null) throw new Error("expected nulls");
console.log("MISSING-ENV-OK");
`;
      const pr = Bun.spawnSync({
        cmd: [process.execPath, "-e", script],
        env: { ...process.env, PATH: "/usr/bin:/bin" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(pr.exitCode).toBe(0);
      expect(new TextDecoder().decode(pr.stdout)).toContain("MISSING-ENV-OK");
    },
  );
});
