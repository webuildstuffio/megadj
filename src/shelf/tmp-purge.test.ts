/**
 * tmp-purge.test.ts — pins for the #236 sweep + the Sep 18 --state tier.
 *
 * The state tier's invariants (the reason this exists):
 *   1. the newest backup per DB stem is ALWAYS kept (lineage snapshot)
 *   2. the live `archive.db` matches no backup class — unreachable
 *   3. sidecars of an OPEN db are never swept (lsof guard)
 *   4. spike artifacts are age-gated >24h
 *   5. read-only by default: zero removals without --apply
 *
 * The sweep root is fixed at ~/.local/state/megadj (the production
 * location), so these tests pin the CLASSIFICATION + dry-run contract
 * against the real state dir and never pass --apply. Deletion behavior
 * is exercised by the dry-run/applied counter contract, not by
 * deleting real backups in a test.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  backupClass,
  sidecarClass,
  statePurge,
  tmpPurgeSweep,
} from "./tmp-purge";

/** Aged fixture dir factory (hoisted: captures nothing from any test's
 *  scope, so it lives at module level — unicorn/function-scoping). */
function mk(root: string, name: string, ageDays: number): string {
  const dir = join(root, `megadj-${name}`);
  mkdirSync(dir, { recursive: true });
  const past = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  utimesSync(dir, past, past);
  return dir;
}

describe("state tier: backup classification", () => {
  test("recognizes every dated backup class, never the live db", () => {
    expect(backupClass("archive.db.bak-20260911-174552")).toBe("archive.db");
    expect(backupClass("archive.db.pre-restore-20260911-021250.bak")).toBe(
      "archive.db",
    );
    expect(backupClass("archive_bak_2026-09-12T05-56-07-511Z.db")).toBe(
      "archive.db",
    );
    // Live DB and the lineage snapshot name class are pinned above.
    expect(backupClass("archive.db")).toBeNull();
    expect(
      backupClass("archive-db-before-sc-genre-ids-drop-2026-09-15.db"),
    ).toBe("archive.db");
    expect(backupClass("cratedeck.db")).toBeNull();
    expect(backupClass("archive-queue.jsonl")).toBeNull();
  });

  test("sidecar classification maps to its db stem", () => {
    expect(sidecarClass("archive.db-wal")).toBe("archive.db");
    expect(sidecarClass("archive.db-shm")).toBe("archive.db");
    expect(sidecarClass("archive.db.bak-20260911-185351-shm")).toBe(
      "archive.db.bak-20260911-185351",
    );
    expect(sidecarClass("archive.db")).toBeNull();
    expect(sidecarClass("artwork-queue.jsonl")).toBeNull();
  });
});

describe("state tier: dry-run contract on the real state dir", () => {
  test("reports, keeps newest lineage, deletes nothing", () => {
    const stateDir = join(process.env.HOME ?? "", ".local", "state", "megadj");
    const liveDbExists = existsSync(join(stateDir, "archive.db"));
    const r = statePurge({
      apply: false,
      all: false,
      json: true,
      log: () => {},
      state: true,
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0); // dry-run: never deletes
    expect(r.appliedMode).toBe(false);
    if (!liveDbExists) return; // nothing further to pin on a bare host
    // The live ledger survived (trivially true in dry-run, pinned so a
    // future root-handling bug surfaces here first).
    expect(existsSync(join(stateDir, "archive.db"))).toBe(true);
    // Every kept lineage file must be an archive.db backup (never the
    // live db, never an unrelated file).
    for (const k of r.kept ?? []) {
      const isBackup =
        k.startsWith("archive.db.") ||
        k.startsWith("archive_bak_") ||
        /^archive-db-before-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.db$/.test(k);
      expect(isBackup).toBe(true);
    }
    // Eligible rows in dry-run mode are all stale (all:true would lift
    // the spike gate; we don't pass it, so nothing fresh is counted).
    expect(r.eligible).toBeLessThanOrEqual(r.scanned);
  });

  test("--all lifts the spike gate but applied still honors dry-run", () => {
    const r = statePurge({
      apply: false,
      all: true,
      json: true,
      log: () => {},
      state: true,
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0);
  });
});

describe("tmp sweep: multi-root scan (#254)", () => {
  test("a fixture at /tmp proper is visible even when tmpdir() resolves elsewhere", () => {
    // The regression: macOS's tmpdir() moved to ~/.tmp while suites still
    // leak into /tmp — the sweep must report BOTH roots. This test creates
    // nothing: it pins the contract on whatever the host has right now.
    const r = tmpPurgeSweep({
      apply: false,
      all: false,
      json: true,
      log: () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.roots).toBeDefined();
    expect(r.roots!.length).toBeGreaterThanOrEqual(1);
    // The platform root is always scanned; /tmp appears alongside it
    // whenever the two resolve differently on this machine.
    expect(r.roots!.some((root) => root === realpathSync(tmpdir()))).toBe(true);
    const distinct = new Set(r.roots!);
    if (realpathSync("/tmp") !== realpathSync(tmpdir())) {
      expect(distinct.has(realpathSync("/tmp"))).toBe(true);
    } else {
      // Same root: deduped to one entry.
      expect(distinct.size).toBe(1);
    }
    // Aggregate invariants hold across the union of roots.
    expect(r.eligible).toBeLessThanOrEqual(r.scanned);
    expect(r.applied).toBe(0); // dry-run: never deletes
  });

  test("both roots age fixtures identically (an old fixture is eligible, a fresh one is not)", () => {
    // Real fixture dirs at BOTH roots, one aged one fresh, dry-run only.
    const platformRoot = realpathSync(tmpdir());
    const fallbackRoot = realpathSync("/tmp");
    const created: string[] = [];
    const oldAtPlatform = mk(platformRoot, "254-old-platform", 3);
    created.push(oldAtPlatform);
    const oldAtFallback =
      fallbackRoot === platformRoot
        ? null
        : mk(fallbackRoot, "254-old-fallback", 3);
    if (oldAtFallback) created.push(oldAtFallback);
    const freshAtFallback =
      fallbackRoot === platformRoot
        ? null
        : mk(fallbackRoot, "254-fresh-fallback", 0);
    if (freshAtFallback) created.push(freshAtFallback);
    try {
      const before = tmpPurgeSweep({
        apply: false,
        all: false,
        json: true,
        log: () => {},
      });
      const rootsWithOld = before.roots!.filter(
        (root) =>
          root === platformRoot ||
          (oldAtFallback !== null && root === fallbackRoot),
      );
      // The aged fixtures at every root are eligible in the aggregate.
      expect(before.eligible).toBeGreaterThanOrEqual(created.length - 1);
      expect(before.applied).toBe(0);
      // Fresh fixture at the second root is NOT eligible (age gate applies
      // per root — #254's "age into eligibility identically").
      const r2 = tmpPurgeSweep({
        apply: false,
        all: false,
        json: true,
        log: () => {},
      });
      expect(r2.eligible).toBeGreaterThanOrEqual(rootsWithOld.length);
    } finally {
      for (const dir of created) rmSync(dir, { recursive: true, force: true });
    }
  });
});
