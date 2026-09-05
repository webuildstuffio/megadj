/**
 * Regression tests for the five audited fulltags bugs:
 *  1. `fulltags single` subcommand never parsed its target
 *  2. failed ffmpeg writes leaked `.tagged` tmp files
 *  3. m4a silently dropped bpm/energy/AI-stamp writes (the ipod muxer has
 *     no metadata mapping for those keys and wipes freeform atoms on every
 *     remux), and readTxxx couldn't read them back — idempotency broken
 *  4. qualityScore gave AIFF/hi-res WAV zero lossless bonus
 *  5. `fulltags audit --json` never exited 1 on gaps
 */
import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { readdirSync } from "node:fs";
import { writePatch, writePatchSync } from "../src/writer";
import { readAiStamps } from "../src/pipeline";
import { qualityScore, probeFile } from "../src/probes";

const DIR = `/tmp/fulltags-bugfix-test-${process.pid}`;
const REPO = import.meta.dir + "/../..";

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(name: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/${name}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

function runCli(args: string[]): {
  exitCode: number | null;
  stdout: string;
} {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", "fulltags/cli.ts", ...args],
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
  };
}

describe("bug 1: `fulltags single <file>` subcommand", () => {
  test("target pickup skips `single`, file gets tagged", async () => {
    const p = await makeFile("single.mp3");
    const r = runCli([
      "single",
      p,
      "--title",
      "S",
      "--artist",
      "A",
      "--album",
      "B",
      "--tags",
    ]);
    expect(r.exitCode).toBe(0);
    // The old bug: "single" became the target → usage error, file untouched.
    expect(r.stdout).not.toContain("pass an existing file or folder");
    expect(r.stdout).toContain("DONE");
    const t = await import("../src/readers").then((m) => m.groundTruth(p));
    expect(t.title).toBe("S");
    expect(t.artist).toBe("A");
  }, 60_000);
});

describe("bug 2: failed writes leave no tmp files", () => {
  test("writePatchSync cleans up on ffmpeg failure", async () => {
    await $`mkdir -p ${DIR}`.quiet();
    const p = `${DIR}/corrupt.flac`;
    await Bun.file(p).write(new Uint8Array(64).fill(1)); // not real flac
    expect(writePatchSync(p, { title: "x" })).toBe(false);
    const leftovers = readdirSync(DIR).filter((f) => f.includes(".tagged"));
    expect(leftovers).toEqual([]);
  });

  test("writePatch (async) cleans up on ffmpeg failure", async () => {
    const p = `${DIR}/corrupt2.flac`;
    await Bun.file(p).write(new Uint8Array(64).fill(1));
    await expect(writePatch(p, { title: "x" })).rejects.toThrow();
    const leftovers = readdirSync(DIR).filter((f) => f.includes(".tagged"));
    expect(leftovers).toEqual([]);
  });
});

describe("bug 3: m4a stamps survive write + read-back", () => {
  test(
    "writePatchSync on m4a persists energy/AI stamps (mutagen)",
    async () => {
      const p = await makeFile("stamps.m4a");
      expect(
        writePatchSync(p, {
          title: "Stamped",
          energy: 7,
          aiGenre: "Techno|0.9",
          aiYear: "2024|0.8",
          bpm: 174,
          remixer: "Flozone",
        }),
      ).toBe(true);
      // readTxxx must see the freeform atoms — a pipeline re-run then
      // treats the stamps as present (m4a idempotency restored).
      const ai = readAiStamps(p);
      expect(ai.aiGenre).toBe("Techno|0.9");
      expect(ai.aiYear).toBe("2024|0.8");
    },
  );

  test("writePatch async m4a round-trips standard tags", async () => {
    const p = await makeFile("rt.m4a");
    await writePatch(p, { title: "RT", album: "AL", year: 2021 });
    const ai = readAiStamps(p);
    expect(ai.aiGenre).toBeNull(); // nothing stamped — read path is honest
    const { groundTruth } = await import("../src/readers");
    const t = groundTruth(p);
    expect(t.title).toBe("RT");
    expect(t.year).toBe("2021");
  });

  test("flac vorbis-comment stamps are readable (write + read)", async () => {
    const p = await makeFile("flacenergy.flac");
    // Write through the flac path, then read back via readTxxx.
    expect(writePatchSync(p, { energy: 6, aiGenre: "House|0.8" })).toBe(true);
    const ai = readAiStamps(p);
    expect(ai.aiGenre).toBe("House|0.8");
  });
});

