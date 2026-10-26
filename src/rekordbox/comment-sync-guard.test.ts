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

const script = () =>
  renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", "comment-sync.kit.py"), "utf8"),
  );

const GUARD = '["pgrep", "-x", "rekordbox"]';
const CALL = "rb_guarded_commit(db)";

const commitGuardRegion = () => {
  const lines = script().split("\n");
  const start = lines.findIndex((l) => l.startsWith("def rb_refuse_if_open("));
  const guardDef = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
  const end = lines.findIndex((l, i) => i > guardDef && l.trimStart().startsWith("def "));
  return lines.slice(start, end);
};

const callIndexes = (lines: string[]) =>
  lines.reduce<number[]>((acc, l, i) => (l.trim() === CALL ? [...acc, i] : acc), []);

describe("comment-sync.kit.py RB-closed gate (#503, #494 class)", () => {
  test("the commit posture is the shared kit fragment, not hand-rolled copies", () => {
    const lines = script().split("\n");
    expect(lines.filter((l) => l.startsWith("def rb_guarded_commit(")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("def rb_refuse_if_open(")).length).toBe(1);
    // the only session commit in the program lives inside the fragment
    const sessionCommits = lines.filter((l) => l.includes(".session.commit()"));
    expect(sessionCommits.length).toBe(1);
    expect(sessionCommits[0]).toContain("db.session.commit()");
    const defIdx = lines.findIndex((l) => l.startsWith("def rb_guarded_commit("));
    for (const callIdx of callIndexes(lines)) {
      expect(callIdx).toBeGreaterThan(defIdx);
    }
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

  test("every phase commit is guarded, in phase order, mutations first", () => {
    const lines = script().split("\n");
    const calls = callIndexes(lines);
    // comment, genre, color, mytag categories, mytag assign
    expect(calls.length).toBe(5);
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    const checkpointIdx = at("wal_checkpoint");
    expect(checkpointIdx).toBeGreaterThanOrEqual(0);
    // strictly increasing: each phase's mutations land before its own
    // guarded commit, and no phase's commit precedes an earlier phase
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
    // pre-#503 each phase caught its commit error into out["errors"]
    // and the run continued — a lost race never failed the spawn
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
    const region = commitGuardRegion();
    const commitIdx = region.findIndex((l) => l.includes("db.session.commit()"));
    const after = region.slice(commitIdx + 1);
    const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
    const rollbackIdx = after.findIndex((l) => l.includes("db.session.rollback()"));
    const errorIdx = after.findIndex((l) => l.includes('"error"'));
    const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
    expect(exceptIdx).toBeGreaterThanOrEqual(0);
    // the commit's only neighbour is its except handler, which rolls back
    expect(rollbackIdx).toBeGreaterThan(exceptIdx);
    expect(after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== "")).toEqual([]);
    // failure surfaces the kit's {"error": ...} contract, then exits 1
    expect(errorIdx).toBeGreaterThan(rollbackIdx);
    expect(exitIdx).toBeGreaterThan(errorIdx);
    // success-only WAL checkpoint sits after every guarded commit and
    // after every failure exit in the program
    const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
    for (const callIdx of callIndexes(lines)) {
      expect(checkpointIdx).toBeGreaterThan(callIdx);
    }
    lines.forEach((l, i) => {
      if (l.includes("sys.exit(1)")) expect(checkpointIdx).toBeGreaterThan(i);
    });
  });
});
