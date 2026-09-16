/**
 * megadj rb-import — the sanctioned headless master-DB import (AGENTS.md:
 * "RB auto-writes are rb-import's job only"). Creates one playlist per
 * intake folder under a parent group and inserts DjmdContent rows for
 * every audio file in the folder.
 *
 * Safety gates (each is a hard failure, never a warning):
 *   1. rekordbox must be QUIT (pgrep) — it holds a live WAL
 *   2. dated DB backup (+ WAL/SHM) next to the master before any write
 *   3. dry-run by default; --apply --yes to write
 *   4. per-row transactions; one bad row never kills the batch
 *   5. whole-table post-verify: every row's FolderPath exists on disk,
 *      plus row-count check of exactly what we inserted
 *
 * File fields follow the proven Sep 11 one-off (docs/usb-sync-log.md):
 * SamplerGain float (empty string crashes the flush), FileNameL clipped
 * to 60 chars, FileType by extension, FolderPath as the FULL path.
 */

import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  isNonNegativeInteger,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import { probeMediaSync } from "../../fulltags/src/exports";
import { rekordboxRunning } from "./guard.js";
import {
  applyConfirmationRefusal,
  isDecimalIdOrNull,
  isStringPair,
  lastJsonLine,
  makeFail,
  parseJsonBoundary,
  printResult,
  runPyScript,
} from "./rb-command-kit.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";
import { commandLog } from "../progress";
import { errorText } from "../shared/error-text.js";
import { masterDbPath } from "./master-path.js";

export interface RbImportOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Absolute folder whose AUDIO FILES get imported. */
  folder: string;
  /** Playlist name for the batch (defaults to the folder basename). */
  playlist?: string | undefined;
  /** Parent playlist group name (nested folder in the RB sidebar). */
  group?: string | undefined;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
}

export interface RbImportResult {
  command: "rb-import";
  db: string;
  folder: string;
  playlist: string;
  group: string | null;
  /** Audio files found in the folder. */
  found: number;
  /** Rows inserted (0 in dry-run). */
  inserted: number;
  /** Rows skipped because a content row already references the file. */
  already: number;
  /** Post-write verification: rows referencing our files (must equal
   *  found in apply mode). */
  verified: number;
  /** Whole-table check after write: rows (any) whose path is missing. */
  stillBroken: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  /** Playlist row ID (apply mode). */
  playlistId: string | null;
  errors: string[];
  ok: boolean;
  error?: string;
}

const AUDIO_EXT = new Set([
  ".aiff",
  ".aif",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
]);

/** Gate 1–4 of rb-import (issue #181 phase split): the hard pre-flight
 *  refusals, in order — flags, DB present, folder present, rekordbox
 *  quit. Each is a failure with its own message; null = all clear. */
function importGateRefusal(
  opts: RbImportOptions,
  dbPath: string,
): string | null {
  // gate 1 — flags before any I/O
  const flagRefusal = applyConfirmationRefusal(opts);
  if (flagRefusal !== null) return flagRefusal;
  // gate 2 — DB present
  if (!existsSync(dbPath)) return `no master DB at ${dbPath}`;
  // gate 3 — folder present
  if (!existsSync(folderArg(opts))) return `no such folder: ${opts.folder}`;
  // gate 4 — rekordbox quit
  if (rekordboxRunning())
    return "rekordbox is running — quit it (live WAL) before rb-import";
  return null;
}

const folderArg = (opts: RbImportOptions): string =>
  opts.folder.replace(/\/+$/u, "");

/** rb-import phase 2 (#181): scan the flat intake folder for audio files
 *  and probe each via the ffprobe seam so rows carry real duration/
 *  bitrate. Tag halves parse the archive convention
 *  "Artist · Album · Title" from the stem. Returns the Python payload
 *  rows (full path first — the write script's FolderPath source). */
