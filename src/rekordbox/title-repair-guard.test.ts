/**
 * title-repair-guard — #503 (#494 remainder) TOCTOU regression pin over
 * title-repair.kit.py (a python corpus kit, so no same-stem TS subject
 * exists — allowlisted in test-placement-census). Pre-#503 the kit had a
 * hand-rolled commit-time pgrep gate but a fail-OPEN commit: the
 * exception was swallowed into out["errors"], the summary still printed,
 * the WAL checkpoint still ran, and the exit stayed 0. The pin holds the
 * kit on the shared PY_RB_COMMIT_GUARD fragment (rb-script-kit.ts): the
 * pgrep recheck is the last gate before the only master.db commit, a
 * lost race fails CLOSED (rollback, error JSON, exit 1), and the WAL
 * checkpoint is only reachable on the success path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderKitMarkers } from "./rb-command-kit";

const script = () =>
  renderKitMarkers(
    readFileSync(
      join(import.meta.dir, "rb-scripts", "title-repair.kit.py"),
      "utf8",
    ),
  );

const GUARD = '["pgrep", "-x", "rekordbox"]';
const CALL = "rb_guarded_commit(rbdb)";

const commitGuardRegion = () => {
  const lines = script().split("\n");
  const start = lines.findIndex((l) => l.startsWith("def rb_refuse_if_open("));
  const guardDef = lines.findIndex((l) =>
    l.startsWith("def rb_guarded_commit("),
  );
  const end = lines.findIndex(
    (l, i) => i > guardDef && l.trimStart().startsWith("def "),
  );
  return lines.slice(start, end);
};

describe("title-repair.kit.py RB-closed gate (#503, #494 class)", () => {
  test("the only master.db write is the shared guarded commit", () => {
    const lines = script().split("\n");
    // the posture is the kit fragment, not a hand-rolled copy
    expect(
      lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length,
    ).toBe(1);
    expect(
      lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length,
    ).toBe(1);
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const defIdx = lines.findIndex((l) =>
      l.startsWith("def rb_guarded_commit("),
    );
    expect(callIdx).toBeGreaterThan(defIdx);
  });

  test("fragment: the pgrep recheck is the last gate before the write", () => {
    const region = commitGuardRegion();
    const guardIdx = region.findIndex((l) => l.includes(GUARD));
    const commitIdx = region.findIndex((l) =>
      l.includes("db.session.commit()"),
    );
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

  test("every master.db mutation happens before the guarded commit", () => {
    const lines = script().split("\n");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    const mutationIdx = lines.findIndex((l) =>
      l.includes("c_obj.Title = new_t"),
    );
    expect(mutationIdx).toBeGreaterThan(-1);
    expect(mutationIdx).toBeLessThan(callIdx);
  });

  test("the hand-rolled fail-open commit is gone", () => {
    const s = script();
    // pre-#503: refusal printed the summary and exit stayed reachable
    // only via that gate; commit errors were swallowed into out["errors"]
    expect(s).not.toContain("rekordbox is running -- refusing write");
    expect(s).not.toContain('["commit", repr(e)');
  });

  test("a lost race fails closed: rollback → error JSON → exit 1, no checkpoint", () => {
    const lines = script().split("\n");
    const region = commitGuardRegion();
    const commitIdx = region.findIndex((l) =>
      l.includes("db.session.commit()"),
    );
    const after = region.slice(commitIdx + 1);
    const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
    const rollbackIdx = after.findIndex((l) =>
      l.includes("db.session.rollback()"),
    );
    const errorIdx = after.findIndex((l) => l.includes('"error"'));
    const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
    expect(exceptIdx).toBeGreaterThanOrEqual(0);
    // the commit's only neighbour is its except handler, which rolls back
    expect(rollbackIdx).toBeGreaterThan(exceptIdx);
    expect(
      after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== ""),
    ).toEqual([]);
    // failure surfaces the kit's {"error": ...} contract, then exits 1
    expect(errorIdx).toBeGreaterThan(rollbackIdx);
    expect(exitIdx).toBeGreaterThan(errorIdx);
    // success-only WAL checkpoint is unreachable from the failure path
    const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    expect(checkpointIdx).toBeGreaterThan(callIdx);
    lines.forEach((l, i) => {
      if (l.includes("sys.exit(1)")) expect(checkpointIdx).toBeGreaterThan(i);
    });
  });
});
