/**
 * Shared test harness for the RB-closed guard topology pins
 * (#432/#494/#503). describeRbGuard renders one .kit.py corpus file and
 * generates the four standard posture tests — the commit posture is the
 * shared PY_RB_COMMIT_GUARD kit fragment (rb-script-kit.ts, not a
 * hand-rolled second copy), the pgrep recheck is the last gate before
 * the write, a lost race fails CLOSED (rollback, error JSON, exit 1),
 * and the WAL checkpoint is only reachable on the success path. The
 * callback adds the kit-specific mutation-ordering pins.
 *
 * jscpd #223 — extracted to cut 8 test-internal clones; #574 — the four
 * guard tests collapsed onto this factory.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderKitMarkers } from "../rb-command-kit";

const GUARD = '["pgrep", "-x", "rekordbox"]';

/** Lines spanning the rb_refuse_if_open + rb_guarded_commit definitions. */
function commitGuardRegion(scriptLines: string[]): string[] {
  const start = scriptLines.findIndex((l) => l.startsWith("def rb_refuse_if_open("));
  const guardDef = scriptLines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
  const end = scriptLines.findIndex((l, i) => i > guardDef && l.trimStart().startsWith("def "));
  return scriptLines.slice(start, end);
}

/**
 * Assert that between the pgrep recheck and the session commit, only
 * refusal-body lines, comments, and the `try:` opener may appear.
 */
function assertPgrepIsLastGate(region: string[]): void {
  const guardIdx = region.findIndex((l) => l.includes(GUARD));
  const commitIdx = region.findIndex((l) => l.includes("db.session.commit()"));
  expect(guardIdx).toBeGreaterThanOrEqual(0);
  expect(commitIdx).toBeGreaterThan(guardIdx);
  const between = region.slice(guardIdx + 1, commitIdx).filter((l) => {
    const t = l.trim();
    if (t === "" || t.startsWith("#") || t === "try:") return false;
    if (t === "def rb_guarded_commit(db):") return false;
    return !(
      l.includes("rb_refuse_if_open(db)") ||
      l.includes("rb_refuse_if_open(rbdb)") ||
      l.includes("rbdb.session.rollback()") ||
      l.includes("db.session.rollback()") ||
      l.includes("print(") ||
      l.includes("rbdb.close()") ||
      l.includes("db.close()") ||
      l.includes("sys.exit(1)")
    );
  });
  expect(between).toEqual([]);
}

/**
 * Assert the fragment's commit error path: except → rollback → error JSON → exit 1.
 */
function assertLostRaceFailsClosed(region: string[]): void {
  const commitIdx = region.findIndex((l) => l.includes("db.session.commit()"));
  const after = region.slice(commitIdx + 1);
  const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
  const rollbackIdx = after.findIndex((l) => l.includes("db.session.rollback()"));
  const errorIdx = after.findIndex((l) => l.includes('"error"'));
  const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
  expect(exceptIdx).toBeGreaterThanOrEqual(0);
  expect(rollbackIdx).toBeGreaterThan(exceptIdx);
  expect(after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== "")).toEqual([]);
  expect(errorIdx).toBeGreaterThan(rollbackIdx);
  expect(exitIdx).toBeGreaterThan(errorIdx);
}

/**
 * Assert WAL checkpoint only appears after every guarded commit call
 * and every sys.exit(1) — i.e. only reachable on the success path.
 */
function assertCheckpointSuccessOnly(lines: string[], callIndexes: number[]): void {
  const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
  expect(checkpointIdx).toBeGreaterThanOrEqual(0);
  for (const callIdx of callIndexes) {
    expect(checkpointIdx).toBeGreaterThan(callIdx);
  }
  lines.forEach((l, i) => {
    if (l.includes("sys.exit(1)")) expect(checkpointIdx).toBeGreaterThan(i);
  });
}

export interface RbGuardKit {
  /** Rendered kit source, split into lines. */
  lines: string[];
  /** Indexes of every exact trimmed-line occurrence of the guarded call. */
  callIndexes: number[];
}

export function describeRbGuard(
  kitFile: string,
  call: string,
  kitSpecificTests: (kit: RbGuardKit) => void,
): void {
  const lines = renderKitMarkers(
    readFileSync(join(import.meta.dir, "..", "rb-scripts", kitFile), "utf8"),
  ).split("\n");
  const callIndexes = lines.reduce<number[]>(
    (acc, l, i) => (l.trim() === call ? [...acc, i] : acc),
    [],
  );

  describe(`${kitFile} RB-closed gate (PY_RB_COMMIT_GUARD posture)`, () => {
    test("the commit posture is the shared kit fragment, not a hand-rolled copy", () => {
      expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
      expect(lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length).toBe(1);
      const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
      expect(sessionCommits.length).toBe(1);
      expect(sessionCommits[0]).toContain("db.session.commit()");
      const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
      expect(callIndexes.length).toBeGreaterThan(0);
      for (const callIdx of callIndexes) {
        expect(callIdx).toBeGreaterThan(defIdx);
      }
    });

    test("fragment: the pgrep recheck is the last gate before the write", () => {
      assertPgrepIsLastGate(commitGuardRegion(lines));
    });

    test("fragment: a lost race fails closed — rollback, error JSON, exit 1", () => {
      assertLostRaceFailsClosed(commitGuardRegion(lines));
    });

    test("the WAL checkpoint is only reachable on the success path", () => {
      assertCheckpointSuccessOnly(lines, callIndexes);
    });

    kitSpecificTests({ lines, callIndexes });
  });
}
