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
import { Database } from "bun:sqlite";
import { HygieneStore } from "../archive/hygiene/store";
import { QUARANTINE_DIR } from "../archive/hygiene/apply";
import type { Finding } from "../archive/hygiene/types";
import { resolveShelfVolume } from "../shared/volume";

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

function md5(path: string): string | null {
  const r = Bun.spawnSync(["md5", "-q", path]);
  if (r.exitCode !== 0) return null;
  const hash = r.stdout.toString().trim();
  return hash.length > 0 ? hash : null;
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
  return at >= 0 ? loser.slice(at + marker.length) : basename(loser);
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

export async function shelfRestore(
  opts: ShelfRestoreOptions,
): Promise<ShelfRestoreResult> {
  const shelfVolume = resolveShelfVolume(opts.shelfVolume);
  const dbPath =
    opts.dbPath ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
  const log = opts.log ?? ((message: string) => console.error(message));
  const result = (value: ShelfRestoreResult): ShelfRestoreResult => {
    if (opts.json) console.log(JSON.stringify(value, null, 2));
    else if (!value.ok)
      log(`shelf-restore: ${value.error ?? "restore failed"}`);
    else log(`shelf-restore: restored ${value.source} → ${value.destination}`);
    return value;
  };

  if (!existsSync(join(shelfVolume, "Contents")))
    return result({
      command: "shelf-restore",
      ok: false,
      findingId: null,
      source: null,
      destination: null,
      md5: null,
      error: `shelf not mounted: ${shelfVolume}`,
    });

  const db = new Database(dbPath);
  const store = new HygieneStore(db);
  const owner = crypto.randomUUID();
  if (!store.acquireOperation(owner)) {
    db.close();
    return result({
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
    const applied = store.list({ status: "applied" });
    const match = applied
      .map((f) => ({ f, source: quarantineSource(f, shelfVolume) }))
      .find(
        (candidate) =>
          candidate.source !== null &&
          matchesInput(candidate.f, opts.input, candidate.source),
      );
    if (!match?.source)
      return result({
        command: "shelf-restore",
        ok: false,
        findingId: null,
        source: null,
        destination: null,
        md5: null,
        error: "no applied ledger finding owns that quarantine source",
      });
    const destination = destinationFor(match.f, opts.into);
    if (!destination)
      return result({
        command: "shelf-restore",
        ok: false,
        findingId: match.f.id,
        source: match.source,
        destination: null,
        md5: null,
        error: "ledger finding has no restorable loser path",
      });
    if (existsSync(destination))
      return result({
        command: "shelf-restore",
        ok: false,
        findingId: match.f.id,
        source: match.source,
        destination,
        md5: null,
        error: `destination exists: ${destination}`,
      });
    const sourceMd5 = md5(match.source);
    if (!sourceMd5)
      return result({
        command: "shelf-restore",
        ok: false,
        findingId: match.f.id,
        source: match.source,
        destination,
        md5: null,
        error: "source MD5 unavailable",
      });
    const keeper = match.f.paths[0];
    if (keeper && existsSync(keeper)) {
      const keeperMd5 = md5(keeper);
      if (keeperMd5 && keeperMd5 !== sourceMd5)
        return result({
          command: "shelf-restore",
          ok: false,
          findingId: match.f.id,
          source: match.source,
          destination,
          md5: sourceMd5,
          error: "source MD5 differs from ledger keeper",
        });
    }
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(match.source, destination);
    const destinationMd5 = md5(destination);
    if (destinationMd5 !== sourceMd5) {
      if (existsSync(destination)) unlinkSync(destination);
      return result({
        command: "shelf-restore",
        ok: false,
        findingId: match.f.id,
        source: match.source,
        destination,
        md5: sourceMd5,
        error: "MD5 verification failed after copy",
      });
    }
    return result({
      command: "shelf-restore",
      ok: true,
      findingId: match.f.id,
      source: match.source,
      destination,
      md5: sourceMd5,
    });
  } finally {
    store.releaseOperation(owner);
    db.close();
  }
}
