/**
 * quarantine.ts — the recoverable-copy census + the guarded empty
 * (#35/#36). The quarantine LAYOUT (flattened loser names, collision
 * suffixes — see apply.ts quarantineDest) is engine knowledge: this
 * module and restore.ts are the only readers, cratedeck goes through
 * the CLI. Nothing here deletes without the CLI arm's `--yes` gate,
 * the operation lease, and the `applied` status machine.
 *
 * The empty flips each row applied → archived: the receipt stays, the
 * undo window closes. Rows whose copy already vanished (stale) are
 * counted, never silently skipped — the census explains the delta.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { openLedger } from "../shared/sqlite-ledger";
import { HygieneStore } from "../core/hygiene/store";
import { QUARANTINE_DIR } from "../core/hygiene/apply";
import { resolveShelfVolume } from "../shared/volume";
import { errMessage as errorText } from "../shared/leaf/fmt";

export interface QuarantineCensusResult {
  command: "shelf-quarantine";
  ok: boolean;
  files: number;
  bytes: number;
  stale: number;
  error?: string | undefined;
}

export interface QuarantineEmptyResult {
  command: "shelf-quarantine-empty";
  ok: boolean;
  deleted: number;
  bytes: number;
  failed: string[];
  error?: string | undefined;
}

/** The same collision-tolerant lookup restore.ts uses: exact flattened
 *  name first, then the pre-extension stem against suffixed copies. */
function quarantineCopyPath(
  f: {
    paths: string[];
  },
  qDir: string,
): string | null {
  const loser = f.paths[1];
  if (!loser) return null;
  const raw = loser.split("/Contents/")[1] ?? basename(loser);
  const flat = raw.replace(/\//g, " · ");
  if (existsSync(join(qDir, flat))) return join(qDir, flat);
  const stem = flat.replace(/(\.[^.]*)?$/, "");
  try {
    for (const name of readdirSync(qDir)) {
      if (name === flat || name.startsWith(`${stem} (`)) {
        const candidate = join(qDir, name);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function openStore(
  dbPath: string,
  shelfVolume?: string | undefined,
): { store: HygieneStore; qDir: string; close: () => void } {
  const db = openLedger(dbPath);
  return {
    store: new HygieneStore(db),
    qDir: join(resolveShelfVolume(shelfVolume), QUARANTINE_DIR),
    close: () => db.close(),
  };
}

/** N files / X GB of recoverable copies. Degrades to an honest error
 *  field when the shelf is unmounted — never a fake zero (#36: the
 *  panel renders the explainer, not an "empty" quarantine). */
export async function shelfQuarantineCensus(opts: {
  dbPath: string;
  shelfVolume?: string | undefined;
}): Promise<QuarantineCensusResult> {
  const { store, qDir, close } = openStore(opts.dbPath, opts.shelfVolume);
  try {
    if (!existsSync(qDir))
      return {
        command: "shelf-quarantine",
        ok: true,
        files: 0,
        bytes: 0,
        stale: 0,
      };
    const applied = store.list({ status: "applied" });
    let files = 0;
    let bytes = 0;
    let stale = 0;
    for (const f of applied) {
      const src = quarantineCopyPath(f, qDir);
      if (!src) {
        stale++;
        continue;
      }
      try {
        bytes += statSync(src).size;
        files++;
      } catch {
        stale++;
      }
    }
    return { command: "shelf-quarantine", ok: true, files, bytes, stale };
  } finally {
    close();
  }
}

/** The guarded empty: deletes every applied finding's recoverable copy
 *  and flips the row to `archived` (receipt kept, undo closed). The
 *  caller (CLI arm) owns the --yes gate; this body owns the lease and
 *  the per-row failure tolerance — one bad row never kills the sweep. */
export async function shelfQuarantineEmpty(opts: {
  dbPath: string;
  shelfVolume?: string | undefined;
}): Promise<QuarantineEmptyResult> {
  const { store, qDir, close } = openStore(opts.dbPath, opts.shelfVolume);
  const owner = crypto.randomUUID();
  try {
    if (!store.acquireOperation(owner))
      return {
        command: "shelf-quarantine-empty",
        ok: false,
        deleted: 0,
        bytes: 0,
        failed: [],
        error: "hygiene apply/restore already in flight",
      };
    if (!existsSync(qDir))
      return {
        command: "shelf-quarantine-empty",
        ok: true,
        deleted: 0,
        bytes: 0,
        failed: [],
      };
    const applied = store.list({ status: "applied" });
    let deleted = 0;
    let bytes = 0;
    const failed: string[] = [];
    for (const f of applied) {
      const src = quarantineCopyPath(f, qDir);
      if (!src) {
        // stale row — no copy to delete, but the undo window is closed
        // either way: archive it so the census stops counting it
        store.markArchived(f.id);
        continue;
      }
      try {
        bytes += statSync(src).size;
        rmSync(src);
        store.markArchived(f.id);
        deleted++;
      } catch (e) {
        failed.push(`${f.id}: ${errorText(e)}`);
      }
    }
    return {
      command: "shelf-quarantine-empty",
      ok: failed.length === 0,
      deleted,
      bytes,
      failed,
    };
  } finally {
    store.releaseOperation(owner);
    close();
  }
}
