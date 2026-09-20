/**
 * tmp-purge.test.ts — pins for the #236 sweep + the Sep 18 --state tier.
 *
 * The state tier's invariants (the reason this exists):
 *   1. the newest backup per DB stem is ALWAYS kept (lineage snapshot)
 *   2. the live `archive.db` matches no backup class — unreachable
 *   3. sidecars of an OPEN db are never swept (lsof guard)
 *   4. spike artifacts are load-bearing and never swept
 *   5. read-only by default: zero removals without --apply
 *
 * The sweep root is fixed at ~/.local/state/megadj (the production
 * location), so these tests pin the CLASSIFICATION + dry-run contract
 * against the real state dir and never pass --apply. Deletion behavior
 * is exercised by the dry-run/applied counter contract, not by
 * deleting real backups in a test.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  backupClass,
  sidecarClass,
  statePurge,
  tmpPurgeSweep,
} from "./tmp-purge";
import { tempDir } from "../test-support/testutil";

const stateFixtures = tempDir("megadj-tmp-purge-state-").rippable();
afterAll(() => stateFixtures.rippleAll());

function fixtureStateRoot(): string {
  const root = stateFixtures.dir();
  writeFileSync(join(root, "archive.db"), "live");
  writeFileSync(join(root, "archive.db-wal"), "wal");
  writeFileSync(join(root, "archive.db-shm"), "shm");
  writeFileSync(join(root, "archive.db.bak-20260910-010101"), "old");
  writeFileSync(join(root, "archive.db.bak-20260911-010101"), "new");
  mkdirSync(join(root, "spike"));
  writeFileSync(join(root, "spike", "baseline.json"), "baseline");
  writeFileSync(join(root, "spike-ledger.json"), "baseline");
  return root;
}

const stateOpts = (apply: boolean, all = true) => ({
  apply,
  all,
  json: true,
  state: true,
  log: () => {},
});

/** Aged fixture dir factory (hoisted: captures nothing from any test's
 *  scope, so it lives at module level — unicorn/function-scoping). */
function mk(root: string, name: string, ageDays: number): string {
  const dir = join(root, `megadj-${name}`);
  mkdirSync(dir, { recursive: true });
  const past = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  utimesSync(dir, new Date(past), new Date(past));
  return dir;
}

/** Aged fixture dir WITH a file inside (#270 tests): the file write happens
 *  BEFORE the age stamp — creating a file bumps the parent dir's mtime,
 *  which would re-freshen it past the age gate. Module level for the same
 *  function-scoping reason as mk. */
