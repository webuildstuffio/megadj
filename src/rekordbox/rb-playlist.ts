/**
 * megadj rb-playlist — bridge a set-builder proposal into the shelf
 * master DB (rekordbox playlist). The write-side twin of `megadj
 * setbuild` (AGENTS.md: RB auto-writes are the rb-* seams' job only).
 *
 * Unlike rb-import this injects NO new DjmdContent rows: every chain
 * track was already imported by the fullpush pipeline — we only create
 * the playlist (under a parent group) and link EXISTING content rows by
 * filename. Matching prefers the NFC/casefold-normalized full path and uses
 * a basename only when it identifies exactly one content row (archive paths
 * can differ from SHELF1/Contents paths). The FileNameL 60-char clip is
 * tolerated; unmatched tracks are reported, never silently dropped.
 *
 * Safety gates (identical to rb-import):
 *   1. flags validated before any I/O (--apply requires --yes)
 *   2. set inputs validated by the SAME parser the CLI/web use
 *   3. target master DB must exist before the archive is scanned
 *   4. the chain comes from the SAME engine (`buildSet`) the CLI/web use
 *   5. rekordbox must be QUIT (pgrep) — it holds a live WAL
 *   6. dated DB backup (+ WAL/SHM) next to the master before any write
 *   7. dry-run by default; --apply --yes to write
 *   8. post-verify: song-playlist row count == linked + TrackNo contiguity
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { ArchiveReader } from "../../cratedeck/src/archive";
import {
  buildSet,
  parseSetbuildQuery,
  SET_PRESETS,
  type SetPresetId,
} from "../../cratedeck/src/setbuild";
import { clampSetPool } from "../../cratedeck/shared/types";
import {
  isFiniteNumber,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import { DB_PATH } from "../cli-env";
import {
  applyConfirmationRefusal,
  isDecimalIdOrNull,
  parseJsonBoundary,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";
import { commandLog } from "../progress";
import { rekordboxRunning } from "./guard.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";

export interface RbPlaylistOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Same params as `megadj setbuild` — one engine, one validation. */
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  /** Playlist name (defaults to "setbuild <preset> <minutes>min <date>"). */
  playlist?: string | undefined;
  /** Parent playlist group (defaults to the proven "DJ-Imports"). */
  group?: string | undefined;
  apply?: boolean;
  yes?: boolean;
  log?: (s: string) => void;
}

export interface RbPlaylistResult {
  command: "rb-playlist";
  db: string;
  playlist: string;
  group: string;
  preset: string;
  minutes: number;
  /** Tracks in the built chain. */
  chain: number;
  /** Chain tracks matched to existing master content rows. */
  linked: number;
  /** Chain tracks with NO content row in the master (not imported yet). */
  unmatched: { title: string; reason: string }[];
  /** In apply mode: playlist row ID. */
  playlistId: string | null;
  /** Post-write verify: song-playlist rows under our playlist. */
  verified: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  errors: string[];
  ok: boolean;
  error?: string;
}

const PYRK_TAG =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git@f695541827cc488af267d6ca8a8e0052598d85a0";

/** Python side: match chain basenames → content IDs, create/link the
 *  playlist. Per-link commit (one bad row never kills the batch);
 *  playlist row committed once; duplicate name is a LOUD error, never a
 *  silent merge. NFC normalization kills the macOS NFD trap that made a
 *  1/60 basename miss ("Hernández" bytes differ across filesystems). */