function probePayloadFiles(
  folder: string,
  log: (s: string) => void,
): (string | number | null)[][] {
  const files: [string, string][] = [];
  // single-level intake-folder listing (the gate above already failed on
  // a missing folder; a top-level readdir is the documented rb-import
  // shape — intake batches are flat) — not the recursive tree walk
  for (const e of readdirSync(folder)) {
    if (e.startsWith(".")) continue;
    const full = join(folder, e);
    let st: Stats;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && AUDIO_EXT.has(extname(e).toLowerCase()))
      files.push([full, e]);
  }
  if (files.length === 0) return [];

  // probe durations/bitrate via ffprobe so rows carry real values
  // (THE media seam, #80 — one spawn style, guarded JSON boundary)
  const payloadFiles: (string | number | null)[][] = [];
  for (const [full, fname] of files) {
    const probe = probeMediaSync(full);
    const duration = probe?.durationS ?? 0;
    const bitrate = probe?.bitrateKbps ?? 0;
    // tags come from the archive DB conventions: parse "Artist · Album · Title"
    const stem = fname.replace(/\.[^.]+$/u, "");
    const parts = stem.split(" · ");
    const title = parts[2] ?? parts[1] ?? stem;
    const artist = parts.length >= 3 ? (parts[0] ?? null) : (parts[0] ?? null);
    payloadFiles.push([
      full,
      fname,
      title,
      artist,
      null,
      null,
      null,
      duration,
      bitrate,
      null,
      null,
    ]);
  }
  log(`rb-import: probed ${payloadFiles.length} audio files`);
  return payloadFiles;
}

/** The full write script: idempotent (skips files that already have a
 *  content row), per-row commit, playlist per folder, rows returned for
 *  verification. All Python-side so one spawn does the whole job. */
function buildScript(): string {
  return `
import json, os, sys, unicodedata, uuid, datetime
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdArtist, DjmdPlaylist, DjmdSongPlaylist

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
files, playlist_name, group_name = payload["files"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"inserted": 0, "already": 0, "linked": 0, "playlistId": None, "parentId": None, "errors": []}

def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s

def path_key(s):
    return nfc(s).casefold()

existing = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        existing[path_key(c.FolderPath)] = c.ID

# --- playlist (child of group when given) ---
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

parent = None
if group_name:
    parent = find_playlist(group_name, 1, 0)
    if parent is None:
        pid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
        parent = DjmdPlaylist(ID=pid, Name=group_name, Attribute=1, ParentID=0,
                              Seq=db.query(DjmdPlaylist).count() + 1,
                              UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
        db.add(parent); db.session.commit()
    out["parentId"] = str(parent.ID)

pl = find_playlist(playlist_name, 0, parent.ID if parent else 0)
if pl is None:
    seq = db.query(DjmdPlaylist).count() + 1
    pid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
    pl = DjmdPlaylist(ID=pid, Name=playlist_name, Attribute=0,
                      ParentID=parent.ID if parent else 0, Seq=seq,
                      UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
    db.add(pl); db.session.commit()
out["playlistId"] = str(pl.ID)

track_no = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pl.ID).count()
playlist_content = {
    r.ContentID for r in db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pl.ID).all()
}

master_db_id = ""
c0 = db.query(DjmdContent).first()
if c0 is not None and getattr(c0, "MasterDBID", None):
    master_db_id = c0.MasterDBID

device_id = "adeae5be-3cc0-4f1d-bb8a-cf6c61c01bdf"

for f in files:
    full, fname, title, artist, album, genre, year, duration, bitrate, bpm, key = f
    cid = existing.get(path_key(full))
    if cid is not None:
        out["already"] += 1
    else:
        try:
            ext = os.path.splitext(fname)[1].lower()
            file_type = {".mp3": 1, ".wav": 11, ".aiff": 12, ".aif": 12,
                         ".flac": 14, ".m4a": 5, ".aac": 5}.get(ext, 0)
            clip = fname if len(fname) <= 60 else fname[:57] + "..."
            art_id = None
            if artist:
                a = db.query(DjmdArtist).filter(DjmdArtist.Name == artist).first()
                if a is None:
                    aid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
                    a = DjmdArtist(ID=aid, Name=artist, UUID=str(uuid.uuid4()),
                                   created_at=now, updated_at=now)
                    db.add(a); db.session.commit()
                art_id = a.ID
            cid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
            row = DjmdContent(
                ID=cid, FolderPath=full, FileNameL=clip, Title=title or fname,
                ArtistID=art_id, AlbumID=None, GenreID=None,
                BPM=bpm, Length=duration, BitRate=bitrate, BitDepth=0,
                FileType=file_type, Rating=0, ReleaseYear=year, KeyID=None,
                StockDate=now.strftime("%Y-%m-%d"), ColorID=0,
                MasterDBID=master_db_id,
                UUID=str(uuid.uuid4()),
                FileSize=os.path.getsize(full) if os.path.exists(full) else 0,
                SearchStr=(title or "") + " " + (artist or ""),
                Commnt="",
                SamplerGain=0.0, VideoAssociate=0, Lyricist="",
                ServiceID=0, OrgFolderPath="", Reserved1="", Reserved2="", Reserved3="", Reserved4="",
                ExtInfo="null",
                DeviceID=device_id,
                SrcID=0, SrcTitle="", SrcArtistName="", SrcAlbumName="",
                SrcLength=0, rb_data_status=0, rb_local_data_status=0,
                rb_local_deleted=0, rb_local_synced=0, usn=None, rb_local_usn=0,
                created_at=now, updated_at=now,
            )
            db.add(row)
            db.session.commit()
            out["inserted"] += 1
            existing[path_key(full)] = cid
        except Exception as e:
            db.session.rollback()
            out["errors"].append([os.path.basename(full)[:60], repr(e)[:140]])
            continue
    try:
        if cid not in playlist_content:
            # playlist membership for both new and already-imported content
            # so re-runs repair an incomplete batch playlist idempotently.
            spid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
            sp = DjmdSongPlaylist(ID=spid, PlaylistID=pl.ID, ContentID=cid,
                                  TrackNo=track_no + 1, UUID=str(uuid.uuid4()),
                                  created_at=now, updated_at=now)
            db.add(sp); db.session.commit()
            track_no += 1
            playlist_content.add(cid)
            out["linked"] += 1
    except Exception as e:
        db.session.rollback()
        out["errors"].append([os.path.basename(full)[:60], repr(e)[:140]])

print(json.dumps(out))
db.close()
`;
}

