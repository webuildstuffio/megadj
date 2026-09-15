/**
 * megadj rb-comment-sync — backfill the rekordbox Comment column from the
 * tags ALREADY stamped on the files (TXXX CAMELOT/ENERGY/MOOD — the
 * fulltags pipeline's output) with the archive.db mood ledger as fallback.
 *
 * Why this exists: intake imports happened BEFORE comments were written,
 * so 87% of master.db rows show an empty Comment even though the files
 * carry `11A · E8.8 · Dance+Party`-shaped data. This is the sync half of
 * fulltags → rekordbox (the missing "redo that one" from the Sep 12–14
 * marathon).
 *
 * Safety: report default; --apply --yes writes; RB-quit gate + dated
 * backup via guard.ts; one transaction; exact delayed re-read; compensating
 * DB-family restore on every post-backup failure.
 */

import { existsSync } from "node:fs";
import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import {
  compensateRestore,
  isStringPair,
  isStringTriple,
  parseJsonBoundary,
  RB_CLOSED_PY_GUARD,
  rbCommandRuntime,
  type RbCommandResult,
  type RbCommandRuntime,
} from "./rb-command-kit.js";

export interface RbCommentSyncOptions {
  mount: string;
  /** Only sync rows whose FolderPath contains this token (batch scope). */
  batch?: string | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  limit?: number | undefined;
  log?: (s: string) => void;
}

export interface RbCommentSyncResult {
  command: "rb-comment-sync";
  db: string;
  /** rows scanned */
  scanned: number;
  /** rows whose file carries tag data (or ledger fallback) */
  eligible: number;
  /** comments written (0 in dry-run) */
  written: number;
  /** rows skipped: file missing or no tag data found */
  skipped: { path: string; reason: string }[];
  /** rows that already had a non-empty comment (never clobbered) */
  alreadyHad: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  verify: { ok: boolean; detail: string };
  ok: boolean;
  error?: string;
}

interface SyncOutput {
  scanned: number;
  eligible: number;
  written: number;
  alreadyHad: number;
  skipped: [string, string][];
  samples: [string, string][];
  writes: [string, string][];
  errors: [string, string][];
}

interface CommentVerifyOutput {
  total: number;
  matched: number;
  missing: string[];
  mismatched: [string, string, string][];
}

type SyncCommandResult = RbCommandResult;

interface RbCommentSyncRuntime extends RbCommandRuntime {
  exists: (path: string) => boolean;
  spawn: (
    command: string[],
    timeoutMs: number,
    input?: string,
  ) => SyncCommandResult;
}

const runtime: RbCommentSyncRuntime = {
  exists: existsSync,
  ...rbCommandRuntime,
};

const nonNegativeInteger = isNonNegativeInteger;

function parseSyncOutput(raw: string, apply: boolean): SyncOutput {
  const value = parseJsonBoundary(raw, "rb-comment-sync");
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.scanned) ||
    !nonNegativeInteger(value.eligible) ||
    !nonNegativeInteger(value.written) ||
    !nonNegativeInteger(value.alreadyHad) ||
    !isUnknownArray(value.skipped) ||
    !value.skipped.every(isStringPair) ||
    !isUnknownArray(value.samples) ||
    !value.samples.every(isStringPair) ||
    !isUnknownArray(value.writes) ||
    !value.writes.every(isStringPair) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(isStringPair)
  ) {
    throw new Error("rb-comment-sync returned an invalid result payload");
  }
  const out: SyncOutput = {
    scanned: value.scanned,
    eligible: value.eligible,
    written: value.written,
    alreadyHad: value.alreadyHad,
    skipped: value.skipped,
    samples: value.samples,
    writes: value.writes,
    errors: value.errors,
  };
  if (out.scanned !== out.eligible + out.alreadyHad + out.skipped.length)
    throw new Error("rb-comment-sync returned inconsistent scan counters");
  if (out.errors.length > 0)
    throw new Error(
      `rb-comment-sync transaction failed: ${out.errors.map(([id, detail]) => `${id}: ${detail}`).join("; ")}`,
    );
  if (apply && out.written !== out.eligible)
    throw new Error(
      `rb-comment-sync wrote ${out.written}/${out.eligible} eligible rows`,
    );
  if (out.writes.length !== out.written)
    throw new Error("rb-comment-sync write acknowledgements are incomplete");
  if (!apply && out.written !== 0)
    throw new Error("rb-comment-sync report mode unexpectedly wrote rows");
  const ids = out.writes.map(([id]) => id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^(?:0|[1-9]\d*)$/u.test(id))
  )
    throw new Error(
      "rb-comment-sync returned invalid or duplicate content ids",
    );
  return out;
}

