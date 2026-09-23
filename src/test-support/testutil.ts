/**
 * testutil — shared temp-dir + ArchiveState scaffolding for tests that
 * need a fresh on-disk state DB (#248). Every command test carried a
 * byte-identical beforeEach/afterEach pair; this keeps the standard
 * module-level `dir`/`state` bindings working while owning the lifecycle.
 *
 * tempDir (#248) is the dir-only shape: the fixture-prefix + teardown
 * convention in one place, with a per-file registry (`t.rippable()`)
 * so a file's `afterAll(() => t.rippleAll())` can never leak — the
 * #236 class (12.5 GB of `cratedeck-hashcancel-*` staging) died here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchiveState } from "../core/state";

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

/**
 * stateIn — the explicit-dir variant (#248): open an ArchiveState at
 * `join(dir, name)` for tests that own the dir lifecycle through
 * tempDir but need the DB path/nameshape tempState's fixed `archive.db`
 * binding can't express (a second DB, a per-call helper, a named file).
 * The construction still goes through the seam — raw `new ArchiveState`
 * in a test file is a census failure.
 */
export function stateIn(dir: string, name = "archive.db"): ArchiveState {
  return new ArchiveState(join(dir, name));
}

/**
 * tempDir — the dir-only fixture shape (#248): every
 * `mkdtempSync("/tmp/megadj-X-")` + hand `rmSync` pair collapses to
 * `const t = tempDir("megadj-X-")` + `t.dir`. Two lifecycle modes:
 *
 *   1. explicit — `t.dispose()` in the test/afterEach that owns it
 *      (the mirror of tempState's `done`), and
 *   2. rippled — call `t.rippable()` right after creating the handle
 *      and put `afterAll(() => t.rippleAll())` at the top of the file;
 *      every dir registered on the handle is removed at suite end even
 *      when an individual test forgot (the #236 leak class).
 *
 * The prefix stays caller-owned on purpose: the tmp-purge families
 * (FIXTURE_PREFIXES) key on the prefix, so "megadj-X-" naming must
 * survive the migration visible.
 */
export interface TempDirHandle {
  /** The fresh dir. Each call makes a NEW dir. */
  dir: () => string;
  /** Register the most recent dir for rippleAll disposal. */
  rippable: () => TempDirHandle;
  /** Remove every rippled dir so far (idempotent, force:true). */
  rippleAll: () => void;
  /** Dispose ONE dir (the path given) right now. */
  dispose: (dir: string) => void;
}

/** Remove a fixture dir tree (force:true) — shared by dispose/ripple. */
const rip = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

export function tempDir(prefix: string): TempDirHandle {
  const made: string[] = [];
  const handle: TempDirHandle = {
    dir: () => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      made.push(dir);
      return dir;
    },
    rippable: () => handle,
    rippleAll: () => {
      while (made.length) rip(made.pop()!);
    },
    dispose: rip,
  };
  return handle;
}
