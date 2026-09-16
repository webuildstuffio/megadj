/** Restore a hygiene-quarantined loser without trusting a free-form path.
 * The findings ledger is the source of truth; the quarantine is only the
 * recoverable byte store. Sources are never deleted or overwritten. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { openLedger } from "../shared/sqlite-ledger";
import { HygieneStore } from "../archive/hygiene/store";
import { QUARANTINE_DIR } from "../archive/hygiene/apply";
import type { Finding } from "../archive/hygiene/types";
import { resolveShelfVolume } from "../shared/volume";
import { writeJson } from "../shared/cli-output";
import { md5Cli } from "./md5-cli";

export interface ShelfRestoreOptions {
  input: string;
  shelfVolume?: string | undefined;
  into?: string | undefined;
  dbPath?: string | undefined;
  json?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface ShelfRestoreResult {
  command: "shelf-restore";
  ok: boolean;
  findingId: string | null;
  source: string | null;
  destination: string | null;
  md5: string | null;
  error?: string | undefined;
}

function flattenedLoserPath(path: string): string {
  const rel = path.split("/Contents/")[1] ?? basename(path);
  return rel.replace(/\//g, " · ");
}

function quarantineSource(f: Finding, shelfVolume: string): string | null {
  const loser = f.paths[1];
  if (!loser) return null;
  const qDir = join(shelfVolume, QUARANTINE_DIR);
  if (!existsSync(qDir)) return null;
  const expected = flattenedLoserPath(loser);
  const candidates = readdirSync(qDir)
    .filter((name) => name === expected || /^.+ \(\d+\)(\.[^.]*)?$/.test(name))
    .filter(
      (name) =>
        name === expected ||
        name.startsWith(expected.replace(/(\.[^.]*)?$/, "")),
    )
    .map((name) => join(qDir, name))
    .filter((path) => existsSync(path));
  if (candidates.length !== 1) return null;
  return candidates[0] ?? null;
}

function relativeLoserPath(f: Finding): string | null {
  const loser = f.paths[1];
  if (!loser) return null;
  const marker = "/Contents/";
  const at = loser.indexOf(marker);
  return at !== -1 ? loser.slice(at + marker.length) : basename(loser);
}

function destinationFor(f: Finding, into?: string): string | null {
  const rel = relativeLoserPath(f);
  if (!rel) return null;
  return into === undefined
    ? (f.paths[1] ?? null)
    : join(into, "Contents", rel);
}

function matchesInput(f: Finding, input: string, source: string): boolean {
  return (
    f.id === input ||
    resolve(input) === resolve(source) ||
    f.paths.includes(input)
  );
}

/** #88 diet: the guard ladder is data. Each entry either fails the run
 *  (returns an error string) or narrows the working state. `shelfRestore`
 *  walks the ladder; every refusal shape (findingId/source/destination/
 *  md5 carrying) lives in ONE `refuse` builder instead of eight 9-line
 *  object literals. */
interface RestoreScope {
  store: HygieneStore;
  shelfVolume: string;
  input: string;
  into?: string | undefined;
}

interface RestoreMatch {
  f: Finding;
  source: string;
  destination: string;
  sourceMd5: string;
}

type GuardResult = { error: string } | { match: RestoreMatch };

/** Locate the applied ledger finding that owns the input (by id, source
 *  path, or any recorded path). */
function findOwningFinding(
  scope: RestoreScope,
): { f: Finding; source: string } | { error: string } {
  const applied = scope.store.list({ status: "applied" });
  const match = applied
    .map((f) => ({ f, source: quarantineSource(f, scope.shelfVolume) }))
    .find(
      (candidate) =>
        candidate.source !== null &&
        matchesInput(candidate.f, scope.input, candidate.source),
    );
  if (!match?.source)
    return {
      error: "no applied ledger finding owns that quarantine source",
    };
  return { f: match.f, source: match.source };
}

