import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "../state";
import { RateLimiter } from "../ratelimit";
import { Downloader } from "../downloader";
import { sync, type SyncOptions } from "./sync";

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

/** Injected fetcher signature matches sync's fetchPlaylistFn. */
const fakeFetch = async () => [{ id: "v1", title: "Track One" }];

function baseOpts(
  state: ArchiveState,
  over: Partial<SyncOptions> = {},
): SyncOptions {
  return {
    state,
    limiter: new RateLimiter({ minIntervalMs: 0, baseBackoffMs: 0 }),
    musicDir: "/tmp/megadj-sync-test",
    cookiesFromBrowser: null,
    cookiesFile: null,
    sources: [{ id: "LM", label: "liked" }],
    fetchPlaylistFn: fakeFetch,
    onProgress: () => {}, // silence human logs in tests
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megadj-sync-test-"));
  state = new ArchiveState(join(dir, "archive.db"));
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("sync (GetDat pipeline)", () => {
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
      // Failure surfaces as a retryable error, not the permanent GONE mark.
      expect((e as Error).message).not.toBe("GONE");
    }
  }, 60_000);
});