interface PyOut {
  inserted: number;
  already: number;
  linked: number;
  playlistId: string | null;
  parentId: string | null;
  errors: [string, string][];
}

interface VerifyOut {
  hit: number;
  broken: number;
  total: number;
  playlistRows: number;
  contiguous: boolean;
  playlistExists: boolean;
}

function parseWriteOutput(raw: string): PyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox write");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.inserted) ||
    !isNonNegativeInteger(value.already) ||
    !isNonNegativeInteger(value.linked) ||
    !isDecimalIdOrNull(value.playlistId) ||
    !isDecimalIdOrNull(value.parentId) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(isStringPair)
  ) {
    throw new Error("pyrekordbox write returned an invalid result payload");
  }
  return {
    inserted: value.inserted,
    already: value.already,
    linked: value.linked,
    playlistId: value.playlistId,
    parentId: value.parentId,
    errors: value.errors,
  };
}

function parseVerifyOutput(raw: string): VerifyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox post-verify");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.hit) ||
    !isNonNegativeInteger(value.broken) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.playlistRows) ||
    typeof value.contiguous !== "boolean" ||
    typeof value.playlistExists !== "boolean"
  ) {
    throw new Error("pyrekordbox post-verify returned invalid counters");
  }
  return {
    hit: value.hit,
    broken: value.broken,
    total: value.total,
    playlistRows: value.playlistRows,
    contiguous: value.contiguous,
    playlistExists: value.playlistExists,
  };
}

function verificationError(
  found: number,
  py: PyOut,
  verified: VerifyOut,
): string | null {
  if (py.errors.length > 0)
    return `pyrekordbox write reported ${py.errors.length} row error(s)`;
  if (py.inserted + py.already !== found)
    return `pyrekordbox write accounted for ${py.inserted + py.already}/${found} imported files`;
  if (verified.total < verified.hit)
    return `post-verify returned impossible counters (${verified.hit} hits across ${verified.total} rows)`;
  if (verified.hit !== found)
    return `post-verify referenced ${verified.hit}/${found} imported files`;
  if (verified.broken !== 0)
    return `post-verify found ${verified.broken} missing file path(s) in the collection`;
  if (!verified.playlistExists)
    return "post-verify could not re-read the playlist row";
  if (!verified.contiguous)
    return "post-verify found a non-contiguous playlist TrackNo sequence";
  if (verified.playlistRows !== found)
    return `post-verify found ${verified.playlistRows}/${found} playlist member rows`;
  return null;
}

