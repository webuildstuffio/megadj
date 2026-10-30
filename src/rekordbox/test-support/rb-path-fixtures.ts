/**
 * Shared pyrekordbox master-db fixtures for the rb-* command tests
 * (rb-fix-paths.test.ts, rb-unmatched.test.ts): stub PIONEER/Master/master.db
 * files, the MEGADJ_RB_MASTER env save/restore guard, and the apply-scenario
 * path triple (stale DB row vs live mount file).
 *
 * jscpd #575 — extracted to cut the shared 20-line setup clones.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The canonical PIONEER/Master/master.db path under a mount. */
export function masterDbPath(mount: string): string {
  return join(mount, "PIONEER", "Master", "master.db");
}

/** Create PIONEER/Master/master.db under the mount with the given contents. */
export function writeStubMasterDb(mount: string, contents: string): string {
  const dbPath = masterDbPath(mount);
  mkdirSync(join(mount, "PIONEER", "Master"), { recursive: true });
  writeFileSync(dbPath, contents);
  return dbPath;
}

/** Run fn with MEGADJ_RB_MASTER pointed at dbPath, restoring the prior env after. */
export async function withRbMasterEnv<T>(dbPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.MEGADJ_RB_MASTER;
  process.env.MEGADJ_RB_MASTER = dbPath;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MEGADJ_RB_MASTER;
    else process.env.MEGADJ_RB_MASTER = previous;
  }
}

/** The stale row path the apply scenarios read out of the fake DB. */
const STALE_ROW_PATH = "/Volumes/OLD/Contents/Artist B/Old Track.mp3";

/** Stub DB plus the stale-vs-live path pair the --apply scenarios exercise. */
export function applyFixturePaths(mount: string): {
  dbPath: string;
  oldPath: string;
  livePath: string;
} {
  return {
    dbPath: writeStubMasterDb(mount, "stub"),
    oldPath: STALE_ROW_PATH,
    livePath: join(mount, "Contents", "Artist B", "Old Track.mp3"),
  };
}
