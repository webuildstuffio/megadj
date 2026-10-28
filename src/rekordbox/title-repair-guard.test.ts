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
import {
  assertCheckpointSuccessOnly,
  assertLostRaceFailsClosed,
  assertPgrepIsLastGate,
  commitGuardRegion,
} from "./test-support/rb-guard-assertions";

const script = () =>
  renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", "title-repair.kit.py"), "utf8"),
  );

const CALL = "rb_guarded_commit(rbdb)";

describe("title-repair.kit.py RB-closed gate (#503, #494 class)", () => {
  test("the only master.db write is the shared guarded commit", () => {
    const lines = script().split("\n");
    expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length).toBe(1);
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
    expect(callIdx).toBeGreaterThan(defIdx);
  });

  test("fragment: the pgrep recheck is the last gate before the write", () => {
    assertPgrepIsLastGate(commitGuardRegion(script().split("\n")));
  });

  test("every master.db mutation happens before the guarded commit", () => {
    const lines = script().split("\n");
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    const mutationIdx = lines.findIndex((l) => l.includes("c_obj.Title = new_t"));
    expect(mutationIdx).toBeGreaterThan(-1);
    expect(mutationIdx).toBeLessThan(callIdx);
  });

  test("the hand-rolled fail-open commit is gone", () => {
    const s = script();
    expect(s).not.toContain("rekordbox is running -- refusing write");
    expect(s).not.toContain('["commit", repr(e)');
  });

  test("a lost race fails closed: rollback → error JSON → exit 1, no checkpoint", () => {
    const lines = script().split("\n");
    assertLostRaceFailsClosed(commitGuardRegion(lines));
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    assertCheckpointSuccessOnly(lines, [callIdx]);
  });
});
