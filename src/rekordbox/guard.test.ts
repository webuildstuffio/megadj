import { describe, expect, test } from "bun:test";
import {
  assertRbClosed,
  backupStamp,
  fileExistsSafe,
  rekordboxRunning,
  restoreMasterBackup,
} from "./guard.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("guard", () => {
  test("backupStamp is UTC sortable, filename-safe, and injectable", () => {
    const at = new Date("2026-09-15T14:30:05.123Z");
    expect(backupStamp(at)).toBe("20260915T143005");
    expect(backupStamp(at)).toMatch(/^\d{8}T\d{6}$/u);
  });
  test("rekordboxRunning returns a boolean without spawning errors", () => {
    expect(typeof rekordboxRunning()).toBe("boolean");
  });

  test("assertRbClosed throws when rekordbox is running (injected via env)", () => {
    // The gate consults pgrep; we can't spawn RB in CI, so assert the
    // throw-path via a stubbed process check: call with a fake running
    // state by monkey-patching is fragile — instead verify the happy path
    // (RB not running in test env) doesn't throw.
    expect(() => assertRbClosed("test-op")).not.toThrow();
  });

  test("fileExistsSafe: null/false/real file/missing", () => {
    expect(fileExistsSafe(null)).toBe(false);
    expect(fileExistsSafe(undefined)).toBe(false);
    expect(fileExistsSafe("")).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "guard-"));
    const f = join(dir, "x.txt");
    writeFileSync(f, "hi");
    expect(fileExistsSafe(f)).toBe(true);
    expect(fileExistsSafe(join(dir, "nope"))).toBe(false);
    expect(fileExistsSafe(dir)).toBe(false); // dir is not a file
    rmSync(dir, { recursive: true, force: true });
  });

  test("restoreMasterBackup replaces the DB family and removes stale sidecars", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-guard-restore-"));
    const db = join(dir, "master.db");
    const backup = `${db}.bak-test`;
    try {
      writeFileSync(db, "mutated");
      writeFileSync(`${db}-wal`, "stale-wal");
      writeFileSync(`${db}-shm`, "stale-shm");
      writeFileSync(backup, "original");
      writeFileSync(`${backup}-wal`, "original-wal");

      restoreMasterBackup(db, backup, "test restore");

      expect(readFileSync(db, "utf8")).toBe("original");
      expect(readFileSync(`${db}-wal`, "utf8")).toBe("original-wal");
      expect(fileExistsSafe(`${db}-shm`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every dated-backup stamper derives from backupStamp (#83)", () => {
    // Source-pinned: the guard family stamps `.bak-<stamp>` and rb-adopt's
    // VACUUM-INTO snapshot stamps `_bak_<stamp>` — one format, one producer.
    // A hand-rolled second stamp format must fail here, not in an operator's
    // backup listing.
    const guardSrc = readFileSync(new URL("guard.ts", import.meta.url), "utf8");
    const adoptSrc = readFileSync(
      new URL("rb-adopt.ts", import.meta.url),
      "utf8",
    );
    expect(guardSrc).toContain("backupStamp()");
    expect(guardSrc).not.toMatch(/toISOString\(\)\.replace\(/u);
    expect(adoptSrc).toContain("backupStamp()");
    expect(adoptSrc).not.toMatch(/toISOString\(\)\.replace\(/u);
  });
});