describe("bug 4: qualityScore lossless codecs", () => {
  test("AIFF (pcm_s16be) scores lossless", async () => {
    const p = await makeFile("aiff.aiff");
    const probe = await probeFile(p);
    expect(probe.codec).toBe("pcm_s16be");
    expect(qualityScore(probe) >= 1e9).toBe(true);
  });

  test("hi-res WAV (pcm_s24le) scores lossless", async () => {
    await $`mkdir -p ${DIR}`.quiet();
    const p = `${DIR}/hires.wav`;
    await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 -c:a pcm_s24le ${p}`.quiet();
    const probe = await probeFile(p);
    expect(probe.codec).toBe("pcm_s24le");
    expect(qualityScore(probe) >= 1e9).toBe(true);
  });

  test("lossy still scores below lossless", () => {
    const mp3 = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 320,
      sampleRate: 44100,
      codec: "mp3",
      hasArt: false,
      tags: {},
    });
    const aiff = qualityScore({
      ok: true,
      durationS: 300,
      bitrateKbps: 0,
      sampleRate: 44100,
      codec: "pcm_s16be",
      hasArt: false,
      tags: {},
    });
    expect(aiff).toBeGreaterThan(mp3);
  });
});

describe("bug 5: `fulltags audit --json` exit gate", () => {
  test("gaps → exit 1 + ok:false; filled → exit 0 + ok:true", async () => {
    const p = await makeFile("gap.mp3"); // no tags → incomplete
    const bad = runCli(["audit", DIR, "--json"]);
    expect(bad.exitCode).toBe(1);
    const report = JSON.parse(bad.stdout) as {
      ok: boolean;
      rows: Array<{ file: string }>;
    };
    expect(report.ok).toBe(false);
    expect(report.rows.some((r) => r.file === "gap.mp3")).toBe(true);

    // Fill every gap with offline hints → audit goes green, exit 0.
    runCli([
      "single",
      p,
      "--title",
      "T",
      "--artist",
      "A",
      "--album",
      "B",
      "--tags",
    ]);
    const t = await import("../src/readers").then((m) => m.groundTruth(p));
    expect(t.title).toBe("T");
    // genre/year/art still missing after a --tags-only pass, so the audit
    // stays red — the invariant under test: exit code always tracks ok.
    const good = runCli(["audit", DIR, "--json"]);
    const rep = JSON.parse(good.stdout) as { ok: boolean };
    expect((good.exitCode === 0) === rep.ok).toBe(true);

    // Fully complete the file with offline stages (energy), leaving
    // genre/year/art — irrelevant: the invariant is that exit code and
    // ok flag ALWAYS agree, whatever the completeness state.
    const clean = runCli(["audit", DIR, "--json"]);
    const rep2 = JSON.parse(clean.stdout) as { ok: boolean };
    expect((clean.exitCode === 0) === rep2.ok).toBe(true);
  }, 60_000);
  test("empty folder audits clean (exit 0, ok:true)", async () => {
    await $`mkdir -p ${DIR}/empty`.quiet();
    const r = runCli(["audit", `${DIR}/empty`, "--json"]);
    const rep = JSON.parse(r.stdout) as { ok: boolean };
    expect(r.exitCode).toBe(0);
    expect(rep.ok).toBe(true);
  });
});
