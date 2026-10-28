/**
 * album-push-guard — #494/#432 TOCTOU regression pin over
 * album-push.kit.py (a python corpus kit, so no same-stem TS subject
 * exists — allowlisted in test-placement-census). The kit has TWO
 * mutating surfaces: the per-album djmdAlbum INSERT committed inside the
 * loop, and the final session commit for AlbumID assignments. The pin
 * enforces the #432 posture on both: an RB-closed recheck as the last
 * gate immediately before each mutating commit, and a commit that loses
 * the race fails CLOSED — rollback, error JSON, exit 1 — with the WAL
 * checkpoint only ever reachable on the success path.
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
  renderKitMarkers(readFileSync(join(import.meta.dir, "rb-scripts", "album-push.kit.py"), "utf8"));

describe("album-push.kit.py RB-closed gate (#494, #432 class)", () => {
  test("the commit posture is the shared kit fragment, not a hand-rolled copy", () => {
    const lines = script().split("\n");
    expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length).toBe(1);
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const callIdx = lines.findIndex((l) => l.trim() === "rb_guarded_commit(rbdb)");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
    expect(callIdx).toBeGreaterThan(defIdx);
  });

  test("fragment: the pgrep recheck is the last gate before the session commit", () => {
    assertPgrepIsLastGate(commitGuardRegion(script().split("\n")));
  });

  test("fragment: a lost race fails closed — rollback, error JSON, exit 1", () => {
    assertLostRaceFailsClosed(commitGuardRegion(script().split("\n")));
  });

  test("every djmdAlbum INSERT is rechecked immediately before it", () => {
    const lines = script().split("\n");
    const inserts = lines.reduce<number[]>(
      (acc, l, i) => (l.includes("INSERT INTO djmdAlbum") ? [...acc, i] : acc),
      [],
    );
    expect(inserts.length).toBeGreaterThan(0);
    const refuseIdx = lines.findIndex((l) => l.trim() === "rb_refuse_if_open(rbdb)");
    expect(refuseIdx).toBeGreaterThanOrEqual(0);
    expect(refuseIdx).toBeLessThan(inserts[0] ?? -1);
    const withIdx = lines.findIndex((l) => l.includes("with rbdb.engine.connect()"));
    expect(withIdx).toBeGreaterThan(refuseIdx);
    const between = lines.slice(refuseIdx + 1, withIdx).filter((l) => {
      const t = l.trim();
      return !(t === "" || t.startsWith("#") || t === "try:");
    });
    expect(between).toEqual([]);
  });

  test("a lost INSERT race fails closed: rollback → error JSON → exit 1", () => {
    const lines = script().split("\n");
    const commitIdx = lines.findIndex((l) => l.includes("conn.commit()"));
    const after = lines.slice(commitIdx + 1);
    const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
    const rollbackIdx = after.findIndex((l) => l.includes("rbdb.session.rollback()"));
    const errorIdx = after.findIndex((l) => l.includes('"error"'));
    const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
    expect(exceptIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(exceptIdx);
    expect(after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== "")).toEqual([]);
    expect(errorIdx).toBeGreaterThan(rollbackIdx);
    expect(exitIdx).toBeGreaterThan(errorIdx);
  });

  test("the WAL checkpoint is only reachable on the success path", () => {
    const lines = script().split("\n");
    const callIdx = lines.findIndex((l) => l.trim() === "rb_guarded_commit(rbdb)");
    assertCheckpointSuccessOnly(lines, [callIdx]);
  });
});