function parseVerifyOutput(raw: string): CommentVerifyOutput {
  const value = parseJsonBoundary(raw, "rb-comment-sync verification");
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.total) ||
    !nonNegativeInteger(value.matched) ||
    !isUnknownArray(value.missing) ||
    !value.missing.every((id) => typeof id === "string") ||
    !isUnknownArray(value.mismatched) ||
    !value.mismatched.every(isStringTriple)
  ) {
    throw new Error("rb-comment-sync verification returned an invalid payload");
  }
  return {
    total: value.total,
    matched: value.matched,
    missing: value.missing,
    mismatched: value.mismatched,
  };
}

function validateVerification(
  expected: readonly (readonly [string, string])[],
  result: CommentVerifyOutput,
): void {
  if (result.total !== expected.length)
    throw new Error(
      `comment verification read ${result.total}/${expected.length} intended rows`,
    );
  if (result.missing.length > 0)
    throw new Error(
      `comment verification missing ids: ${result.missing.join(", ")}`,
    );
  if (result.mismatched.length > 0)
    throw new Error(
      `comment verification mismatched ids: ${result.mismatched.map(([id]) => id).join(", ")}`,
    );
  if (result.matched !== expected.length)
    throw new Error(
      `comment verification matched ${result.matched}/${expected.length} intended rows`,
    );
}

function commentVerifyScript(): string {
  return `
import json, sys
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdContent
expected = {str(row[0]): str(row[1]) for row in json.load(sys.stdin)}
db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
rows = db.query(DjmdContent).filter(DjmdContent.ID.in_([int(i) for i in expected])).all() if expected else []
actual = {str(row.ID): str(row.Commnt or "") for row in rows}
db.close()
missing = sorted(i for i in expected if i not in actual)
mismatched = [[i, expected[i], actual[i]] for i in expected if i in actual and actual[i] != expected[i]]
matched = sum(1 for i in expected if actual.get(i) == expected[i])
print(json.dumps({"total": len(actual), "matched": matched, "missing": missing, "mismatched": mismatched}))
`;
}

/**
 * The sync script (all python-side, one spawn): for each master row with
 * an empty Comment and an existing file, read TXXX CAMELOT/ENERGY/MOOD
 * (+ MOODS variant) via mutagen and write the FullTags comment format
 * `Camelot · E<energy> · Mood1+Mood2`. Falls back to archive.db
 * (mood+tracks tables) when the file carries no TXXX set.
 */