function buildScript(): string {
  return `
import json, os, sys, unicodedata, uuid, datetime
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdPlaylist, DjmdSongPlaylist

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
chain, playlist_name, group_name = payload["chain"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"linked": 0, "unmatched": [], "playlistId": None, "parentId": None, "errors": []}

def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s

def path_key(s):
    return nfc(s).casefold()

# Exact normalized path wins. Basename fallback is allowed only when it is
# unique; duplicate filenames across artist folders are ambiguous and must
# never silently link the arbitrary first row.
by_path = {}
by_base = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        path = path_key(c.FolderPath)
        by_path.setdefault(path, c.ID)
        b = path_key(os.path.basename(path))
        by_base.setdefault(b, []).append(c.ID)

content_ids = []
for track in chain:
    path = path_key(track["path"])
    base = path_key(track["base"])
    cid = by_path.get(path)
    candidates = by_base.get(base, []) if cid is None else []
    if cid is None and not candidates and len(base) > 60:
        # tolerate the FileNameL 60-char clip ("..." suffix), still unique-only
        candidates = by_base.get(base[:57] + "...", [])
    if cid is None and len(candidates) == 1:
        cid = candidates[0]
    if cid is None and len(candidates) > 1:
        out["unmatched"].append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        out["unmatched"].append(track["title"][:70])
        continue
    content_ids.append(cid)

def find_playlist(name, attr, parent_id):
    parent = None if parent_id == 0 else db.query(DjmdPlaylist).filter(DjmdPlaylist.ID == parent_id).first()
    expected_parent_id = parent.ID if parent is not None else 0
    q = db.query(DjmdPlaylist).filter(
        DjmdPlaylist.Name == name,
        DjmdPlaylist.Attribute == attr,
        DjmdPlaylist.ParentID == parent_id,
    )
    for p in q.all():
        if str(p.ParentID or 0) == str(expected_parent_id):
            return p
    return None

def rid():
    return db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF

parent = find_playlist(group_name, 1, 0)
if parent is None:
    parent = DjmdPlaylist(ID=rid(), Name=group_name, Attribute=1, ParentID=0,
                          Seq=db.query(DjmdPlaylist).count() + 1,
                          UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
    db.add(parent); db.session.commit()
out["parentId"] = str(parent.ID)

if find_playlist(playlist_name, 0, parent.ID) is not None:
    out["errors"].append('playlist "%s" already exists in "%s" — rename it, delete it, or pass --playlist' % (playlist_name, group_name))
    print(json.dumps(out)); db.close(); sys.exit(0)

pl = DjmdPlaylist(ID=rid(), Name=playlist_name, Attribute=0,
                  ParentID=parent.ID, Seq=db.query(DjmdPlaylist).count() + 1,
                  UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
db.add(pl); db.session.commit()
out["playlistId"] = str(pl.ID)

track_no = 0
for cid in content_ids:
    try:
        sp = DjmdSongPlaylist(ID=rid(), PlaylistID=pl.ID, ContentID=cid,
                              TrackNo=track_no + 1, UUID=str(uuid.uuid4()),
                              created_at=now, updated_at=now)
        db.add(sp); db.session.commit()
        track_no += 1
        out["linked"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append("link %s: %s" % (cid, repr(e)[:120]))

print(json.dumps(out))
db.close()
`;
}

/** Python verify: song-playlist rows under the playlist + TrackNo
 *  contiguity. Read-only. */
function verifyScript(): string {
  return `
import json, sys
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdSongPlaylist

db = Rekordbox6Database(sys.argv[1])
pid = int(sys.argv[2])
rows = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pid).all()
nos = sorted(r.TrackNo for r in rows)
contiguous = nos == list(range(1, len(nos) + 1))
print(json.dumps({"rows": len(rows), "contiguous": contiguous}))
db.close()
`;
}

interface PyOut {
  linked: number;
  unmatched: string[];
  playlistId: string | null;
  parentId: string | null;
  errors: string[];
}

interface PlaylistVerifyOut {
  rows: number;
  contiguous: boolean;
}

interface MatchPrediction {
  hit: number;
  unmatched: string[];
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    isUnknownArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function parseWriteOutput(raw: string): PyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist write");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.linked) ||
    !isStringArray(value.unmatched) ||
    !isDecimalIdOrNull(value.playlistId) ||
    !isDecimalIdOrNull(value.parentId) ||
    !isStringArray(value.errors)
  ) {
    throw new Error(
      "pyrekordbox playlist write returned an invalid result payload",
    );
  }
  return {
    linked: value.linked,
    unmatched: value.unmatched,
    playlistId: value.playlistId,
    parentId: value.parentId,
    errors: value.errors,
  };
}

