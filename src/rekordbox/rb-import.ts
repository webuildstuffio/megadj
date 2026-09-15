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

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  isFiniteNumber,
  isRecord,
  isUnknownArray,
} from "../../cratedeck/shared/guards";
import {
  isDecimalIdOrNull,
  isStringPair,
  parseJsonBoundary,
} from "./rb-command-kit.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";

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

function rekordboxRunning(): boolean {
  return spawnSync("pgrep", ["-x", "rekordbox"]).status === 0;
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

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
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

export async function rbImport(opts: RbImportOptions): Promise<RbImportResult> {
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    join(mount, "PIONEER", "Master", "master.db");
  const folder = opts.folder.replace(/\/+$/u, "");
  const playlist = opts.playlist ?? basename(folder);
  const group = opts.group ?? null;

  const fail = (
    msg: string,
    details: Partial<RbImportResult> = {},
  ): RbImportResult => ({
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
    ...details,
    ok: false,
    error: msg,
  });

  // gate 1 — flags before any I/O
  if (opts.apply && !opts.yes)
    return fail("--apply requires --yes (dry-run first, ALWAYS)");
  // gate 2 — DB present
  if (!existsSync(dbPath)) return fail(`no master DB at ${dbPath}`);
  // gate 3 — folder present with audio
  if (!existsSync(folder)) return fail(`no such folder: ${folder}`);
  // gate 4 — rekordbox quit
  if (rekordboxRunning())
    return fail("rekordbox is running — quit it (live WAL) before rb-import");

  const files: [string, string][] = [];
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
  if (files.length === 0) return fail(`no audio files in ${folder}`);

  // probe durations/bitrate via ffprobe so rows carry real values
  const payloadFiles = files.map(([full, fname]) => {
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        full,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const lines = (probe.stdout ?? "").trim().split("\n");
    const durationRaw = Number(lines[0]);
    const bitrateRaw = Number(lines[1]);
    const duration = Number.isFinite(durationRaw) ? Math.round(durationRaw) : 0;
    const bitrate = Number.isFinite(bitrateRaw) ? Math.round(bitrateRaw) : 0;
    // tags come from the archive DB conventions: parse "Artist · Album · Title"
    const stem = fname.replace(/\.[^.]+$/u, "");
    const parts = stem.split(" · ");
    const title = parts[2] ?? parts[1] ?? stem;
    const artist = parts.length >= 3 ? (parts[0] ?? null) : (parts[0] ?? null);
    return [
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
    ];
  });

  log(
    `rb-import: ${payloadFiles.length} audio files → playlist "${playlist}"${group ? ` in group "${group}"` : ""} on ${dbPath}`,
  );

  // Delayed fresh-process verification covers content, playlist membership,
  // and TrackNo continuity. The shared twin seam separately verifies XML.
  const verifyScript =
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
  let backedUpTo: string | null = null;
  let py: PyOut = {
    inserted: 0,
    already: 0,
    linked: 0,
    playlistId: null,
    parentId: null,
    errors: [],
  };
  let verified = 0;
  let stillBroken = 0;
  if (opts.apply && opts.yes) {
    try {
      const mutation = applyPlaylistTwinMutation({
        dbPath,
        what: "rb-import",
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
              "pyrekordbox",
              "python",
              "-c",
              buildScript(),
              dbPath,
              JSON.stringify({ files: payloadFiles, playlist, group }),
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
          const result = spawnSync(
            "uv",
            [
              "run",
              "--with",
              "pyrekordbox",
              "python",
              "-c",
              verifyScript,
              dbPath,
              JSON.stringify(payloadFiles.map((file) => file[0])),
              value.playlistId,
            ],
            { encoding: "utf8", timeout: 120_000 },
          );
          if (result.status !== 0 || !result.stdout)
            throw new Error(
              `pyrekordbox post-verify failed (exit ${String(result.status)}): ${(result.stderr ?? "").slice(-400)}`,
            );
          const verify = parseVerifyOutput(
            result.stdout.trim().split("\n").pop() ?? "",
          );
          verified = verify.hit;
          stillBroken = verify.broken;
          const failure = verificationError(payloadFiles.length, value, verify);
          if (failure) throw new Error(failure);
        },
      });
      py = mutation.value;
      backedUpTo = mutation.backedUpTo;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(message, {
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
      });
    }
  }

  return {
    command: "rb-import",
    db: dbPath,
    folder,
    playlist,
    group,
    found: payloadFiles.length,
    inserted: py.inserted,
    already: py.already,
    verified,
    stillBroken,
    appliedMode: Boolean(opts.apply),
    backedUpTo,
    playlistId: py.playlistId,
    errors: py.errors.map(([f, e]) => `${f}: ${e}`),
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
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `${r.found} audio files · playlist "${r.playlist}"${r.group ? ` (in "${r.group}")` : ""} · ${r.inserted} inserted, ${r.already} already imported, ${r.errors.length} errors`,
  );
  for (const e of r.errors.slice(0, 10)) log(`  ✗ ${e}`);
  if (r.appliedMode) {
    log(
      `post-verify: ${r.verified}/${r.found} files referenced · whole-table missing rows: ${r.stillBroken}`,
    );
  } else {
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to insert ${r.found} rows`,
    );
  }
}
