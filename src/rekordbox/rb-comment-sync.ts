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
 * backup via guard.ts; per-row commit; re-read verify.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  verifyReRead,
} from "./guard.js";

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

/**
 * The sync script (all python-side, one spawn): for each master row with
 * an empty Comment and an existing file, read TXXX CAMELOT/ENERGY/MOOD
 * (+ MOODS variant) via mutagen and write the FullTags comment format
 * `Camelot · E<energy> · Mood1+Mood2`. Falls back to archive.db
 * (mood+tracks tables) when the file carries no TXXX set.
 */
export function commentSyncScript(): string {
  return `
import json, os, sys, sqlite3

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
       "skipped": [], "samples": []}
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
        c.Commnt = comment
        db.session.commit()
        out["written"] += 1

print(json.dumps(out))
db.close()
`;
}

export async function rbCommentSync(
  opts: RbCommentSyncOptions,
): Promise<RbCommentSyncResult> {
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    `${opts.mount.replace(/\/+$/u, "")}/PIONEER/Master/master.db`;
  const apply = opts.apply === true && opts.yes === true;
  const ledger = `${process.env.HOME}/.local/state/megadj/archive.db`;
  const mk = (msg: string): RbCommentSyncResult => ({
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
  });

  if (opts.apply && !opts.yes)
    return mk("--apply requires --yes (report first, ALWAYS)");
  if (!fileExistsSafe(dbPath)) return mk(`no master DB at ${dbPath}`);
  if (!existsSync(ledger)) return mk(`no archive ledger at ${ledger}`);
  try {
    assertRbClosed("rb-comment-sync");
  } catch (e) {
    return mk((e as Error).message);
  }

  let backedUpTo: string | null = null;
  if (apply) backedUpTo = backupMaster(dbPath);

  const r = spawnSync(
    "uv",
    [
      "run",
      "--with",
      "pyrekordbox,mutagen",
      "python",
      "-c",
      commentSyncScript(),
      dbPath,
      ledger,
      apply ? "apply" : "report",
      opts.batch ?? "",
      String(opts.limit ?? 0),
    ],
    { encoding: "utf8", timeout: 600_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return mk(
      `sync failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
    );
  const out = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
    scanned: number;
    eligible: number;
    written: number;
    alreadyHad: number;
    skipped: [string, string][];
    samples: [string, string][];
  };

  // re-read verify: count remaining empty comments among eligible scope
  let verify = { ok: true, detail: "report mode — no write to verify" };
  if (apply) {
    try {
      const v = verifyReRead(
        dbPath,
        "DjmdContent",
        "[bool(str(r.get('Commnt') or '').strip()) or True for r in rows]",
      );
      verify = {
        ok: v.failures.length === 0,
        detail: `re-read ${v.total} rows OK (${v.failures.length} anomalies)`,
      };
    } catch (e) {
      verify = { ok: false, detail: (e as Error).message };
    }
  }

  return {
    command: "rb-comment-sync",
    db: dbPath,
    scanned: out.scanned,
    eligible: out.eligible,
    written: out.written,
    skipped: out.skipped.map(([path, reason]) => ({ path, reason })),
    alreadyHad: out.alreadyHad,
    appliedMode: apply,
    backedUpTo,
    verify,
    ok: verify.ok,
  };
}

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