export function commentSyncScript(): string {
  return `
import json, os, subprocess, sys, sqlite3

db_path, ledger_path, apply, batch, limit = sys.argv[1], sys.argv[2], sys.argv[3] == "apply", sys.argv[4], int(sys.argv[5] or 0)
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdContent
db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))

rows = []
for c in db.query(DjmdContent).all():
    p = c.FolderPath or ""
    if batch and batch not in p:
        continue
    rows.append(c)
if limit > 0:
    rows = rows[:limit]

# ledger fallback data (video_id keyed)
led = {}
if os.path.exists(ledger_path):
    con = sqlite3.connect(ledger_path)
    con.row_factory = sqlite3.Row
    for t in con.execute("select video_id, energy, genre, year, album, title, artist, file_path from tracks"):
        led.setdefault("path:" + (t["file_path"] or "").casefold(), dict(t))
        led.setdefault("id:" + t["video_id"], dict(t))
    moods_by_path = {}
    for m in con.execute("select m.video_id, m.dance, m.aggressive, m.happy, m.electronic, m.party, t.file_path from mood m join tracks t on t.video_id = m.video_id"):
        moods_by_path[(m["file_path"] or "").casefold()] = dict(m)

def read_txxx(path):
    """Read CAMELOT/ENERGY/MOOD TXXX frames + comment-format fields."""
    try:
        from mutagen import File as MFile
        a = MFile(path, easy=False)
        if a is None or not hasattr(a, "tags") or a.tags is None:
            return None
        out = {}
        for tag in a.tags.values():
            k = getattr(tag, "desc", "") or ""
            v = getattr(tag, "text", [""])
            v = str(v[0]) if v else ""
            ku = k.upper()
            if ku in ("CAMELOT", "TKEY", "INITIALKEY") and v:
                out.setdefault("key", v)
            elif ku == "ENERGY" and v:
                out.setdefault("energy", v)
            elif ku in ("MOOD", "MOODS") and v:
                out.setdefault("mood", v)
        return out or None
    except Exception:
        return None

out = {"scanned": len(rows), "eligible": 0, "written": 0, "alreadyHad": 0,
       "skipped": [], "samples": [], "writes": [], "errors": []}
pending = []
for c in rows:
    p = c.FolderPath or ""
    if (c.Commnt or "").strip():
        out["alreadyHad"] += 1
        continue
    if not os.path.exists(p):
        out["skipped"].append([p[-70:], "file missing"])
        continue
    tags = read_txxx(p)
    key = (tags or {}).get("key", "")
    energy = (tags or {}).get("energy", "")
    mood = (tags or {}).get("mood", "")
    if not energy:
        led_row = led.get("path:" + p.casefold())
        if led_row and led_row.get("energy"):
            energy = str(led_row["energy"])
    if not mood:
        m = moods_by_path.get(p.casefold())
        if m:
            tops = []
            for head, label in (("party","Party"),("dance","Dance"),("aggressive","Aggro"),("happy","Happy"),("electronic","Electronic")):
                try:
                    if float(m.get(head) or 0) >= 0.5: tops.append(label)
                except Exception: pass
            mood = "+".join(tops[:3])
    if not (energy or mood or key):
        out["skipped"].append([p[-70:], "no tag data"])
        continue
    epart = f"E{energy}" if energy else ""
    parts = [x for x in (key, epart, mood) if x]
    comment = " · ".join(parts)
    out["eligible"] += 1
    if len(out["samples"]) < 5:
        out["samples"].append([p[-60:], comment])
    if apply:
        pending.append((c, str(c.ID), comment))

if apply:
    try:
        for c, _, comment in pending:
            c.Commnt = comment
        ${RB_CLOSED_PY_GUARD}
            raise RuntimeError("rekordbox reopened before comment commit")
        db.session.commit()
        out["writes"] = [[cid, comment] for _, cid, comment in pending]
        out["written"] = len(out["writes"])
    except Exception as e:
        db.session.rollback()
        out["errors"].append(["transaction", repr(e)[:200]])

print(json.dumps(out))
db.close()
`;
}

export async function rbCommentSync(
  opts: RbCommentSyncOptions,
): Promise<RbCommentSyncResult> {
  return rbCommentSyncWithRuntime(opts, runtime);
}