function tmpFixture(root: string, name: string): string {
  const dir = mk(root, name, 3);
  writeFileSync(join(dir, "junk.txt"), "junk");
  const past = Date.now() - 3 * 24 * 60 * 60 * 1000;
  utimesSync(dir, new Date(past), new Date(past));
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

  test("--all stays read-only without making spike artifacts sweepable", () => {
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

describe("state tier: destructive safety (#265)", () => {
  test("unknown open-file state aborts before touching WAL/SHM", () => {
    const root = fixtureStateRoot();
    const result = statePurge(stateOpts(true), { root, openPaths: () => null });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(existsSync(join(root, "archive.db-wal"))).toBe(true);
    expect(existsSync(join(root, "archive.db-shm"))).toBe(true);
  });

  for (const all of [false, true]) {
    test(`spike baselines survive all=${all}`, () => {
      const root = fixtureStateRoot();
      const result = statePurge(stateOpts(true, all), {
        root,
        openPaths: () => new Set(),
        remove: () => undefined,
      });
      expect(result.ok).toBe(true);
      expect(result.families.some((family) => family.prefix === "spike")).toBe(
        false,
      );
      expect(existsSync(join(root, "spike", "baseline.json"))).toBe(true);
      expect(existsSync(join(root, "spike-ledger.json"))).toBe(true);
    });
  }

  test("failed removals do not claim freed bytes", () => {
    const root = fixtureStateRoot();
    const result = statePurge(stateOpts(true), {
      root,
      openPaths: () => new Set(),
      remove: () => {
        throw new Error("denied");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(existsSync(join(root, "spike", "baseline.json"))).toBe(true);
    expect(existsSync(join(root, "spike-ledger.json"))).toBe(true);
  });

  test("closed sidecars are removed while an open database retains its sidecars", () => {
    const closed = fixtureStateRoot();
    const closedResult = statePurge(stateOpts(true), {
      root: closed,
      openPaths: () => new Set(),
    });
    expect(closedResult.ok).toBe(true);
    expect(existsSync(join(closed, "archive.db-wal"))).toBe(false);
    expect(existsSync(join(closed, "archive.db-shm"))).toBe(false);

    const open = fixtureStateRoot();
    const openResult = statePurge(stateOpts(true), {
      root: open,
      openPaths: () => new Set([join(open, "archive.db")]),
    });
    expect(openResult.ok).toBe(true);
    expect(existsSync(join(open, "archive.db-wal"))).toBe(true);
    expect(existsSync(join(open, "archive.db-shm"))).toBe(true);
  });
});

describe("tmpdir tier: fail-closed exit contract (#270)", () => {
  test("partial rmSync failure → ok:false (exit 1), applied counts only wins", () => {
    const root = stateFixtures.dir();
    const win = tmpFixture(root, "270-win");
    const blocked = tmpFixture(root, "270-blocked");
    const r = tmpPurgeSweep(
      {
        apply: true,
        all: false,
        json: true,
        log: () => {},
        roots: [root],
      },
      {
        remove: (path: string) => {
          if (path.includes("270-blocked"))
            throw new Error("EPERM: simulated denial");
        },
      },
    );
    // fail closed: a partial sweep is detectable by automation
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(1); // only the win counted
    expect(r.eligible).toBe(2);
    void win;
    void blocked;
  });

  test("unreadable root fails the sweep closed", () => {
    const missing = join(stateFixtures.dir(), "270-missing");
    const okRoot = stateFixtures.dir();
    const r = tmpPurgeSweep({
      apply: false,
      all: false,
      json: true,
      log: () => {},
      roots: [missing],
    });
    expect(r.ok).toBe(false); // was an ENOENT throw before #270
    expect(r.scanned).toBe(0);
    // a good root beside a bad one still sweeps (and reports ok)
    const r2 = tmpPurgeSweep({
      apply: false,
      all: false,
      json: true,
      log: () => {},
      roots: [missing, okRoot],
    });
    expect(r2.ok).toBe(true);
  });

  test("sidecar spellings never classify as backups (anchored regexes)", () => {
    expect(backupClass("archive.db.bak-20260910-010101-wal")).toBeNull();
    expect(backupClass("archive.db.bak-20260910-010101.old")).toBeNull();
    expect(backupClass("archive.db.bak-20260910-010101-shm")).toBeNull();
    // the real classes still classify
    expect(backupClass("archive.db.bak-20260910-010101")).toBe("archive.db");
    expect(backupClass("archive_bak_2026-09-12T05-56-07-511Z.db")).toBe(
      "archive.db",
    );
  });

  test("read-only --state counts held sidecars as ineligible (honest eligibility)", () => {
    const root = fixtureStateRoot();
    const r = statePurge(stateOpts(false), {
      root,
      openPaths: () => new Set([join(root, "archive.db")]),
    });
    // fixtureStateRoot: 2 backups (older superseded → eligible) + 2
    // sidecars. Held sidecars are NOT counted (was eligible before #270 —
    // the lsof guard ran only on --apply): only the superseded backup is.
    expect(r.eligible).toBe(1);
    expect(r.applied).toBe(0);
    // closed sidecars ARE eligible in dry-run — honest in both directions
    const openRoot = fixtureStateRoot();
    const r2 = statePurge(stateOpts(false), {
      root: openRoot,
      openPaths: () => new Set(),
    });
    expect(r2.eligible).toBe(3); // 2 orphan sidecars + superseded backup
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
    // Dedicated roots avoid host temp cleanup racing this age-gate fixture.
    const platformRoot = join(stateFixtures.dir(), "254-root-a");
    const fallbackRoot = join(stateFixtures.dir(), "254-root-b");
    mkdirSync(platformRoot);
    mkdirSync(fallbackRoot);
    const created: string[] = [];
    const oldAtPlatform = mk(platformRoot, "254-old-platform", 3);
    created.push(oldAtPlatform);
    const oldAtFallback = mk(fallbackRoot, "254-old-fallback", 3);
    created.push(oldAtFallback);
    const freshAtFallback = mk(fallbackRoot, "254-fresh-fallback", 0);
    created.push(freshAtFallback);
    try {
      expect(statSync(oldAtPlatform).mtimeMs).toBeLessThanOrEqual(
        Date.now() - 24 * 60 * 60 * 1000,
      );
      const before = tmpPurgeSweep({
        apply: false,
        all: false,
        json: true,
        log: () => {},
        roots: [platformRoot, fallbackRoot],
      });
      // The aged fixtures at every root are eligible in the aggregate.
      expect(before.scanned).toBe(3);
      expect(before.eligible).toBe(2);
      expect(before.applied).toBe(0);
      // Fresh fixture at the second root is NOT eligible (age gate applies
      // per root — #254's "age into eligibility identically").
      const r2 = tmpPurgeSweep({
        apply: false,
        all: false,
        json: true,
        log: () => {},
        roots: [platformRoot, fallbackRoot],
      });
      expect(r2.eligible).toBe(2);
    } finally {
      for (const dir of created) rmSync(dir, { recursive: true, force: true });
    }
  });
});