function parseVerifyOutput(raw: string): PlaylistVerifyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist post-verify");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.rows) ||
    typeof value.contiguous !== "boolean"
  ) {
    throw new Error(
      "pyrekordbox playlist post-verify returned an invalid result payload",
    );
  }
  return { rows: value.rows, contiguous: value.contiguous };
}

function parseMatchPrediction(raw: string): MatchPrediction {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist match probe");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.hit) ||
    !isStringArray(value.unmatched)
  ) {
    throw new Error(
      "pyrekordbox playlist match probe returned an invalid result payload",
    );
  }
  return { hit: value.hit, unmatched: value.unmatched };
}

/** Deterministic date stamp for the default playlist name. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ChainTrack {
  videoId: string;
  path: string | null;
  base: string | null;
  title: string | null;
}

/** Build the chain with the SAME engine the CLI/web use, and keep each
 *  track's archive FILENAME — the join key into the master's content
 *  rows. One readonly archive pass; candidates carry file_path. */
function buildChain(
  opts: RbPlaylistOptions,
  parsed: { preset: SetPresetId; minutes: number },
):
  { chain: ChainTrack[]; preset: string; minutes: number } | { error: string } {
  const archive = new ArchiveReader(DB_PATH);
  try {
    if (!archive.available()) return { error: `no archive at ${DB_PATH}` };
    const { candidates } = archive.setCandidates(
      clampSetPool(opts.limit ?? null),
    );

    const built = buildSet({
      candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: opts.opener,
    });
    const byId = new Map(
      candidates.map((c) => [c.videoId, c.filePath] as const),
    );
    return {
      chain: built.steps.map((s) => {
        const fp = byId.get(s.videoId);
        return {
          videoId: s.videoId,
          path: fp ?? null,
          // the FILENAME is the join key into the master's content rows —
          // basename it ONCE here so every consumer (predict, apply)
          // sends exactly what buildScript matches
          base: fp ? basename(fp) : null,
          title: s.title ?? s.videoId,
        };
      }),
      preset: parsed.preset,
      minutes: parsed.minutes,
    };
  } finally {
    archive.close();
  }
}

