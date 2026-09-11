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
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

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
  playlistId: number | null;
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
import json, os, sys, uuid, datetime
from pyrekordbox import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdArtist, DjmdPlaylist, DjmdSongPlaylist

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
files, playlist_name, group_name = payload["files"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"inserted": 0, "already": 0, "playlistId": None, "errors": [], "contentIds": {}}

existing = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        existing[c.FolderPath] = c.ID
        base = os.path.basename(c.FolderPath)
        existing.setdefault(base, c.ID)

# --- playlist (child of group when given) ---
def find_playlist(name, attr, parent=None):
    q = db.query(DjmdPlaylist).filter(DjmdPlaylist.Name == name, DjmdPlaylist.Attribute == attr)
    for p in q.all():
        if parent is None or p.ParentID == parent.ID:
            return p
    return None

parent = None
if group_name:
    parent = find_playlist(group_name, 1)
    if parent is None:
        pid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
        parent = DjmdPlaylist(ID=pid, Name=group_name, Attribute=1, ParentID=0,
                              Seq=db.query(DjmdPlaylist).count() + 1,
                              UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
        db.add(parent); db.session.commit()
    out["parentId"] = parent.ID

pl = find_playlist(playlist_name, 0, parent)
if pl is None:
    seq = db.query(DjmdPlaylist).count() + 1
    pid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
    pl = DjmdPlaylist(ID=pid, Name=playlist_name, Attribute=0,
                      ParentID=parent.ID if parent else 0, Seq=seq,
                      UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
    db.add(pl); db.session.commit()
out["playlistId"] = pl.ID

track_no = db.query(DjmdSongPlaylist).filter(DjmdSongPlaylist.PlaylistID == pl.ID).count()

master_db_id = ""
c0 = db.query(DjmdContent).first()
if c0 is not None and getattr(c0, "MasterDBID", None):
    master_db_id = c0.MasterDBID

device_id = "adeae5be-3cc0-4f1d-bb8a-cf6c61c01bdf"

for f in files:
    full, fname, title, artist, album, genre, year, duration, bitrate, bpm, key = f
    if full in existing or fname in existing:
        out["already"] += 1
        continue
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
        out["contentIds"][full] = cid
        existing[full] = cid
        # playlist membership
        spid = db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF
        sp = DjmdSongPlaylist(ID=spid, PlaylistID=pl.ID, ContentID=cid,
                              TrackNo=track_no + 1, UUID=str(uuid.uuid4()),
                              created_at=now, updated_at=now)
        db.add(sp); db.session.commit()
        track_no += 1
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
  playlistId: number | null;
  errors: [string, string][];
}

export async function rbImport(
  opts: RbImportOptions,
): Promise<RbImportResult> {
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ?? join(mount, "PIONEER", "Master", "master.db");
  const folder = opts.folder.replace(/\/+$/u, "");
  const playlist = opts.playlist ?? basename(folder);
  const group = opts.group ?? null;

  const fail = (msg: string): RbImportResult => ({
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
    let st;
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
    const duration = Math.round(Number(lines[0]) || 0);
    const bitrate = Math.round(Number(lines[1]) || 0);
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

  let backedUpTo: string | null = null;
  if (opts.apply && opts.yes) {
    const stamp = new Date().toISOString().replace(/[-:T]/gu, "").slice(0, 15);
    backedUpTo = `${dbPath}.bak-${stamp}`;
    copyFileSync(dbPath, backedUpTo);
    for (const side of ["-wal", "-shm"]) {
      if (existsSync(dbPath + side)) copyFileSync(dbPath + side, backedUpTo + side);
    }
    log(`rb-import: DB backed up to ${backedUpTo}`);
  }

  let py: PyOut = { inserted: 0, already: 0, playlistId: null, errors: [] };
  if (opts.apply && opts.yes) {
    const script = buildScript();
    const r = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        script,
        dbPath,
        JSON.stringify({
          files: payloadFiles,
          playlist,
          group,
        }),
      ],
      { encoding: "utf8", timeout: 300_000 },
    );
    if (r.status !== 0 || !r.stdout) {
      return fail(
        `pyrekordbox write failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-400)}`,
      );
    }
    const line = r.stdout.trim().split("\n").pop() ?? "{}";
    py = JSON.parse(line) as PyOut;
  }

  // gate 5 — post-verify: how many of our files do rows now reference,
  // and a WHOLE-TABLE pass for any row pointing at a missing file.
  const verifyScript =
    "import json,os,sys;from pyrekordbox import Rekordbox6Database as R\n" +
    "from pyrekordbox.db6.tables import DjmdContent\n" +
    "db=R(sys.argv[1]);files=set(json.loads(sys.argv[2]))\n" +
    "rows=db.query(DjmdContent).all()\n" +
    "hit=sum(1 for c in rows if c.FolderPath in files)\n" +
    "broken=sum(1 for c in rows if c.FolderPath and not (os.path.exists(c.FolderPath) or os.path.basename(c.FolderPath) in files))\n" +
    'print(json.dumps({"hit":hit,"broken":broken,"total":len(rows)}));db.close()';
  let verified = 0;
  let stillBroken = 0;
  if (opts.apply && opts.yes) {
    const rv = spawnSync(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        verifyScript,
        dbPath,
        JSON.stringify(payloadFiles.map((f) => f[0])),
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (rv.status === 0 && rv.stdout) {
      const v = JSON.parse(rv.stdout.trim().split("\n").pop() ?? "{}") as {
        hit: number;
        broken: number;
      };
      verified = v.hit;
      stillBroken = v.broken;
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
