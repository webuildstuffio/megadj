/**
 * tag-fix-guard — #432 TOCTOU regression pin over tag-fix.kit.py (a
 * python corpus kit, so no same-stem TS subject exists — allowlisted in
 * test-placement-census). The RB-closed gate can never be fully atomic;
 * the pin enforces the strongest cheap posture: the pgrep recheck is the
 * LAST gate before the kit's only master.db write, and a commit that
 * loses the race fails CLOSED — rollback, error JSON, exit 1, and the
 * WAL checkpoint is only ever reachable on the success path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderKitMarkers } from "./rb-command-kit";

const script = () =>
  renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", "tag-fix.kit.py"), "utf8"),
  );

const GUARD = '["pgrep", "-x", "rekordbox"]';

describe("tag-fix.kit.py RB-closed gate (#432)", () => {
  test("exactly one master.db write, guarded as the last gate before it", () => {
    const lines = script().split("\n");
    const commits = lines.filter((l) => l.includes("rbdb.session.commit()"));
    expect(commits.length).toBe(1);
    const guardIdx = lines.findIndex((l) => l.includes(GUARD));
    const commitIdx = lines.findIndex((l) =>
      l.includes("rbdb.session.commit()"),
    );
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(guardIdx);
    // Between the recheck and the write only the refusal body, comments,
    // and the opening `try:` may appear — any other statement re-opens
    // the TOCTOU window the guard exists to close.
    const between = lines.slice(guardIdx + 1, commitIdx).filter((l) => {
      const t = l.trim();
      if (t === "" || t.startsWith("#") || t === "try:") return false;
      return !(
        l.includes("rbdb.session.rollback()") ||
        l.includes("print(") ||
        l.includes("rbdb.close()") ||
        l.includes("sys.exit(1)")
      );
    });
    expect(between).toEqual([]);
  });

  test("every master.db mutation happens before the recheck, none after", () => {
    const lines = script().split("\n");
    const guardIdx = lines.findIndex((l) => l.includes(GUARD));
    const mutation = /c\.(Title|ArtistID|OrgArtistID)\s*=|session\.add\(/u;
    const lastMutation = lines.reduce(
      (acc, l, i) => (mutation.test(l) ? i : acc),
      -1,
    );
    expect(lastMutation).toBeGreaterThan(-1);
    expect(lastMutation).toBeLessThan(guardIdx);
  });

  test("a lost race fails closed: rollback → error JSON → exit 1, no checkpoint", () => {
    const lines = script().split("\n");
    const commitIdx = lines.findIndex((l) =>
      l.includes("rbdb.session.commit()"),
    );
    const after = lines.slice(commitIdx + 1);
    const exceptIdx = after.findIndex((l) => l.trim().startsWith("except"));
    const rollbackIdx = after.findIndex((l) =>
      l.includes("rbdb.session.rollback()"),
    );
    const errorIdx = after.findIndex((l) => l.includes('"error"'));
    const exitIdx = after.findIndex((l) => l.includes("sys.exit(1)"));
    const checkpointIdx = lines.findIndex((l) => l.includes("wal_checkpoint"));
    // the commit's only neighbour is its except handler, which rolls back
    expect(exceptIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(exceptIdx);
    expect(
      after.slice(exceptIdx + 1, rollbackIdx).filter((l) => l.trim() !== ""),
    ).toEqual([]);
    // failure surfaces the kit's {"error": ...} contract, then exits 1
    expect(errorIdx).toBeGreaterThan(rollbackIdx);
    expect(exitIdx).toBeGreaterThan(errorIdx);
    // success-only WAL checkpoint is unreachable from the failure path
    expect(checkpointIdx).toBeGreaterThan(exitIdx);
  });
});