/** The delayed fresh-process verification script: covers content paths,
 *  playlist membership, and TrackNo continuity. The shared twin seam
 *  separately verifies XML. */
const VERIFY_SCRIPT =
  "import json,os,sys;from pyrekordbox import Rekordbox6Database as R\n" +
  "from pyrekordbox.db6.tables import DjmdContent,DjmdPlaylist,DjmdSongPlaylist\n" +
  "db=R(sys.argv[1]);files=set(json.loads(sys.argv[2]));pid=int(sys.argv[3])\n" +
  "rows=db.query(DjmdContent).all()\n" +
  "hit=sum(1 for c in rows if c.FolderPath in files)\n" +
  "broken=sum(1 for c in rows if c.FolderPath and not (os.path.exists(c.FolderPath) or os.path.basename(c.FolderPath) in files))\n" +
  "members=db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pid).all()\n" +
  "nos=sorted(r.TrackNo for r in members)\n" +
  "playlist_exists=db.query(DjmdPlaylist).filter(DjmdPlaylist.ID == pid).first() is not None\n" +
  'print(json.dumps({"hit":hit,"broken":broken,"total":len(rows),"playlistRows":len(members),"contiguous":nos == list(range(1,len(nos)+1)),"playlistExists":playlist_exists}));db.close()';

/** The success counters + error bookkeeping the apply phase threads
 *  through (mutation + verify callbacks write into these). */
interface ApplyCounters {
  py: PyOut;
  backedUpTo: string | null;
  verified: number;
  stillBroken: number;
}

/** rb-import phase 3 (#181): the ONE sanctioned master-DB write — dated
 *  backup via the twin seam, pyrekordbox write, XML twin nodes, delayed
 *  fresh-process post-verify. Throws only for the caller's failure
 *  envelope; all counters are kept in `counters` so a mid-apply error
 *  still reports partial state. */
function applyImport(
  ctx: {
    dbPath: string;
    folder: string;
    playlist: string;
    group: string | null;
    payloadFiles: (string | number | null)[][];
    log: (s: string) => void;
  },
  counters: ApplyCounters,
): void {
  const { dbPath, playlist, group, payloadFiles, log } = ctx;
  const mutation = applyPlaylistTwinMutation({
    dbPath,
    what: "rb-import",
    log,
    onBackup: ({ db }) => {
      counters.backedUpTo = db;
    },
    mutateDb: () => {
      const result = runPyScript({
        script: buildScript(),
        dbPath,
        args: [JSON.stringify({ files: payloadFiles, playlist, group })],
        timeoutMs: 300_000,
        label: "pyrekordbox write",
      });
      const value = parseWriteOutput(lastJsonLine(result.stdout));
      if (value.playlistId === null || value.errors.length > 0)
        throw new Error(
          value.errors[0]?.join(": ") ??
            "pyrekordbox write returned no playlist id",
        );
      return value;
    },
    nodes: (value) => {
      if (value.playlistId === null)
        throw new Error("playlist mutation returned no playlist id");
      const parentId = value.parentId ?? "0";
      return [
        ...(group && value.parentId
          ? [
              {
                id: value.parentId,
                name: group,
                parentId: "0",
                attribute: 1,
              },
            ]
          : []),
        {
          id: value.playlistId,
          name: playlist,
          parentId,
          attribute: 0,
        },
      ];
    },
    verifyDb: (value) => {
      if (value.playlistId === null)
        throw new Error("playlist mutation returned no playlist id");
      const result = runPyScript({
        script: VERIFY_SCRIPT,
        dbPath,
        args: [
          JSON.stringify(payloadFiles.map((file) => file[0])),
          value.playlistId,
        ],
        timeoutMs: 120_000,
        label: "pyrekordbox post-verify",
      });
      const verify = parseVerifyOutput(lastJsonLine(result.stdout));
      counters.verified = verify.hit;
      counters.stillBroken = verify.broken;
      const failure = verificationError(payloadFiles.length, value, verify);
      if (failure) throw new Error(failure);
    },
  });
  counters.py = mutation.value;
  counters.backedUpTo = mutation.backedUpTo;
}

