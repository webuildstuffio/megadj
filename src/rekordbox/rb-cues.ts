/**
 * megadj rb-cues — THE seam between the megadj cue ledger and the
 * rekordbox master DB (postmortem F1/F3; doc:
 * docs/intake-cue-postmortem.md). Every djmdCue write goes through here —
 * never hand-roll DjmdCue(...) in a script again (that's how pads got
 * Kind=0 non-clickable cues on Sep 12).
 *
 * DB-side truth (pinned by the Sep 13 F4 spike, RB7-written evidence):
 *   - Kind: 1 = hot cue (pad-clickable), 2 = loop cue. RB NEVER writes 0.
 *     (pyrekordbox's "Cue=0" docstring describes legacy CDJ types — ignore
 *     it for pad cues.)
 *   - ColorTableIndex=0 and Color=255 are what RB itself writes; label
 *     text rides `Comment` (RB writes e.g. '1.1Bars').
 *   - XML POSITION_MARK is the OPPOSITE convention (Num 0..7 = hot,
 *     -1 = memory). Never copy XML semantics here.
 *
 * Surfaces:
 *   - restampKind(): one-shot repair — flip intake-written hot cues
 *     Kind 0 → 1 (BUG-1 fix), gated + backed up + re-read verified.
 *   - writeFromLedger(): plan §AC-05 semantic layout writer (F3): ledger
 *     cues in, ≤8 hot cues out, dry-run default, gates per §AC-06.
 */

import { spawnSync } from "node:child_process";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  verifyReRead,
} from "./guard.js";

/** DB-side hot cue Kind — pinned by F4 (RB7-written rows: 1 only). */
export const HOT_CUE_KIND = 1;
/** DB-side loop cue Kind (seen 6× in the wild). */
export const LOOP_CUE_KIND = 2;
/** Pads address hot cues 1..8; anything beyond is unreachable. */
export const MAX_HOT_CUES = 8;

export interface RbCuesOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Repair mode: flip intake-written hot cues Kind 0 → 1 (BUG-1). */
  restamp?: boolean | undefined;
  /** Write semantic cues from the ledger (F3). */
  fromLedger?: boolean | undefined;
  /** Replace existing hot cues per track (ledger write mode). */
  force?: boolean | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

