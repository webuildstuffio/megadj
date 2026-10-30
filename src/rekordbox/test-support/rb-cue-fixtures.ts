// rb-cue-fixtures.ts — shared mock seam for the rb-cues / rb-comment-sync
// suites (#576): one runtime factory, one two-phase spawn stub, and the
// wire-payload factories for the two apply summaries.
import type { RbCommandResult, RbCommandRuntime } from "../rb-command-kit.js";

/** Runtime seam: the full RbCommandRuntime plus comment-sync's `exists`,
 *  green-path defaults; spread overrides in. */
type FakeRbRuntime = RbCommandRuntime & { exists: (path: string) => boolean };

type FakeRbRuntimeOverrides = Partial<RbCommandRuntime> & {
  exists?: (path: string) => boolean;
};

export function fakeRbRuntime(overrides: FakeRbRuntimeOverrides = {}): FakeRbRuntime {
  return {
    exists: () => true,
    fileExists: () => true,
    assertClosed: () => {},
    backup: () => "/tmp/master.db.bak",
    restore: () => {},
    sleep: () => {},
    spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    ...overrides,
  };
}

/** Spawn stub answering `outputs[i]` on the i-th call (the last entry
 *  repeats) — models the write-then-verify two-spawn shape of the rb-*
 *  apply paths. `callCount()` pins how many spawns actually ran. */
type SequentialSpawn = RbCommandRuntime["spawn"] & { callCount: () => number };

export function sequentialSpawn(outputs: string[]): SequentialSpawn {
  let call = 0;
  const spawn = (): RbCommandResult => {
    call++;
    return {
      status: 0,
      stdout: outputs[Math.min(call, outputs.length) - 1] ?? "",
      stderr: "",
    };
  };
  return Object.assign(spawn, { callCount: () => call });
}

/** comment-sync.kit.py apply summary — the wire shape parseSyncOutput
 *  guards (snake_case optional counters are spread on by callers). */
export interface CommentSyncWireOutput {
  scanned: number;
  eligible: number;
  written: number;
  alreadyHad: number;
  skipped: [string, string][];
  samples: [string, string][];
  writes: [string, string][];
  errors: [string, string][];
}

export function commentSyncOutput(
  overrides: Partial<CommentSyncWireOutput> = {},
): CommentSyncWireOutput {
  return {
    scanned: 1,
    eligible: 1,
    written: 1,
    alreadyHad: 0,
    skipped: [],
    samples: [],
    writes: [["42", "11A · E8.8 · Dance"]],
    errors: [],
    ...overrides,
  };
}

/** cue-restamp.kit.py summary — the wire shape parseRestampOutput guards. */
export interface RestampWireOutput {
  found: number;
  written: number;
  protected: number;
  written_ids: string[];
  errors: [string, string][];
}

export function restampOutput(overrides: Partial<RestampWireOutput> = {}): RestampWireOutput {
  return { found: 1, written: 1, protected: 0, written_ids: ["42"], errors: [], ...overrides };
}