export async function rbPlaylist(
  opts: RbPlaylistOptions,
): Promise<RbPlaylistResult> {
  const log = opts.log ?? commandLog({});
  const dbPath = masterDbPath(opts.mount);
  const group = opts.group ?? "DJ-Imports";

  const fail = (
    msg: string,
    details: Partial<RbPlaylistResult> = {},
  ): RbPlaylistResult => ({
    command: "rb-playlist",
    db: dbPath,
    playlist: opts.playlist ?? "",
    group,
    preset: opts.preset ?? "peak",
    minutes: 0,
    chain: 0,
    linked: 0,
    unmatched: [],
    playlistId: null,
    verified: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    errors: [],
    ...details,
    ok: false,
    error: msg,
  });

  // gate 1 — flags before any I/O
  if (applyConfirmationRefusal(opts) !== null)
    return fail(applyConfirmationRefusal(opts) ?? "unreachable");

  // gate 2 — validate the shared set-builder inputs without touching either
  // database. Invalid presets must still beat a missing-drive error.
  const parsed = parseSetbuildQuery({
    preset: opts.preset ?? null,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) return fail(parsed.error);

  // gate 3 — reject an absent master before scanning/probing every archive
  // file. This is both the cheap failure path and a hardware safety boundary.
  if (!existsSync(dbPath)) return fail(`no master DB at ${dbPath}`);

  // gate 4 — the chain (same engine as setbuild CLI/web)
  const built = buildChain(opts, parsed);
  if ("error" in built) return fail(built.error);
  const { chain, preset, minutes } = built;
  const noFile = chain.filter((c) => c.base === null).length;
  if (noFile > 0)
    log(
      `rb-playlist: ${noFile} chain tracks have no local file path — reported as unmatched`,
    );
  const playlist =
    opts.playlist ?? `setbuild ${preset} ${minutes}min ${todayStamp()}`;
  log(
    `rb-playlist: chain of ${chain.length} (${preset}, ${minutes} min) → "${playlist}" in "${group}" on ${dbPath}`,
  );

  // gate 5 — rekordbox quit
  if (rekordboxRunning())
    return fail("rekordbox is running — quit it (live WAL) before rb-playlist");

  let backedUpTo: string | null = null;
  let py: PyOut = {
    linked: 0,
    unmatched: [],
    playlistId: null,
    parentId: null,
    errors: [],
  };

  let verified = 0;
  if (opts.apply && opts.yes) {
    try {
      const mutation = applyPlaylistTwinMutation({
        dbPath,
        what: "rb-playlist",
        log,
        onBackup: ({ db }) => {
          backedUpTo = db;
        },
        mutateDb: () => {
          const result = spawnSync(
            "uv",
            [
              "run",
              "--with",
              PYRK_TAG,
              "python",
              "-c",
              buildScript(),
              dbPath,
              JSON.stringify({
                chain: chain.map((track) => ({
                  path: track.path ?? "",
                  base: track.base ?? "",
                  title: track.title,
                })),
                playlist,
                group,
              }),
            ],
            { encoding: "utf8", timeout: 300_000 },
          );
          if (result.status !== 0 || !result.stdout)
            throw new Error(
              `pyrekordbox write failed (exit ${String(result.status)}): ${(result.stderr ?? "").slice(-400)}`,
            );
          const value = parseWriteOutput(
            result.stdout.trim().split("\n").pop() ?? "",
          );
          if (
            value.playlistId === null ||
            value.parentId === null ||
            value.errors.length > 0
          )
            throw new Error(
              value.errors[0] ??
                "pyrekordbox playlist write returned incomplete playlist ids",
            );
          return value;
        },
        nodes: (value) => {
          if (value.playlistId === null || value.parentId === null)
            throw new Error("playlist mutation returned incomplete ids");
          return [
            { id: value.parentId, name: group, parentId: "0", attribute: 1 },
            {
              id: value.playlistId,
              name: playlist,
              parentId: value.parentId,
              attribute: 0,
            },
          ];
        },
        verifyDb: (value) => {
          if (value.playlistId === null)
            throw new Error("playlist mutation returned no playlist id");
          const result = spawnSync(
            "uv",
            [
              "run",
              "--with",
              PYRK_TAG,
              "python",
              "-c",
              verifyScript(),
              dbPath,
              value.playlistId,
            ],
            { encoding: "utf8", timeout: 120_000 },
          );
          if (result.status !== 0 || !result.stdout)
            throw new Error(
              `pyrekordbox playlist post-verify failed (exit ${String(result.status)}): ${(result.stderr ?? "").slice(-400)}`,
            );
          const check = parseVerifyOutput(
            result.stdout.trim().split("\n").pop() ?? "",
          );
          verified = check.rows;
          if (!check.contiguous || verified !== value.linked)
            throw new Error(
              !check.contiguous
                ? "post-verify: TrackNo sequence is not contiguous"
                : `post-verify: ${verified}/${value.linked} linked rows found`,
            );
        },
      });
      py = mutation.value;
      backedUpTo = mutation.backedUpTo;
    } catch (error) {
      const message = errorText(error);
      return fail(message, {
        playlist,
        group,
        preset,
        minutes,
        chain: chain.length,
        linked: py.linked,
        verified,
        playlistId: py.playlistId,
        backedUpTo,
        errors: [...py.errors, message],
      });
    }
  }

  // dry-run honesty: predict the matches READ-ONLY so the report shows
  // real numbers, never a fake "0 linked"
  let unmatched = py.unmatched;
  if (!(opts.apply && opts.yes)) {
    try {
      const pred = predictMatches(
        dbPath,
        chain.map((c) => ({ path: c.path, base: c.base, title: c.title })),
      );
      unmatched = pred.unmatched;
      log(
        `rb-playlist: predict ${pred.hit}/${chain.length} chain tracks have master rows (read-only probe)`,
      );
    } catch (error) {
      const message = errorText(error);
      return fail(message, {
        playlist,
        group,
        preset,
        minutes,
        chain: chain.length,
        errors: [message],
      });
    }
  }

  return {
    command: "rb-playlist",
    db: dbPath,
    playlist,
    group,
    preset,
    minutes,
    chain: chain.length,
    linked: py.linked,
    unmatched: unmatched.map((t) => ({
      title: t,
      reason: "no content row in master — run the fullpush import for it first",
    })),
    playlistId: py.playlistId,
    verified,
    appliedMode: Boolean(opts.apply),
    backedUpTo,
    errors: py.errors,
    ok: true,
  };
}

/** Python probe (READ-ONLY): which chain basenames have a content row in
 *  the master — powers the dry-run report so the user sees the real link
 *  count BEFORE writing anything. Same matching as buildScript. */
function predictScript(): string {
  return `
import json, os, sys, unicodedata
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent

db = Rekordbox6Database(sys.argv[1])
chain = json.loads(sys.argv[2])["chain"]

def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s

def path_key(s):
    return nfc(s).casefold()

by_path = {}
by_base = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        path = path_key(c.FolderPath)
        by_path.setdefault(path, c.ID)
        b = path_key(os.path.basename(path))
        by_base.setdefault(b, []).append(c.ID)

hit = 0
unmatched = []
for track in chain:
    path = path_key(track["path"])
    base = path_key(track["base"])
    cid = by_path.get(path)
    candidates = by_base.get(base, []) if cid is None else []
    if cid is None and not candidates and len(base) > 60:
        candidates = by_base.get(base[:57] + "...", [])
    if cid is None and len(candidates) == 1:
        cid = candidates[0]
    if cid is None and len(candidates) > 1:
        unmatched.append((track["title"] + " (ambiguous filename)")[:100])
        continue
    if cid is None:
        unmatched.append(track["title"][:70])
    else:
        hit += 1
print(json.dumps({"hit": hit, "unmatched": unmatched}))
db.close()
`;
}

/** Dry-run prediction: read-only probe of the master (no writes). */
function predictMatches(
  dbPath: string,
  chain: { path: string | null; base: string | null; title: string | null }[],
): { hit: number; unmatched: string[] } {
  const r = spawnSync(
    "uv",
    [
      "run",
      "--with",
      PYRK_TAG,
      "python",
      "-c",
      predictScript(),
      dbPath,
      JSON.stringify({
        chain: chain.map((c) => ({
          path: c.path ?? "",
          base: c.base ?? "",
          title: c.title,
        })),
      }),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  return parsePredictionProcess(r);
}

function parsePredictionProcess(result: {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}): MatchPrediction {
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `rb-playlist match probe failed (exit ${String(result.status)}): ${(result.stderr ?? "").slice(-200)}`,
    );
  }
  try {
    return parseMatchPrediction(result.stdout.trim().split("\n").pop() ?? "");
  } catch (error) {
    throw new Error(
      `rb-playlist match probe returned an invalid result: ${errorText(error)}`,
      { cause: error },
    );
  }
}

export const __test = {
  buildScript,
  parsePredictionProcess,
  predictScript,
  parseWriteOutput,
  parseVerifyOutput,
  parseMatchPrediction,
};

export function printRbPlaylistReport(
  r: RbPlaylistResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `chain ${r.chain} → linked ${r.linked} · playlist "${r.playlist}" (in "${r.group}") on ${r.db}`,
  );
  for (const u of r.unmatched.slice(0, 10)) log(`  ? ${u.title} — ${u.reason}`);
  if (r.unmatched.length > 10)
    log(`  … and ${r.unmatched.length - 10} more unmatched`);
  for (const e of r.errors.slice(0, 10)) log(`  ✗ ${e}`);
  if (r.appliedMode) {
    log(
      `post-verify: ${r.verified}/${r.linked} rows linked${r.backedUpTo ? ` · backup ${r.backedUpTo}` : ""}`,
    );
  } else {
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to create the playlist and link ${r.chain} tracks`,
    );
    if (r.unmatched.length > 0) {
      log(
        `${r.unmatched.length} chain track(s) have no master row yet — they will be skipped and reported`,
      );
    }
  }
}
