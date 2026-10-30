// mood-test-fixtures.ts — shared mood-suite fixture (#580): a tempState
// archive wired through beforeEach/afterEach plus an addDownloaded()
// builder that plants a fake audio file and its ledger row — the exact
// "downloaded but unstamped" shape mood-first-chunk.test.ts and
// mood-queue.test.ts pin against (analysis fails fast on the fake bytes,
// so no ONNX models are needed).
import { afterEach, beforeEach } from "bun:test";
import { join } from "node:path";
import type { ArchiveState } from "../../core/state";
import { tempState } from "../../test-support/testutil";
import { writeFakeAudio } from "../../test-support/audio-fixtures";

export function moodFixture(prefix: string) {
  const ts = tempState(prefix);
  let dir = "";
  let state: ArchiveState | undefined;

  beforeEach(() => {
    ({ dir, state } = ts.next());
  });

  afterEach(() => {
    if (state !== undefined) ts.done({ dir, state });
  });

  return {
    get dir() {
      return dir;
    },
    get state() {
      return state!;
    },
    addDownloaded(videoId: string): string {
      const p = writeFakeAudio(
        join(dir, `${videoId}.mp3`),
        "not audio — groundTruth reads no mood stamp from it",
      );
      state!.upsertTrackFromPlaylist(videoId, 1, "t");
      state!.markDownloaded(videoId, {
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
    },
  };
}
