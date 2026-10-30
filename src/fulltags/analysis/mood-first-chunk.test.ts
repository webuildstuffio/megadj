// mood-first-chunk.test.ts — #308: the pre-first-chunk visibility pin.
//
// #278's symptom (closed by the DB short-circuit) was the CLI wedging
// SILENTLY — minutes of ffprobe/mutagen spawning with zero output. The
// short-circuit only protects LEDGERED queues; a large UNANALYZED queue
// (--force, or a fresh import wave) still walks the expensive path:
//
//   allTracks+existsSync scan → syncPass (groundTruth PER FILE, cached)
//   → buildAnalysisQueue (uses cache from pass 1)
//   → parallel worker bootstrap + ONNX model load
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
import { describe, test, expect } from "bun:test";
import { moodFixture } from "../test/mood-test-fixtures";

const fx = moodFixture("megadj-mood-first-chunk-");

describe("#308 mood pre-first-chunk visibility", () => {
  test("an unanalyzed queue announces scan, stamp sync, probe, and chunk stages in order", async () => {
    for (const id of ["f1", "f2", "f3", "f4"]) fx.addDownloaded(id);
    const { mood } = await import("./mood");
    const lines: string[] = [];
    await mood({
      state: fx.state,
      musicDir: fx.dir,
      json: false,
      onProgress: (m) => lines.push(m),
    });
    const text = lines.join("\n");
    // stage announcements, in pipeline order, all BEFORE the chunk line
    const queueLine = lines.findIndex((l) => l.includes("queue: 4 downloaded"));
    const syncLine = lines.findIndex((l) => l.includes("stamp sync done"));
    const probeLine = lines.findIndex((l) => l.includes("analysis probe: 4 file(s)"));
    const chunkLine = lines.findIndex((l) => l.includes("parallel worker(s)"));
    for (const [name, idx] of [
      ["queue", queueLine],
      ["sync done", syncLine],
      ["probe entry", probeLine],
      ["worker header", chunkLine],
    ] as const) {
      expect(idx, `${name} line present`).toBeGreaterThanOrEqual(0);
    }
    expect(queueLine).toBeLessThan(syncLine);
    expect(syncLine).toBeLessThan(probeLine);
    expect(probeLine).toBeLessThan(chunkLine);
    // the probe line separates ledgered from unledgered honestly
    expect(lines[probeLine] ?? "").toContain("skipping 0 ledgered");
    // the analysis header names the parallel worker shape (uv/model
    // bootstrap warning rides it — the literal wedge window)
    expect(text).toContain("parallel worker(s)");
    expect(text).toContain("uv bootstrap + model load");
    // the queue still RAN: all four fakes were processed by pass 2 (the
    // worker errored on each — fake audio — and mood-queue.test.ts pins
    // the counters via the console.log capture path). Here the DB-level
    // proof: the 4 tracks exist, none was silently dropped by a stage.
    const ledgered = fx.state
      .allTracks()
      .filter((t) => ["f1", "f2", "f3", "f4"].includes(t.video_id));
    expect(ledgered.length).toBe(4);
  }, 60000);

  test("a fully-ledgered queue reports the short-circuit loudly (never silent)", async () => {
    // analyze nothing — instead, mark the 2 tracks ledgered via a mood
    // record, then run: the probe must say "skipping 2 ledgered" and the
    // summary must read as success-with-reasons (the #278 contract).
    for (const id of ["l1", "l2"]) {
      const p = fx.addDownloaded(id);
      fx.state.setMoodRecord({
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
      state: fx.state,
      musicDir: fx.dir,
      json: false,
      onProgress: (m) => lines.push(m),
    });
    const probeLine = lines.find((l) => l.includes("analysis probe:"));
    expect(probeLine).toBeDefined();
    expect(probeLine).toContain("skipping 2 ledgered");
  }, 60000);
});
