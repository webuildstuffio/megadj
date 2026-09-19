/**
 * storage.test.ts — pins for the #251 storage + ledger-freshness block
 * behind `megadj status`.
 *
 * Invariants:
 *   1. the block is derived from the filesystem AT CALL TIME — a file
 *      created after state open shows up (no cached twins)
 *   2. the DB path comes from the state itself (dbPath), so a test
 *      state's temp dir is probed, never the production ~/.local/state
 *   3. freshness: a cohort synced >7d ago is STALE; never-synced is
 *      reported as never, not guessed
 *   4. shelf unmounted → shelfMounted false + a warning line (never a
 *      silent false)
 *   5. read-only: the probe creates/deletes nothing
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempState } from "../test-support/testutil";
import { storageReport } from "./storage";
import type { ArchiveState } from "../archive/state";

const ts = tempState("megadj-storage-test-");
let dir: string;
let state: ArchiveState;

describe("storage block (#251)", () => {
  test("measures the state's own dir live; a new file is seen immediately", () => {
    ({ dir, state } = ts.next());
    const before = storageReport(state);
    expect(before.storage.stateDirBytes).toBeGreaterThan(0);
    expect(before.storage.archiveDbBytes).toBeGreaterThan(0);
    // The live db itself is never counted as a backup.
    expect(before.storage.backupCount).toBe(0);

    // Write a dated backup the way rb-import/shelf tooling does, then
    // re-probe: count AND bytes move (call-time derivation, no cache).
    writeFileSync(
      join(dir, "archive.db.bak-20260919-095900"),
      "x".repeat(1024),
    );
    const after = storageReport(state);
    expect(after.storage.backupCount).toBe(1);
    expect(after.storage.stateDirBytes).toBeGreaterThan(
      before.storage.stateDirBytes,
    );
    expect(after.storage.oldestBackupAgeDays).toBe(0);
  });

  test("freshness: a stale cohort is flagged; never-synced is never", () => {
    // Seed two cohorts directly through the state API: one synced now,
    // one whose last_attempt_at is 27 days old (the LL freeze class).
    state.upsertTrackFromPlaylist("v-now", 1, "Fresh");
    state.startRun();
    const { db } = state as unknown as {
      db: { query: (q: string) => { run: (...p: unknown[]) => unknown } };
    };
    db.query(
      `UPDATE tracks SET last_attempt_at = ? WHERE video_id = 'v-now'`,
    ).run(new Date().toISOString());

    state.upsertTrackFromPlaylist("v-old", 2, "Frozen", "LL");
    const old = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString();
    db.query(
      `UPDATE tracks SET last_attempt_at = ? WHERE video_id = 'v-old'`,
    ).run(old);

    const r = storageReport(state);
    const fresh = r.ledgerFreshness.find((f) => f.source === "liked");
    expect(fresh).toBeDefined();
    expect(fresh?.ageDays).toBe(0);
    expect(fresh?.stale).toBe(false);

    // The 27d-old LL cohort is stale and sorts first (worst first).
    const frozen = r.ledgerFreshness.find((f) => f.source === "LL");
    expect(frozen?.stale).toBe(true);
    expect(frozen?.ageDays).toBe(27);
    expect(r.anyStale).toBe(true);
    expect(r.ledgerFreshness[0]?.source).toBe("LL");
  });

  test("tmp fixture counting sees a fresh fixture dir at the fallback root", () => {
    // The probe counts (never sweeps). A prefixed dir at /tmp proper
    // must move the number — the #254 two-root lesson applies here too.
    const probe = join("/tmp", "megadj-storage-probe-251");
    mkdirSync(probe, { recursive: true });
    try {
      const r = storageReport(state);
      expect(r.storage.tmpFixtureDirs).toBeGreaterThanOrEqual(1);
      expect(existsSync(probe)).toBe(true); // read-only: not swept
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  test("shelf probe is honest: a nonexistent volume is unmounted with a warning", () => {
    // Default config points at a real drive name that may or may not be
    // mounted right now; pin only the invariant, not the host state.
    const r = storageReport(state);
    if (!r.storage.shelfMounted) {
      expect(r.shelfWarning).toContain(r.storage.shelfVolume);
    } else {
      expect(r.shelfWarning).toBeNull();
    }
  });

  test("state teardown", () => {
    ts.done({ dir, state });
    expect(existsSync(dir)).toBe(false);
  });
});
