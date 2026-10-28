/**
 * Shared test harness for the RB-closed guard topology pins
 * (#432/#494/#503). Extracts the common commitGuardRegion helper
 * and the pgrep/lost-race/checkpoint assertions used across
 * tag-fix, title-repair, album-push, and comment-sync guard tests.
 *
 * jscpd #223 — extracted to cut 8 test-internal clones.
 */
import { expect } from "bun:test";

export const GUARD = '["pgrep", "-x", "rekordbox"]';

/** Lines spanning the rb_refuse_if_open + rb_guarded_commit definitions. */
export function commitGuardRegion(scriptLines: string[]): string[] {
  const start = scriptLines.findIndex((l) => l.startsWith("def rb_refuse_if_open("));
  const guardDef = scriptLines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
  const end = scriptLines.findIndex((l, i) => i > guardDef && l.trimStart().startsWith("def "));
  return scriptLines.slice(start, end);
}

/**
 * Assert that between the pgrep recheck and the session commit, only
 * refusal-body lines, comments, and the `try:` opener may appear.
 */
export function assertPgrepIsLastGate(region: string[]): void {
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
export function assertLostRaceFailsClosed(region: string[]): void {
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
export function assertCheckpointSuccessOnly(lines: string[], callIndexes: number[]): void {
  const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
  expect(checkpointIdx).toBeGreaterThanOrEqual(0);
  for (const callIdx of callIndexes) {
    expect(checkpointIdx).toBeGreaterThan(callIdx);
  }
  lines.forEach((l, i) => {
    if (l.includes("sys.exit(1)")) expect(checkpointIdx).toBeGreaterThan(i);
  });
}