/** The post-match guard chain: destination resolvable + free, source
 *  hashable, and the bytes still identical to the ledger keeper. */
function guardMatch(
  scope: RestoreScope,
  f: Finding,
  source: string,
): GuardResult {
  const destination = destinationFor(f, scope.into);
  if (!destination)
    return { error: "ledger finding has no restorable loser path" };
  if (existsSync(destination))
    return { error: `destination exists: ${destination}` };
  const sourceMd5 = md5Cli(source);
  if (!sourceMd5) return { error: "source MD5 unavailable" };
  const keeper = f.paths[0];
  if (keeper && existsSync(keeper)) {
    const keeperMd5 = md5Cli(keeper);
    if (keeperMd5 && keeperMd5 !== sourceMd5)
      return { error: "source MD5 differs from ledger keeper" };
  }
  return { match: { f, source, destination, sourceMd5 } };
}

/** The byte move + post-copy verification. Unlinks a bad copy — a corrupt
 *  restore must not look like a success on a later re-run. */
function copyVerified(match: RestoreMatch): { error: string } | null {
  mkdirSync(dirname(match.destination), { recursive: true });
  copyFileSync(match.source, match.destination);
  const destinationMd5 = md5Cli(match.destination);
  if (destinationMd5 !== match.sourceMd5) {
    if (existsSync(match.destination)) unlinkSync(match.destination);
    return { error: "MD5 verification failed after copy" };
  }
  return null;
}

export async function shelfRestore(
  opts: ShelfRestoreOptions,
): Promise<ShelfRestoreResult> {
  const shelfVolume = resolveShelfVolume(opts.shelfVolume);
  const dbPath =
    opts.dbPath ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
  const log = opts.log ?? ((message: string) => console.error(message));
  const result = async (
    value: ShelfRestoreResult,
  ): Promise<ShelfRestoreResult> => {
    if (opts.json) await writeJson(value);
    else if (!value.ok)
      log(`shelf-restore: ${value.error ?? "restore failed"}`);
    else log(`shelf-restore: restored ${value.source} → ${value.destination}`);
    return value;
  };

  if (!existsSync(join(shelfVolume, "Contents")))
    return await result({
      command: "shelf-restore",
      ok: false,
      findingId: null,
      source: null,
      destination: null,
      md5: null,
      error: `shelf not mounted: ${shelfVolume}`,
    });

  const db = openLedger(dbPath);
  const store = new HygieneStore(db);
  const owner = crypto.randomUUID();
  if (!store.acquireOperation(owner)) {
    db.close();
    return await result({
      command: "shelf-restore",
      ok: false,
      findingId: null,
      source: null,
      destination: null,
      md5: null,
      error: "hygiene apply/restore already in flight",
    });
  }
  try {
    const scope: RestoreScope = {
      store,
      shelfVolume,
      input: opts.input,
      into: opts.into,
    };
    const owned = findOwningFinding(scope);
    if ("error" in owned) {
      return await result({
        command: "shelf-restore",
        ok: false,
        findingId: null,
        source: null,
        destination: null,
        md5: null,
        error: owned.error,
      });
    }
    const guarded = guardMatch(scope, owned.f, owned.source);
    if ("error" in guarded) {
      return await result({
        command: "shelf-restore",
        ok: false,
        findingId: owned.f.id,
        source: owned.source,
        destination: null,
        md5: null,
        error: guarded.error,
      });
    }
    const copyError = copyVerified(guarded.match);
    if (copyError) {
      return await result({
        command: "shelf-restore",
        ok: false,
        findingId: owned.f.id,
        source: owned.source,
        destination: guarded.match.destination,
        md5: guarded.match.sourceMd5,
        error: copyError.error,
      });
    }
    return await result({
      command: "shelf-restore",
      ok: true,
      findingId: owned.f.id,
      source: owned.source,
      destination: guarded.match.destination,
      md5: guarded.match.sourceMd5,
    });
  } finally {
    store.releaseOperation(owner);
    db.close();
  }
}
