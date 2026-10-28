/**
 * comment-sync-guard — #503 (#494 remainder) TOCTOU regression pin over
 * comment-sync.kit.py (a python corpus kit, so no same-stem TS subject
 * exists — allowlisted in test-placement-census). The kit commits in
 * five phases (comment, genre, color, mytag categories, mytag assign).
 * Pre-#503 only the comment phase rechecked RB-closed before its commit;
 * the four later-phase commits were bare session commits whose errors
 * were swallowed into out["errors"] while the run continued and exited
 * 0. The pin holds EVERY phase commit on the shared PY_RB_COMMIT_GUARD
 * fragment (rb-script-kit.ts): a late pgrep recheck as the last gate
 * before each commit, fail-closed on a lost race (rollback, error JSON,
 * exit 1), and the WAL checkpoint only reachable on the success path.
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
    readFileSync(join(import.meta.dir, "rb-scripts", "comment-sync.kit.py"), "utf8"),
  );

const CALL = "rb_guarded_commit(db)";

const callIndexes = (lines: string[]) =>
  lines.reduce<number[]>((acc, l, i) => (l.trim() === CALL ? [...acc, i] : acc), []);

describe("comment-sync.kit.py RB-closed gate (#503, #494 class)", () => {
  test("the commit posture is the shared kit fragment, not hand-rolled copies", () => {
    const lines = script().split("\n");
    expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length).toBe(1);
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
    for (const callIdx of callIndexes(lines)) {
      expect(callIdx).toBeGreaterThan(defIdx);
    }
  });

  test("fragment: the pgrep recheck is the last gate before the write", () => {
    assertPgrepIsLastGate(commitGuardRegion(script().split("\n")));
  });

  test("every phase commit is guarded, in phase order, mutations first", () => {
    const lines = script().split("\n");
    const calls = callIndexes(lines);
    expect(calls.length).toBe(5);
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    const checkpointIdx = at("wal_checkpoint");
    expect(checkpointIdx).toBeGreaterThanOrEqual(0);
    const chain = [
      at("c.Commnt = comment"),
      calls[0] ?? -1,
      at("c.GenreID = genre_row.ID"),
      calls[1] ?? -1,
      at("c.ColorID = target_color"),
      calls[2] ?? -1,
      at("db.session.add(new_cat)"),
      calls[3] ?? -1,
      at("db.session.add(new_smt)"),
      calls[4] ?? -1,
      checkpointIdx,
    ];
    for (const idx of chain) expect(idx).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i] ?? -1).toBeGreaterThan(chain[i - 1] ?? -1);
    }
  });

  test("the swallowed per-phase commit errors are gone", () => {
    const s = script();
    for (const label of [
      '"transaction"',
      '"genre-sync"',
      '"color-sync"',
      '"mytag-categories"',
      '"mytag-assign"',
    ]) {
      expect(s).not.toContain(`[${label},`);
    }
  });

  test("a lost race fails closed: rollback → error JSON → exit 1, no checkpoint", () => {
    const lines = script().split("\n");
    assertLostRaceFailsClosed(commitGuardRegion(lines));
    assertCheckpointSuccessOnly(lines, callIndexes(lines));
  });
});
