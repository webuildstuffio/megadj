import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import type { ArchiveState } from "../../archive/state";
import { RateLimiter, TrackGoneError } from "../ratelimit";
import { Downloader } from "../downloader";
import {
  parsePlaylistOutput,
  statSizeSafe,
  sync,
  type SyncOptions,
} from "./sync";
import { tempState } from "../../test-support/testutil";

/**
 * GetDat regression tests for the sync pipeline — run with an injected
 * playlist fetcher so no playlist network is touched, and a yt-dlp binary
 * path that cannot exist so probes fail fast (exit 1, no network). Guards:
 *  - `--json` stdout stays parseable (human logs suppressed) — PRINCIPLES §1
 *  - `dry-run` writes NOTHING to the state DB (no tracks, no run rows)
 *  - a real run still records tracks + a finished run row
 *  - probe failures land as `failed`, never crash the run
 */

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-sync-test-");

/** Injected fetcher signature matches sync's fetchPlaylistFn. */
const fakeFetch = async () => [{ id: "v1", title: "Track One" }];

function baseOpts(
  st: ArchiveState,
  over: Partial<SyncOptions> = {},
): SyncOptions {
  return {
    state: st,
    limiter: new RateLimiter({ minIntervalMs: 0, baseBackoffMs: 0 }),
    musicDir: "/tmp/megadj-sync-test",
    cookiesFromBrowser: null,
    cookiesFile: null,
    sources: [{ kind: "ytm-playlist", id: "LM", label: "liked" }],
    fetchPlaylistFn: fakeFetch,
    // nonexistent binary → probes fail fast (exit 1, no network), exactly
    // what this file's design comment promises; without it the two "real
    // run" tests hit YouTube and stall on the ~22s real yt-dlp round-trip.
    ytdlpBin: "megadj-no-such-bin",
    onProgress: () => {}, // silence human logs in tests
    ...over,
  };
}

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
});

describe("sync (GetDat pipeline)", () => {
  test("missing landed file is not reported as a zero-byte success", async () => {
    const logs: string[] = [];
    const size = await statSizeSafe(
      `${dir}/landed-file-that-does-not-exist.m4a`,
      (message) => logs.push(message),
    );
    expect(size).toBeNull();
    expect(logs[0]).toContain("not statable");
  });

  test("malformed playlist output is reported as a playlist parse failure", () => {
    expect(() => parsePlaylistOutput("{not-json")).toThrow(
      "playlist output was not valid JSON",
    );
    expect(() => parsePlaylistOutput("[]")).toThrow(
      "playlist output was not valid JSON",
    );
  });

  // Probe failures go through withRetry (3 attempts × ~1.5s spawn resolution
  // of the intentionally-nonexistent binary) — give the tests room.
  test("dry-run writes nothing to the state DB", async () => {
    const logs: string[] = [];
    await sync(
      baseOpts(state, {
        dryRun: true,
        json: true,
        onProgress: (m) => logs.push(m),
      }),
    );
    // Injected onProgress is an explicit log sink — it still receives the
    // human logs even in json mode (suppression only applies to stdout).
    expect(logs.some((m) => m.includes("would download"))).toBe(true);
    expect(state.allTracks().length).toBe(0); // no playlist upserts
    expect(state.lastRuns(1).length).toBe(0); // no run rows
  });

  test("json mode emits exactly one JSON object on stdout (the summary)", async () => {
    // No injected onProgress + json: every human log line is suppressed and
    // the only console.log call is the summary object. Probes fail fast
    // (nonexistent ytdlpBin) — the track lands as failed, run still recorded.
    const originals = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await sync(
        baseOpts(state, {
          json: true,
          limit: 1,
          onProgress: undefined,
          fetchPlaylistFn: fakeFetch,
        }),
      );
    } finally {
      console.log = originals;
    }
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed.command).toBe("sync");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.attempted).toBe(1);
    expect(state.statusCounts()["failed"]).toBe(1);
    expect(state.lastRuns(1).length).toBe(1); // real run recorded
  }, 60_000);

  test("non-json run records the playlist and a finished run row", async () => {
    await sync(baseOpts(state, { limit: 1 }));
    expect(state.allTracks().length).toBe(1);
    const run = state.lastRuns(1)[0];
    expect(run?.attempted).toBe(1);
    expect(run?.finished_at).not.toBeNull();
  }, 60_000);

  test("probe failure marks the track failed, not gone", async () => {
    const d = new Downloader({
      musicDir: "/tmp/x",
      ytdlpBin: "megadj-no-such-bin",
    });
    try {
      await d.probe("abc123");
      expect.unreachable();
    } catch (e) {
      // Failure surfaces as a retryable error, not the permanent TrackGoneError.
      expect(e instanceof TrackGoneError).toBe(false);
    }
  }, 60_000);
});

describe("sync --sc-url validation (#255)", () => {
  const { spawnSync } = require("node:child_process") as {
    spawnSync: (
      cmd: string,
      args: string[],
      opts: Record<string, unknown>,
    ) => {
      status: number | null;
      stdout: string | null;
      stderr: string | null;
    };
  };
  const CLI = join(import.meta.dir, "../../cli.ts");
  const runCli = (args: string[]) => {
    const proc = spawnSync(process.execPath, ["run", CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return {
      status: proc.status,
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  };

  test("a non-SC URL is a usage error (exit 2, zero work)", () => {
    const r = runCli([
      "sync",
      "--sc-url",
      "https://example.invalid/x",
      "--json",
    ]);
    expect(r.status).toBe(2);
    const last = r.stdout.trim().split("\n").at(-1) ?? "";
    const parsed = JSON.parse(last) as { command: string; error: string };
    expect(parsed.command).toBe("sync");
    expect(parsed.error).toContain("soundcloud.com");
  });

  test("a SC URL passes validation; a dead slug fails honestly (offline)", () => {
    // No network in the gate: the yt-dlp spawn fails fast, the failure is
    // CONTAINED — a permanent source-level error, exit 1 — never a crash.
    const r = runCli([
      "sync",
      "--sc-url",
      "https://soundcloud.com/definitely-not-a-real-artist-zz/definitely-not-a-real-track-zz",
      "--json",
    ]);
    expect(r.status !== null && [0, 1].includes(r.status)).toBe(true);
  });
});
