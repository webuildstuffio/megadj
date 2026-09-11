import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../archive/state";
import { tempState } from "../testutil";

/**
 * Regression for the Sep 10 2026 "mood analyzes nothing" bug: when
 * `--limit` was undefined, the analysis-queue copy step kept the SAME
 * array reference (`opts.limit === undefined ? needAnalysis : …`), and the
 * unconditional `needAnalysis.length = 0` that followed wiped the refill
 * source — so every flagless `megadj mood` run silently analyzed 0 tracks
 * (the `--limit N` path took `slice( + ` and worked, hiding the defect).
 *
 * The contract: pass 2 receives the tracks pass 1 enqueued (no file
 * stamp), for BOTH the flagged and flagless invocations. The test runs
 * without ONNX models or a mutagen-readable stamp — the fake file makes
 * groundTruth return mood=null, which is exactly the pass-2 enqueue path.
 */

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-mood-queue-test-");

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
});

function addDownloaded(videoId: string): string {
  const p = join(dir, `)${videoId}.mp3`);
  writeFileSync(p, "not audio — groundTruth reads no mood stamp from it");
  state.upsertTrackFromPlaylist(videoId, 1, "t");
  state.markDownloaded(videoId, {
    title: "t",
    artist: null,
    album: null,
    formatId: null,
    bitrateKbps: null,
    codec: null,
    filePath: p,
    fileSizeBytes: null,
    durationS: null,
  });
  return p;
}

describe("mood analysis queue (flagless no-op regression)", () => {
  test("undefined --limit still runs pass 2 on unstamped tracks", async () => {
    // Spy on the ONNX stage via its spawn seam: with the bug, pass 2 got
    // an empty queue and never attempted analysis at all. The probe
    // spawn is slow (uv env bootstrap), so cap the assertion at the
    // queue level instead: monkey-patch the exported analyzeMoods is not
    // possible (ESM live binding), so instead assert the *reported*
    // counters — the buggy run reported `failed: 0` (queue was empty,
    // loop never ran); a fixed run MUST report `failed: 3` (all three
    // unstamped fake files reached pass 2 and failed analysis there).
    const { mood } = await import("./mood");
    const paths = ["a", "b", "c"].map(addDownloaded);

    let captured = "";
    const origLog = console.log.bind(console);
    console.log = (msg: unknown) => {
      captured += `${String(msg)}\n`;
    };
    try {
      await mood({ state, musicDir: dir, json: false });
    } finally {
      console.log = origLog;
    }
    const summary = JSON.parse(captured.trim().split("\n").pop() ?? "{}") as {
      analyzed: number;
      failed: number;
      synced: number;
    };
    // the assertion that FAILS on the reference bug (failed=0, analyzed=0):
    // all 3 unstamped tracks must have REACHED pass 2
    expect(summary.failed).toBe(3);
    expect(summary.analyzed).toBe(0);
    const rows = state
      .allTracks()
      .filter((t) => paths.includes(t.file_path ?? ""));
    expect(rows.length).toBe(3);
  }, 60000); // the ONNX probe spawn (uv env bootstrap) needs more than bunfig's 15s

  test("queue refill preserves entries when limit is undefined (unit)", () => {
    // The exact defect, pinned at the data-structure level so the shape
    // of the fix is obvious: copy FIRST, then truncate the source.
    const needAnalysis = [1, 2, 3];
    const optsLimit = undefined;
    const analysisQueue = needAnalysis.slice(
      0,
      optsLimit === undefined ? needAnalysis.length : Math.max(0, optsLimit),
    );
    needAnalysis.length = 0;
    needAnalysis.push(...analysisQueue);
    expect(needAnalysis).toEqual([1, 2, 3]);

    // The buggy shape for contrast — same reference, wiped by the clear:
    const buggy = [1, 2, 3];
    const buggyQueue = optsLimit === undefined ? buggy : buggy.slice(0, 2);
    buggy.length = 0;
    buggy.push(...buggyQueue);
    expect(buggy).toEqual([]); // the silent no-op
  });
});