export async function rbImport(opts: RbImportOptions): Promise<RbImportResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  // Issue #66 SSOT: masterDbPath owns the env override + every layout
  // form — rb-import was the last hand-rolled join, so MEGADJ_RB_MASTER
  // was honored by every rb-* caller except this one until now.
  const dbPath = masterDbPath(opts.mount);
  const folder = opts.folder.replace(/\/+$/u, "");
  const playlist = opts.playlist ?? basename(folder);
  const group = opts.group ?? null;

  const fail = makeFail((msg: string): RbImportResult => ({
    command: "rb-import",
    db: dbPath,
    folder,
    playlist,
    group,
    found: 0,
    inserted: 0,
    already: 0,
    verified: 0,
    stillBroken: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    playlistId: null,
    errors: [],
    ok: false,
    error: msg,
  }));

  // gates 1–4 (flags → DB → folder → rekordbox quit), extracted (#181)
  const gateRefusal = importGateRefusal(opts, dbPath);
  if (gateRefusal !== null) return fail(gateRefusal);

  // phase 2 — folder scan + ffprobe payload build (extracted, #181)
  const payloadFiles = probePayloadFiles(folder, log);
  if (payloadFiles.length === 0) return fail(`no audio files in ${folder}`);

  log(
    `rb-import: ${payloadFiles.length} audio files → playlist "${playlist}"${group ? ` in group "${group}"` : ""} on ${dbPath}`,
  );

  // phase 3 — the apply write (backup → pyrekordbox → XML twin → verify),
  // extracted (#181). Counters thread partial state back into the result
  // envelope when a mid-apply error fires.
  const counters: ApplyCounters = {
    py: {
      inserted: 0,
      already: 0,
      linked: 0,
      playlistId: null,
      parentId: null,
      errors: [],
    },
    backedUpTo: null,
    verified: 0,
    stillBroken: 0,
  };
  if (opts.apply && opts.yes) {
    try {
      applyImport(
        { dbPath, folder, playlist, group, payloadFiles, log },
        counters,
      );
    } catch (error) {
      const message = errorText(error);
      const { py, backedUpTo, verified, stillBroken } = counters;
      return {
        ...fail(message),
        found: payloadFiles.length,
        inserted: py.inserted,
        already: py.already,
        verified,
        stillBroken,
        playlistId: py.playlistId,
        backedUpTo,
        errors: [
          ...py.errors.map(([file, detail]) => `${file}: ${detail}`),
          message,
        ],
      };
    }
  }

  return {
    command: "rb-import",
    db: dbPath,
    folder,
    playlist,
    group,
    found: payloadFiles.length,
    inserted: counters.py.inserted,
    already: counters.py.already,
    verified: counters.verified,
    stillBroken: counters.stillBroken,
    appliedMode: Boolean(opts.apply),
    backedUpTo: counters.backedUpTo,
    playlistId: counters.py.playlistId,
    errors: counters.py.errors.map(([f, e]) => `${f}: ${e}`),
    ok: true,
  };
}

export const __test = {
  buildScript,
  parseWriteOutput,
  parseVerifyOutput,
  verificationError,
};

export function printRbImportReport(
  r: RbImportResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    log(
      `${body.found} audio files · playlist "${body.playlist}"${body.group ? ` (in "${body.group}")` : ""} · ${body.inserted} inserted, ${body.already} already imported, ${body.errors.length} errors`,
    );
    for (const e of body.errors.slice(0, 10)) log(`  ✗ ${e}`);
    if (body.appliedMode) {
      log(
        `post-verify: ${body.verified}/${body.found} files referenced · whole-table missing rows: ${body.stillBroken}`,
      );
    } else {
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to insert ${body.found} rows`,
      );
    }
  });
}