async function rbCommentSyncWithRuntime(
  opts: RbCommentSyncOptions,
  deps: RbCommentSyncRuntime,
): Promise<RbCommentSyncResult> {
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    `${opts.mount.replace(/\/+$/u, "")}/PIONEER/Master/master.db`;
  const apply = opts.apply === true && opts.yes === true;
  const ledger = `${process.env.HOME}/.local/state/megadj/archive.db`;
  const mk = (
    msg: string,
    details: Partial<RbCommentSyncResult> = {},
  ): RbCommentSyncResult => ({
    command: "rb-comment-sync",
    db: dbPath,
    scanned: 0,
    eligible: 0,
    written: 0,
    skipped: [],
    alreadyHad: 0,
    appliedMode: apply,
    backedUpTo: null,
    verify: { ok: false, detail: "not run" },
    ok: false,
    error: msg,
    ...details,
  });
  /** Success result from one parsed sync output (applied/report modes). */
  const synced = (
    out: SyncOutput,
    over: {
      appliedMode: boolean;
      backedUpTo: string | null;
      verify: { ok: boolean; detail: string };
    },
  ): RbCommentSyncResult => ({
    command: "rb-comment-sync",
    db: dbPath,
    scanned: out.scanned,
    eligible: out.eligible,
    written: out.written,
    skipped: out.skipped.map(([path, reason]) => ({ path, reason })),
    alreadyHad: out.alreadyHad,
    ...over,
    ok: true,
  });

  if (opts.apply && !opts.yes)
    return mk("--apply requires --yes (report first, ALWAYS)");
  if (!deps.fileExists(dbPath)) return mk(`no master DB at ${dbPath}`);
  if (!deps.exists(ledger)) return mk(`no archive ledger at ${ledger}`);
  try {
    deps.assertClosed("rb-comment-sync");
  } catch (e) {
    return mk((e as Error).message);
  }

  if (apply) {
    let backedUpTo: string;
    try {
      backedUpTo = deps.backup(dbPath);
    } catch (error) {
      return mk(error instanceof Error ? error.message : String(error));
    }

    const compensate = (error: unknown): RbCommentSyncResult => {
      const detail = compensateRestore(deps, dbPath, backedUpTo, error);
      return mk(detail, {
        backedUpTo,
        verify: { ok: false, detail },
      });
    };

    try {
      deps.assertClosed("rb-comment-sync --apply");
      const r = deps.spawn(
        [
          "uv",
          "run",
          "--with",
          "pyrekordbox,mutagen",
          "python",
          "-c",
          commentSyncScript(),
          dbPath,
          ledger,
          "apply",
          opts.batch ?? "",
          String(opts.limit ?? 0),
        ],
        600_000,
      );
      if (r.status !== 0 || !r.stdout)
        throw new Error(
          `sync failed (exit ${String(r.status)}): ${r.stderr.slice(-300)}`,
        );
      const out = parseSyncOutput(
        r.stdout.trim().split("\n").pop() ?? "",
        true,
      );
      deps.sleep(250);
      deps.assertClosed("rb-comment-sync verification");
      const checked = deps.spawn(
        [
          "uv",
          "run",
          "--with",
          "pyrekordbox",
          "python",
          "-c",
          commentVerifyScript(),
          dbPath,
        ],
        120_000,
        JSON.stringify(out.writes),
      );
      if (checked.status !== 0 || !checked.stdout)
        throw new Error(
          `comment verification failed (exit ${String(checked.status)}): ${checked.stderr.slice(-300)}`,
        );
      const verified = parseVerifyOutput(
        checked.stdout.trim().split("\n").pop() ?? "",
      );
      validateVerification(out.writes, verified);
      return synced(out, {
        appliedMode: true,
        backedUpTo,
        verify: {
          ok: true,
          detail: `re-read ${verified.matched}/${verified.total} intended comments exactly`,
        },
      });
    } catch (error) {
      return compensate(error);
    }
  }

  let r: SyncCommandResult;
  try {
    r = deps.spawn(
      [
        "uv",
        "run",
        "--with",
        "pyrekordbox,mutagen",
        "python",
        "-c",
        commentSyncScript(),
        dbPath,
        ledger,
        "report",
        opts.batch ?? "",
        String(opts.limit ?? 0),
      ],
      600_000,
    );
  } catch (error) {
    return mk(error instanceof Error ? error.message : String(error));
  }
  if (r.status !== 0 || !r.stdout)
    return mk(
      `sync failed (exit ${String(r.status)}): ${r.stderr.slice(-300)}`,
    );
  let out: SyncOutput;
  try {
    out = parseSyncOutput(r.stdout.trim().split("\n").pop() ?? "", false);
  } catch (error) {
    return mk(error instanceof Error ? error.message : String(error));
  }
  return synced(out, {
    appliedMode: false,
    backedUpTo: null,
    verify: { ok: true, detail: "report mode — no write to verify" },
  });
}

export const __test = {
  run: rbCommentSyncWithRuntime,
  parseSyncOutput,
  parseVerifyOutput,
  validateVerification,
  commentVerifyScript,
};

export function printRbCommentSyncReport(
  r: RbCommentSyncResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `${r.scanned} rows scanned · ${r.eligible} eligible (file carries tag data) · ${r.alreadyHad} already had comments (kept) · ${r.skipped.length} skipped`,
  );
  if (r.appliedMode) {
    log(
      `wrote ${r.written} comments · backup: ${r.backedUpTo ?? "none"} · ${r.verify.detail}`,
    );
  } else {
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to write ${r.eligible} comments`,
    );
  }
}
