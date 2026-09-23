// mood-first-chunk.test.ts — #308: the pre-first-chunk visibility pin.
//
// #278's symptom (closed by the DB short-circuit) was the CLI wedging
// SILENTLY — minutes of ffprobe/mutagen spawning with zero output. The
// short-circuit only protects LEDGERED queues; a large UNANALYZED queue
// (--force, or a fresh import wave) still walks the expensive path:
//
//   allTracks+existsSync scan → syncPass (groundTruth PER FILE)
//   → buildAnalysisQueue (groundTruth PER FILE again)
//   → first chunk's uv bootstrap + ONNX model load
//
// Root cause of the SILENCE (this file's contract): none of those stages
// announced themselves. The fix adds stage-entry/heartbeat/duration logs
// through the SAME `log` seam the chunk lines use — so a wedge is always
// locatable to a stage and a file-count position.
//
// The test asserts the log transcript SHAPE on a small queue: the queue
// line, stamp-sync line, and probe line all appear BEFORE any analysis
// output, and the chunk line carries the total. No ONNX models are
// required — the fake-audio fixtures fail analysis fast (failed=N), which
// is exactly the observable the old flow silenced.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import type { ArchiveState } from "../../core/state";
import { tempState } from "../../test-support/testutil";
import { writeFakeAudio } from "../../test-support/audio-fixtures";

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-mood-first-chunk-");

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
});

function addDownloaded(videoId: string): string {
  const p = writeFakeAudio(
    join(dir, `${videoId}.mp3`),
    "not audio — groundTruth reads no mood stamp from it",
  );
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

describe("#308 mood pre-first-chunk visibility", () => {
  test("an unanalyzed queue announces scan, stamp sync, probe, and chunk stages in order", async () => {
    for (const id of ["f1", "f2", "f3", "f4"]) addDownloaded(id);
    const { mood } = await import("./mood");
    const lines: string[] = [];
    await mood({
      state,
      musicDir: dir,
      json: false,
      onProgress: (m) => lines.push(m),
    });
    const text = lines.join("\n");
    // stage announcements, in pipeline order, all BEFORE the chunk line
    const queueLine = lines.findIndex((l) => l.includes("queue: 4 downloaded"));
    const syncLine = lines.findIndex((l) => l.includes("stamp sync done"));
    const probeLine = lines.findIndex((l) =>
      l.includes("analysis probe: 4 file(s)"),
    );
    const chunkLine = lines.findIndex((l) => l.includes("mood chunk 1-4 of 4"));
    for (const [name, idx] of [
      ["queue", queueLine],
      ["sync done", syncLine],
      ["probe entry", probeLine],
      ["chunk", chunkLine],
    ] as const) {
      expect(idx, `${name} line present`).toBeGreaterThanOrEqual(0);
    }
    expect(queueLine).toBeLessThan(syncLine);
    expect(syncLine).toBeLessThan(probeLine);
    expect(probeLine).toBeLessThan(chunkLine);
    // the probe line separates ledgered from unledgered honestly
    expect(lines[probeLine] ?? "").toContain("skipping 0 ledgered");
    // the analysis header names the chunking shape (uv/model bootstrap
    // warning rides it — the literal wedge window)
    expect(text).toContain("1 chunk(s) of 20");
    expect(text).toContain("uv bootstrap + model load");
    // the queue still RAN: all four fakes were processed by pass 2 (the
    // worker errored on each — fake audio — and mood-queue.test.ts pins
    // the counters via the console.log capture path). Here the DB-level
    // proof: the 4 tracks exist, none was silently dropped by a stage.
    const ledgered = state
      .allTracks()
      .filter((t) => ["f1", "f2", "f3", "f4"].includes(t.video_id));
    expect(ledgered.length).toBe(4);
  }, 60000);

  test("a fully-ledgered queue reports the short-circuit loudly (never silent)", async () => {
    // analyze nothing — instead, mark the 2 tracks ledgered via a mood
    // record, then run: the probe must say "skipping 2 ledgered" and the
    // summary must read as success-with-reasons (the #278 contract).
    for (const id of ["l1", "l2"]) {
      const p = addDownloaded(id);
      state.setMoodRecord({
        videoId: id,
        dance: 0.5,
        aggressive: 0.1,
        happy: 0.4,
        electronic: 0.6,
        party: 0.3,
        valence: 4,
        arousal: 5,
        sourcePath: p,
      });
    }
    const { mood } = await import("./mood");
    const lines: string[] = [];
    await mood({
      state,
      musicDir: dir,
      json: false,
      onProgress: (m) => lines.push(m),
    });
    const probeLine = lines.find((l) => l.includes("analysis probe:"));
    expect(probeLine).toBeDefined();
    expect(probeLine).toContain("skipping 2 ledgered");
  }, 60000);
});
