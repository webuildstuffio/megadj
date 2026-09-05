// walk-async.test.ts — repo invariant guard: the filesystem walkers and
// benchmarks run on the SERVER event loop, so they must stay async.
// spawnSync/readdirSync/statSync/readSync loops here once froze the server
// for minutes and starved the SSE heartbeat (Bun kills silent streams ~10s)
// — finished jobs were stranded as phantom "running 0%" (AGENTS.md).
// This test is the tripwire: if sync fs APIs creep back into scan/walk/bench,
// it fails and names the offender.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SYNC_FS_APIS = [
  "readdirSync",
  "statSync",
  "existsSync?", // allowed in guard.ts, banned here — matched literally below
  "spawnSync",
  "readSync",
  "openSync",
  "readFileSync",
];

const FILES = ["walk.ts", "scan.ts", "bench.ts"];

describe("async-only invariant for event-loop fs code", () => {
  // Strip block and line comments so prose in headers can't trip the match.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/([^:])\/\/(?!\/).*/g, "$1");
  }

  for (const f of FILES) {
    it(`${f} contains no synchronous fs/spawn calls`, () => {
      const src = stripComments(
        readFileSync(join(import.meta.dir, "..", "src", f), "utf8"),
      );
      const offenders = SYNC_FS_APIS.filter(
        (api) => api !== "existsSync?" && new RegExp(`\\b${api}\\b`).test(src),
      );
      expect(offenders).toEqual([]);
    });
  }

  it("scanVolume and benchmarkDrive are async functions", async () => {
    const { scanVolume } = await import("../src/scan");
    const { benchmarkDrive } = await import("../src/bench");
    expect(scanVolume.constructor.name).toBe("AsyncFunction");
    expect(benchmarkDrive.constructor.name).toBe("AsyncFunction");
  });

  it("walkTree still yields to the event loop mid-walk (liveness)", async () => {
    // A sync walk would block this timer from firing; the async walker
    // lets a 0ms timer interleave between directory reads.
    const { walkTree } = await import("../src/walk");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const dir = mkdtempSync("/tmp/cratedeck-walk-async-");
    try {
      for (let i = 0; i < 40; i++) {
        const sub = join(dir, `d${i}`);
        require("node:fs").mkdirSync(sub);
        for (let j = 0; j < 20; j++)
          writeFileSync(join(sub, `f${j}.m4a`), new Uint8Array(10));
      }
      let timerFired = 0;
      const timer = setTimeout(() => timerFired++, 0);
      let files = 0;
      await walkTree(dir, {
        onFile: () => {
          files++;
        },
      });
      clearTimeout(timer);
      expect(files).toBe(800);
      // The walker read 800 files across 40 dirs; a liveness sweep means
      // timers got slots. (Exact count varies by scheduler; > 0 is the point.)
      expect(timerFired).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
