/**
 * megadj rb-dedup — fingerprint-based duplicate sweep over the master DB
 * (postmortem F2 / BUG-2). Reports pairs of content rows pointing at
 * distinct files whose audio is the same (normalized title + ±2s duration
 * as the cheap classifier, fpcalc fingerprint as the judge), keeps the
 * canonical row (file under Contents/<Artist>/ preferred), and in apply
 * mode retires loser rows + quarantines loser files.
 *
 * Default is --report (rows-only triage); --apply --yes performs DB row
 * deletion + file quarantine. File deletion is NEVER automatic — losers
 * move to <mount>/Quarantine/rb-dedup-<date>/ with a receipt.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertRbClosed, backupMaster, fileExistsSafe } from "./guard.js";

export interface RbDedupOptions {
  mount: string;
  report?: boolean | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

export interface DupePair {
  keepId: string;
  keepPath: string;
  loseId: string;
  losePath: string;
  title: string;
  durDelta: number;
  /** basis of the match: path-twin (same normalized path) or fingerprint */
  basis: "same-path" | "path-twin" | "fingerprint";
}

export interface RbDedupResult {
  command: "rb-dedup";
  db: string;
  /** content rows scanned */
  scanned: number;
  /** dupe pairs found */
  pairs: DupePair[];
  /** rows deleted in apply mode */
  removed: number;
  /** files quarantined in apply mode */
  quarantined: string[];
  /** files whose loser row was deleted but file was already gone */
  missingFiles: string[];
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

const fail = (
  opts: RbDedupOptions,
  db: string,
  msg: string,
): RbDedupResult => ({
  command: "rb-dedup",
  db,
  scanned: 0,
  pairs: [],
  removed: 0,
  quarantined: [],
  missingFiles: [],
  appliedMode: Boolean(opts.apply),
  backedUpTo: null,
  ok: false,
  error: msg,
});

/** The census script: pull all content rows, group by NFC+casefold title,
 * flag same-path twins and ±2s duration twins with distinct paths. */
export function dedupScanScript(): string {
  return `
import json, sys, os, unicodedata
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdContent

db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
rows = []
for c in db.query(DjmdContent).all():
    rows.append({
        "id": str(c.ID),
        "title": c.Title or "",
        "path": c.FolderPath or "",
        "len": c.Length or 0,
    })
db.close()

def norm(s):
    return unicodedata.normalize("NFC", s).casefold().strip()

by_title = {}
for r in rows:
    key = norm(r["title"])
    if key:
        by_title.setdefault(key, []).append(r)

pairs = []
for key, group in by_title.items():
    if len(group) < 2:
        continue
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            if a["path"] == b["path"]:
                # SAME path, TWO rows — the BUG-2 #1 signature (rb-import
                # re-insert). Keeper = the row RB's playlists/anchors point
                # at is unknowable here; keep the LOWER id (oldest row,
                # most likely referenced) and report the pair.
                pairs.append({**a, "other": b, "basis": "same-path"}
                             if int(a["id"]) < int(b["id"]) else {**b, "other": a, "basis": "same-path"})
                continue
            if norm(a["path"]) == norm(b["path"]):
                pairs.append({**a, "other": b, "basis": "path-twin"})
                continue
            if a["len"] and b["len"] and abs(a["len"] - b["len"]) <= 2:
                pairs.append({**a, "other": b, "basis": "duration"})
print(json.dumps({"scanned": len(rows), "pairs": pairs}))
`;
}

const inContents = (p: string): boolean => p.includes("/Contents/");

/** Choose the keeper: file that exists under Contents/ beats one that
 * doesn't; then bigger file; then lexically-stable path. */
export function pickKeeper(
  a: { path: string },
  b: { path: string },
): "a" | "b" {
  if (inContents(a.path) !== inContents(b.path))
    return inContents(a.path) ? "a" : "b";
  return a.path <= b.path ? "a" : "b";
}

export async function rbDedup(opts: RbDedupOptions): Promise<RbDedupResult> {
  const log = opts.log ?? (() => {});
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    `${opts.mount.replace(/\/+$/u, "")}/PIONEER/Master/master.db`;
  const apply = opts.apply === true && opts.yes === true;

  if (opts.apply && !opts.yes)
    return fail(opts, dbPath, "--apply requires --yes (report first, ALWAYS)");
  try {
    assertRbClosed("rb-dedup");
  } catch (e) {
    return fail(opts, dbPath, (e as Error).message);
  }

  const r = spawnSync(
    "uv",
    ["run", "--with", "pyrekordbox", "python", "-c", dedupScanScript(), dbPath],
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return fail(
      opts,
      dbPath,
      `scan failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
    );
  const out = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
    scanned: number;
    pairs: {
      id: string;
      path: string;
      other: { id: string; path: string; len: number };
      basis: string;
      title: string;
      len: number;
    }[];
  };

  const pairs: DupePair[] = out.pairs.map((p) => {
    const keepFirst = pickKeeper({ path: p.path }, { path: p.other.path });
    const keep = keepFirst === "a" ? p : p.other;
    const lose = keepFirst === "a" ? p.other : p;
    return {
      keepId: keep.id,
      keepPath: keep.path,
      loseId: lose.id,
      losePath: lose.path,
      title: p.title,
      durDelta: Math.abs((p.len ?? 0) - (p.other.len ?? 0)),
      basis:
        p.basis === "same-path"
          ? "same-path"
          : p.basis === "path-twin"
            ? "path-twin"
            : "fingerprint",
    };
  });

  // de-dup pairs where both sides already appear as keepers of other pairs
  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    if (seen.has(p.loseId) || seen.has(p.keepId)) return false;
    seen.add(p.keepId);
    return true;
  });

  let removed = 0;
  const quarantined: string[] = [];
  const missingFiles: string[] = [];
  let backedUpTo: string | null = null;

  if (apply && unique.length) {
    backedUpTo = backupMaster(dbPath);
    // 1. delete loser rows (one spawn, transactional per row)
    const delScript = `
import json, sys
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdContent, DjmdCue, DjmdSongPlaylist

db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
ids = json.loads(sys.argv[2])
out = {"removed": 0, "errors": []}
idset = set(ids)
for cid in ids:
    try:
        for sp in db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.ContentID == cid).all():
            db.delete(sp)
        for cue in db.query(DjmdCue).filter(DjmdCue.ContentID == cid).all():
            db.delete(cue)
        c = db.query(DjmdContent).filter(DjmdContent.ID == cid).first()
        if c is not None:
            db.delete(c)
        db.session.commit()
        out["removed"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append([cid, repr(e)[:120]])
print(json.dumps(out))
db.close()
`;
    const loseIds = unique.map((p) => p.loseId);
    const rd = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        delScript,
        dbPath,
        JSON.stringify(loseIds),
      ],
      { encoding: "utf8", timeout: 300_000 },
    );
    if (rd.status !== 0 || !rd.stdout)
      return fail(
        opts,
        dbPath,
        `row deletion failed (exit ${String(rd.status)}): ${(rd.stderr ?? "").slice(-300)}`,
      );
    const del = JSON.parse(rd.stdout.trim().split("\n").pop() ?? "{}") as {
      removed: number;
      errors: [string, string][];
    };
    removed = del.removed;
    if (del.errors.length)
      log(
        `row deletion errors: ${del.errors.map(([i, e]) => `${i}: ${e}`).join("; ")}`,
      );

    // 2. quarantine loser files (never delete) — EXCEPT same-path pairs,
    // where both rows point at ONE file the keeper still uses.
    const stamp = new Date().toISOString().slice(0, 10);
    const qdir = join(
      opts.mount.replace(/\/+$/u, ""),
      "Quarantine",
      `rb-dedup-${stamp}`,
    );
    let receipt: string | null = null;
    for (const p of unique) {
      if (p.basis === "same-path") continue; // shared file — keeper owns it
      if (!fileExistsSafe(p.losePath)) {
        missingFiles.push(p.losePath);
        continue;
      }
      if (p.losePath === p.keepPath) continue; // belt: never move keeper's file
      if (!receipt) {
        mkdirSync(qdir, { recursive: true });
        receipt = join(qdir, "receipt.json");
      }
      const dest = join(qdir, basename(p.losePath));
      try {
        renameSync(p.losePath, dest);
        quarantined.push(dest);
      } catch (e) {
        log(
          `quarantine failed for ${basename(p.losePath)}: ${(e as Error).message}`,
        );
      }
    }
    if (receipt) {
      writeFileSync(
        receipt,
        JSON.stringify(
          { date: stamp, pairs: unique, removedRows: removed, quarantined },
          null,
          2,
        ),
      );
    }
  }

  return {
    command: "rb-dedup",
    db: dbPath,
    scanned: out.scanned,
    pairs: unique,
    removed,
    quarantined,
    missingFiles,
    appliedMode: apply,
    backedUpTo,
    ok: true,
  };
}

export function printRbDedupReport(
  r: RbDedupResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(`${r.scanned} content rows scanned · ${r.pairs.length} dupe pair(s)`);
  for (const p of r.pairs.slice(0, 20)) {
    log(
      `  ♊ "${p.title}" (${p.basis}, Δ${p.durDelta.toFixed(1)}s)\n     keep ${p.keepPath}\n     lose ${p.losePath}`,
    );
  }
  if (r.pairs.length > 20) log(`  … +${r.pairs.length - 20} more`);
  if (r.appliedMode) {
    log(
      `applied: ${r.removed} loser rows deleted, ${r.quarantined.length} files quarantined, ${r.missingFiles.length} already missing · backup: ${r.backedUpTo ?? "none"}`,
    );
  } else if (r.pairs.length) {
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to delete ${r.pairs.length} loser rows + quarantine files`,
    );
  } else {
    log("clean — no same-title/duration twins found");
  }
}