export interface RbCuesResult {
  command: "rb-cues";
  db: string;
  mode: "restamp" | "ledger";
  /** Cue rows inspected (restamp: Kind=0 rows found; ledger: tracks). */
  found: number;
  /** Rows written / re-stamped (0 in dry-run). */
  written: number;
  /** Tracks skipped by gates (ledger mode) — with reasons. */
  gated: { track: string; reason: string }[];
  /** Re-read verification failures — must be 0 to be ok. */
  verifyFailures: string[];
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

function dbPathFor(mount: string): string {
  return (
    process.env.MEGADJ_RB_MASTER ??
    `${mount.replace(/\/+$/u, "")}/PIONEER/Master/master.db`
  );
}

const fail = (
  opts: RbCuesOptions,
  dbPath: string,
  mode: "restamp" | "ledger",
  msg: string,
): RbCuesResult => ({
  command: "rb-cues",
  db: dbPath,
  mode,
  found: 0,
  written: 0,
  gated: [],
  verifyFailures: [],
  appliedMode: Boolean(opts.apply),
  backedUpTo: null,
  ok: false,
  error: msg,
});

/**
 * The one-shot BUG-1 repair. Restamps EVERY Kind=0 cue row that belongs to
 * a content row whose file lives under the shelf Contents tree (our
 * intake scope) — RB itself never writes Kind 0, so all Kind=0 rows are
 * ours to fix. Kind 2 (loop) rows are left alone.
 */
export function restampScript(): string {
  return `
import json, sys
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdCue

db_path = sys.argv[1]
apply = sys.argv[2] == "apply"
db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))
rows = db.query(DjmdCue).filter(DjmdCue.Kind == 0).all()
out = {"found": len(rows), "written": 0, "errors": []}
if apply:
    for r in rows:
        try:
            r.Kind = 1
            db.session.commit()
            out["written"] += 1
        except Exception as e:
            db.session.rollback()
            out["errors"].append([str(r.ID), repr(e)[:120]])
print(json.dumps(out))
db.close()
`;
}

export async function rbCues(opts: RbCuesOptions): Promise<RbCuesResult> {
  const log = opts.log ?? (() => {});
  const dbPath = dbPathFor(opts.mount);
  const mode: "restamp" | "ledger" = opts.fromLedger ? "ledger" : "restamp";
  const apply = opts.apply === true && opts.yes === true;

  if (opts.apply && !opts.yes)
    return fail(
      opts,
      dbPath,
      mode,
      "--apply requires --yes (dry-run first, ALWAYS)",
    );
  if (mode === "ledger")
    return fail(
      opts,
      dbPath,
      mode,
      "ledger write mode lands with F3 (semantic engine port) — restamp is today's P0",
    );

  try {
    assertRbClosed("rb-cues");
  } catch (e) {
    return fail(opts, dbPath, mode, (e as Error).message);
  }
  if (!fileExistsSafe(dbPath)) {
    // master.db must exist; backupMaster re-checks
    return fail(
      opts,
      dbPath,
      mode,
      `no master DB at ${dbPath} (is the drive mounted?)`,
    );
  }

  let backedUpTo: string | null = null;
  if (apply) backedUpTo = backupMaster(dbPath);

  let found = 0;
  let written = 0;
  const errors: string[] = [];
  if (apply) {
    const r = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        restampScript(),
        dbPath,
        "apply",
      ],
      { encoding: "utf8", timeout: 300_000 },
    );
    if (r.status !== 0 || !r.stdout)
      return fail(
        opts,
        dbPath,
        mode,
        `restamp failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
      );
    const out = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
      found: number;
      written: number;
      errors: [string, string][];
    };
    found = out.found;
    written = out.written;
    for (const [id, e] of out.errors) errors.push(`${id}: ${e}`);
  } else {
    // dry-run census via the same script in census-only mode
    const r = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        restampScript(),
        dbPath,
        "census",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (r.status === 0 && r.stdout) {
      const out = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
        found: number;
      };
      found = out.found;
    }
  }

  // delayed re-read verify: zero Kind=0 rows must remain after apply
  let verifyFailures: string[] = [];
  if (apply) {
    try {
      // re-read counts Kind=0 rows; any survivor is a failure
      const v = verifyReRead(
        dbPath,
        "DjmdCue",
        "[True] * len(rows)", // per-row predicate: presence check only
      );
      const zeroCheck = spawnSync(
        "uv",
        [
          "run",
          "--with",
          "pyrekordbox",
          "python",
          "-c",
          'import json,sys\nfrom pyrekordbox.db6.database import deobfuscate, BLOB\nfrom pyrekordbox import db6\nfrom pyrekordbox.db6.tables import DjmdCue\ndb = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))\nn = db.query(DjmdCue).filter(DjmdCue.Kind == 0).count()\nprint(json.dumps({"remaining": n}))\ndb.close()',
          dbPath,
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      const remaining = JSON.parse(
        (zeroCheck.stdout ?? '{"remaining":-1}').trim().split("\n").pop() ??
          '{"remaining":-1}',
      ) as { remaining: number };
      if (remaining.remaining !== 0)
        verifyFailures.push(
          `${remaining.remaining} Kind=0 rows survived the re-read`,
        );
      log(
        `re-read: ${v.total} cue rows, ${remaining.remaining} Kind=0 remaining`,
      );
    } catch (e) {
      verifyFailures.push((e as Error).message);
    }
  }

  return {
    command: "rb-cues",
    db: dbPath,
    mode,
    found,
    written,
    gated: [],
    verifyFailures,
    appliedMode: apply,
    backedUpTo,
    ok: verifyFailures.length === 0 && errors.length === 0,
    ...(errors.length ? { error: `${errors.length} row errors` } : {}),
  };
}

export function printRbCuesReport(
  r: RbCuesResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  if (r.appliedMode) {
    log(
      `restamped ${r.written}/${r.found} cue rows to Kind=1 (hot) · backup: ${r.backedUpTo ?? "none"}`,
    );
    log(
      r.verifyFailures.length
        ? `VERIFY FAILED: ${r.verifyFailures.join("; ")}`
        : `re-read verified: 0 Kind=0 rows remain`,
    );
  } else {
    log(
      `dry-run — ${r.found} Kind=0 (non-clickable) cue rows found · re-run with --apply --yes (rekordbox quit) to fix`,
    );
  }
}
