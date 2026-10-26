/**
 * tag-fix-guard — #432 TOCTOU regression pin over tag-fix.kit.py (a
 * python corpus kit, so no same-stem TS subject exists — allowlisted in
 * test-placement-census). The RB-closed gate can never be fully atomic;
 * the pin enforces the strongest cheap posture: the pgrep recheck is the
 * LAST gate before the kit's only master.db write, and a commit that
 * loses the race fails CLOSED — rollback, error JSON, exit 1, and the
 * WAL checkpoint is only ever reachable on the success path. Since #494
 * the posture itself lives in the shared PY_RB_COMMIT_GUARD kit fragment
 * (rb-script-kit.ts) — these pins hold tag-fix on that SSOT (no
 * hand-rolled second copy) and pin the fragment's internal topology as
 * rendered into THIS kit.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderKitMarkers } from "./rb-command-kit";

const script = () =>
  renderKitMarkers(readFileSync(join(import.meta.dir, "rb-scripts", "tag-fix.kit.py"), "utf8"));

const GUARD = '["pgrep", "-x", "rekordbox"]';
const CALL = "rb_guarded_commit(rbdb)";

const commitGuardRegion = () => {
  const lines = script().split("\n");
  const start = lines.findIndex((l) => l.startsWith("def rb_refuse_if_open("));
  const guardDef = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
  const end = lines.findIndex((l, i) => i > guardDef && l.trimStart().startsWith("def "));
  return lines.slice(start, end);
};

describe("tag-fix.kit.py RB-closed gate (#432)", () => {
  test("the only master.db write is the shared guarded commit", () => {
    const lines = script().split("\n");
    // the posture is the kit fragment, not a hand-rolled copy
    expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
    expect(callIdx).toBeGreaterThan(defIdx);
  });

  test("fragment: the pgrep recheck is the last gate before the write", () => {
    const region = commitGuardRegion();
    const guardIdx = region.findIndex((l) => l.includes(GUARD));
    const commitIdx = region.findIndex((l) => l.includes("db.session.commit()"));
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(guardIdx);
    // Between the recheck and the write only the refusal body, comments,
    // and the opening `try:` may appear — any other statement re-opens
    // the TOCTOU window the guard exists to close.
    const between = region.slice(guardIdx + 1, commitIdx).filter((l) => {
      const t = l.trim();
      if (t === "" || t.startsWith("#") || t === "try:") return false;
      if (t === "def rb_guarded_commit(db):") return false;
      return !(
        l.includes("rb_refuse_if_open(db)") ||
        l.includes("db.session.rollback()") ||
        l.includes("print(") ||
        l.includes("db.close()") ||
        l.includes("sys.exit(1)")
      );
    });
    expect(between).toEqual([]);
  });

  test("every master.db mutation happens before the guarded commit, none after", () => {
    const lines = script().split("\n");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    const mutation = /c\.(Title|ArtistID|OrgArtistID)\s*=|session\.add\(/u;
    const lastMutation = lines.reduce((acc, l, i) => (mutation.test(l) ? i : acc), -1);
    expect(lastMutation).toBeGreaterThan(-1);
    expect(lastMutation).toBeLessThan(callIdx);
  });

  test("a lost race fails closed: rollback → error JSON → exit 1, no checkpoint", () => {
    const lines = script().split("\n");
    const region = commitGuardRegion();
    const commitIdx = region.findIndex((l) => l.includes("db.session.commit()"));
    const after = region.slice(commitIdx + 1);
    const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
    const rollbackIdx = after.findIndex((l) => l.includes("db.session.rollback()"));
    const errorIdx = after.findIndex((l) => l.includes('"error"'));
    const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
    // the commit's only neighbour is its except handler, which rolls back
    expect(exceptIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(exceptIdx);
    expect(after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== "")).toEqual([]);
    // failure surfaces the kit's {"error": ...} contract, then exits 1
    expect(errorIdx).toBeGreaterThan(rollbackIdx);
    expect(exitIdx).toBeGreaterThan(errorIdx);
    // success-only WAL checkpoint is unreachable from the failure path
    const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    expect(checkpointIdx).toBeGreaterThan(callIdx);
    expect(checkpointIdx).toBeGreaterThan(exitIdx);
  });
});
