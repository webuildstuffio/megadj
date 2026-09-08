/**
 * testutil — shared temp-dir + ArchiveState scaffolding for tests that
 * need a fresh on-disk state DB. Every command test carried a byte-identical
 * beforeEach/afterEach pair; this keeps the standard module-level
 * `dir`/`state` bindings working while owning the lifecycle.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "./state";

/** Registers before/after hooks around the current test file. The test
 * file keeps its own `let dir: string; let state: ArchiveState;` and
 * assigns from the returned values inside the hooks it registers first —
 * or, simpler, uses the bound ref object directly:
 *
 *   const ts = tempState("megadj-enrich-test-");
 *   let dir: string; let state: ArchiveState;
 *   beforeEach(() => { ({ dir, state } = ts.next()); });
 */
export function tempState(prefix: string): {
  /** Create the fresh dir + state; spread into the file's bindings. */
  next: () => { dir: string; state: ArchiveState };
  /** Tear down (close the DB, rm the dir) — pass straight to afterEach. */
  done: (s: { dir: string; state: ArchiveState }) => void;
} {
  return {
    next: () => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      return { dir, state: new ArchiveState(join(dir, "archive.db")) };
    },
    done: (s) => {
      s.state.close();
      rmSync(s.dir, { recursive: true, force: true });
    },
  };
}
