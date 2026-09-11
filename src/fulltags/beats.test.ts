import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../archive/state";
import { beats } from "./beats";
import { tempState } from "../testutil";

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-beats-test-");

beforeEach(() => {
  ({ dir, state } = ts.next());
});

afterEach(() => {
  ts.done({ dir, state });
});

function seedDownloaded(id: string, title: string): string {
  const p = join(dir, `${title}.wav`);
  writeFileSync(p, "audio");
  state.upsertTrackFromPlaylist(id, 0, title);
  state.markDownloaded(id, {
    title,
    artist: null,
    album: null,
    formatId: null,
    bitrateKbps: 256,
    codec: "wav",
    filePath: p,
    fileSizeBytes: 5,
    durationS: 100,
  });
  return p;
}

/** The analysis path (analyzeBeats) is env-dependent (uv + torch env).
 * Instead of injecting seams into the command (none exist — it calls
 * fulltags' analyzeBeats directly), these tests pin the OBSERVABLE
 * contract around it: missing files are skipped-and-counted, ledger
 * idempotency excludes already-analyzed tracks, and the --json summary
 * parses. The env-gated live path is exercised by
 * fulltags/test/analysis.test.ts. */
describe("beats command (ledger, no tag writes)", () => {
  test("missing file counts as failed and writes no ledger row", async () => {
    state.upsertTrackFromPlaylist("m1", 0, "Ghost Track");
    state.markDownloaded("m1", {
      title: "Ghost Track",
      artist: null,
      album: null,
      formatId: null,
      bitrateKbps: 256,
      codec: "wav",
      filePath: join(dir, "Ghost Track.wav"),
      fileSizeBytes: 5,
      durationS: 100,
    });

    const logs: string[] = [];
    await beats({
      state,
      musicDir: dir,
      onProgress: (m) => logs.push(m),
    });

    expect(state.beatRecord("m1")).toBeNull();
    expect(logs.some((m) => m.includes("file missing"))).toBe(true);
    expect(logs.some((m) => m.includes("0 ledgered total"))).toBe(true);
  });

  test("already-ledgered tracks are skipped without --force", async () => {
    const p = seedDownloaded("m2", "Ledgered Track");
    state.setBeatRecord({
      videoId: "m2",
      bpmRaw: 128,
      bpmFolded: 128,
      beats: [0, 0.47],
      downbeats: [0],
      model: "beat-this@1.1.0",
      sourcePath: p,
    });
    const logs: string[] = [];
    await beats({
      state,
      musicDir: dir,
      onProgress: (m) => logs.push(m),
    });
    // nothing to do: queue was empty (the no-op run explains itself —
    // commit 6cad634 changed the zero-work message)
    expect(
      logs.some((m) =>
        m.startsWith(
          "beats: all 1 downloaded tracks are already ledgered — nothing to analyze",
        ),
      ),
    ).toBe(true);
    // record untouched
    expect(state.beatRecord("m2")?.bpmRaw).toBeCloseTo(128);
  });

  // .timeout(60000): this seed has a real (5-byte) file, so the command
  // invokes analyzeBeats → `uv run --with beat-this` (~2 GB torch env
  // resolution). Even a warm uv cache takes 5–15s before returning null
  // (invalid audio) — past bun's 5s default. The other tests in this file
  // never reach the spawn (missing file / empty queue), so only this one
  // needs the allowance.
  test("--json summary is a single parseable object with promised counters", async () => {
    seedDownloaded("m3", "Json Track");
    const stdout: string[] = [];
    const origLog = console.log;
    console.log = (m: string) => stdout.push(m); // capture the P1 stdout channel
    try {
      await beats({
        state,
        musicDir: dir,
        json: true,
        onProgress: () => {}, // human lines go to stderr in json mode
      });
    } finally {
      console.log = origLog;
    }
    // Exactly one stdout line, and it's the summary object (P1).
    expect(stdout.length).toBe(1);
    const parsed = JSON.parse(stdout[0]!) as Record<string, unknown>;
    expect(parsed.command).toBe("beats");
    expect(typeof parsed.analyzed).toBe("number");
    expect(typeof parsed.failed).toBe("number");
    expect(typeof parsed.ledgered).toBe("number");
  }, 60_000);
});
