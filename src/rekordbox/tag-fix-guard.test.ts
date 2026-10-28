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
import {
  assertCheckpointSuccessOnly,
  assertLostRaceFailsClosed,
  assertPgrepIsLastGate,
  commitGuardRegion,
} from "./test-support/rb-guard-assertions";

const script = () =>
  renderKitMarkers(readFileSync(join(import.meta.dir, "rb-scripts", "tag-fix.kit.py"), "utf8"));

const CALL = "rb_guarded_commit(rbdb)";

describe("tag-fix.kit.py RB-closed gate (#432)", () => {
  test("the only master.db write is the shared guarded commit", () => {
    const lines = script().split("\n");
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
    assertPgrepIsLastGate(commitGuardRegion(script().split("\n")));
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
    assertLostRaceFailsClosed(commitGuardRegion(lines));
    const callIdx = lines.findIndex((l) => l.trim() === CALL);
    assertCheckpointSuccessOnly(lines, [callIdx]);
  });
});
