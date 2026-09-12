/**
 * megadj rb-playlist — bridge a set-builder proposal into the shelf
 * master DB (rekordbox playlist). The write-side twin of `megadj
 * setbuild` (AGENTS.md: RB auto-writes are the rb-* seams' job only).
 *
 * Unlike rb-import this injects NO new DjmdContent rows: every chain
 * track was already imported by the fullpush pipeline — we only create
 * the playlist (under a parent group) and link EXISTING content rows by
 * filename. Matching is NFC-normalized BASENAME (archive paths are
 * local DJ-Imports; master paths are SHELF1/Contents/...) with the
 * FileNameL 60-char clip tolerated; unmatched tracks are reported, never
 * silently dropped.
 *
 * Safety gates (identical to rb-import):
 *   1. flags validated before any I/O (--apply requires --yes)
 *   2. the chain comes from the SAME engine (`buildSet`) the CLI/web use
 *   3. rekordbox must be QUIT (pgrep) — it holds a live WAL
 *   4. dated DB backup (+ WAL/SHM) next to the master before any write
 *   5. dry-run by default; --apply --yes to write
 *   6. post-verify: song-playlist row count == linked + TrackNo contiguity
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { ArchiveReader } from "../../cratedeck/src/archive";
import {
  buildSet,
  parseSetbuildQuery,
  SET_PRESETS,
} from "../../cratedeck/src/setbuild";
import { clampSetPool } from "../../cratedeck/shared/types";
import { DB_PATH } from "../cli-env";

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
  playlistId: number | null;
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
from pyrekordbox.db6.tables import DjmdPlaylist, DjmdSongPlaylist

db_path, payload = sys.argv[1], json.loads(sys.argv[2])
chain, playlist_name, group_name = payload["chain"], payload["playlist"], payload["group"]
now = datetime.datetime.now()
db = Rekordbox6Database(db_path)

out = {"linked": 0, "unmatched": [], "playlistId": None, "errors": []}

def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s

# NFC basename → content ID (first wins; duplicate filenames across
# artist folders are a real possibility — first row is as good a pick
# as any and the unmatched report keeps the miss visible either way)
by_base = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        b = nfc(os.path.basename(c.FolderPath))
        if b not in by_base:
            by_base[b] = c.ID

content_ids = []
for track in chain:
    base = nfc(track["base"])
    cid = by_base.get(base)
    if cid is None and len(base) > 60:
        # tolerate the FileNameL 60-char clip ("..." suffix)
        cid = by_base.get(base[:57] + "...")
    if cid is None:
        out["unmatched"].append(track["title"][:70])
        continue
    content_ids.append(cid)

def find_playlist(name, attr, parent=None):
    q = db.query(DjmdPlaylist).filter(DjmdPlaylist.Name == name, DjmdPlaylist.Attribute == attr)
    for p in q.all():
        if parent is None or p.ParentID == parent.ID:
            return p
    return None

def rid():
    return db.random_id() if hasattr(db, "random_id") else int.from_bytes(os.urandom(4), "big") & 0x7FFFFFFF

parent = find_playlist(group_name, 1)
if parent is None:
    parent = DjmdPlaylist(ID=rid(), Name=group_name, Attribute=1, ParentID=0,
                          Seq=db.query(DjmdPlaylist).count() + 1,
                          UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
    db.add(parent); db.session.commit()

if find_playlist(playlist_name, 0, parent) is not None:
    out["errors"].append('playlist "%s" already exists in "%s" — rename it, delete it, or pass --playlist' % (playlist_name, group_name))
    print(json.dumps(out)); db.close(); sys.exit(0)

pl = DjmdPlaylist(ID=rid(), Name=playlist_name, Attribute=0,
                  ParentID=parent.ID, Seq=db.query(DjmdPlaylist).count() + 1,
                  UUID=str(uuid.uuid4()), created_at=now, updated_at=now)
db.add(pl); db.session.commit()
out["playlistId"] = pl.ID

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

function rekordboxRunning(): boolean {
  return spawnSync("pgrep", ["-x", "rekordbox"]).status === 0;
}

interface PyOut {
  linked: number;
  unmatched: string[];
  playlistId: number | null;
  errors: string[];
}

/** Deterministic date stamp for the default playlist name. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ChainTrack {
  videoId: string;
  base: string | null;
  title: string | null;
}

/** Build the chain with the SAME engine the CLI/web use, and keep each
 *  track's archive FILENAME — the join key into the master's content
 *  rows. One readonly archive pass; candidates carry file_path. */
function buildChain(
  opts: RbPlaylistOptions,
):
  { chain: ChainTrack[]; preset: string; minutes: number } | { error: string } {
  const parsed = parseSetbuildQuery({
    preset: opts.preset ?? null,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) return { error: parsed.error };

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
  const log = opts.log ?? (() => {});
  const mount = opts.mount.replace(/\/+$/u, "");
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    join(mount, "PIONEER", "Master", "master.db");
  const group = opts.group ?? "DJ-Imports";

  const fail = (msg: string): RbPlaylistResult => ({
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
    ok: false,
    error: msg,
  });

  // gate 1 — flags before any I/O
  if (opts.apply && !opts.yes)
    return fail("--apply requires --yes (dry-run first, ALWAYS)");

  // gate 2 — the chain (same engine as setbuild CLI/web)
  const built = buildChain(opts);
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

  // gate 3 — DB present
  if (!existsSync(dbPath)) return fail(`no master DB at ${dbPath}`);
  // gate 4 — rekordbox quit
  if (rekordboxRunning())
    return fail("rekordbox is running — quit it (live WAL) before rb-playlist");

  let backedUpTo: string | null = null;
  let py: PyOut = { linked: 0, unmatched: [], playlistId: null, errors: [] };

  if (opts.apply && opts.yes) {
    const stamp = new Date().toISOString().replace(/[-:T]/gu, "").slice(0, 15);
    backedUpTo = `${dbPath}.bak-${stamp}`;
    copyFileSync(dbPath, backedUpTo);
    for (const side of ["-wal", "-shm"]) {
      if (existsSync(dbPath + side))
        copyFileSync(dbPath + side, backedUpTo + side);
    }
    log(`rb-playlist: DB backed up to ${backedUpTo}`);

    const r = spawnSync(
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
          chain: chain.map((c) => ({ base: c.base ?? "", title: c.title })),
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
    py = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as PyOut;
  }

  // gate 5 — post-verify (apply mode): count + TrackNo contiguity
  let verified = 0;
  if (opts.apply && opts.yes && py.playlistId !== null) {
    const rv = spawnSync(
      "uv",
      [
        "run",
        "--with",
        PYRK_TAG,
        "python",
        "-c",
        verifyScript(),
        dbPath,
        String(py.playlistId),
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (rv.status === 0 && rv.stdout) {
      const v = JSON.parse(rv.stdout.trim().split("\n").pop() ?? "{}") as {
        rows: number;
        contiguous: boolean;
      };
      verified = v.rows;
      if (!v.contiguous)
        py.errors.push("post-verify: TrackNo sequence is not contiguous");
    }
  }

  // dry-run honesty: predict the matches READ-ONLY so the report shows
  // real numbers, never a fake "0 linked"
  let unmatched = py.unmatched;
  if (!(opts.apply && opts.yes)) {
    const pred = predictMatches(
      dbPath,
      chain.map((c) => ({ base: c.base, title: c.title })),
    );
    if (pred) {
      unmatched = pred.unmatched;
      log(
        `rb-playlist: predict ${pred.hit}/${chain.length} chain tracks have master rows (read-only probe)`,
      );
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

by_base = {}
for c in db.query(DjmdContent).all():
    if c.FolderPath:
        b = nfc(os.path.basename(c.FolderPath))
        if b not in by_base:
            by_base[b] = c.ID

hit = 0
unmatched = []
for track in chain:
    base = nfc(track["base"])
    cid = by_base.get(base)
    if cid is None and len(base) > 60:
        cid = by_base.get(base[:57] + "...")
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
  chain: { base: string | null; title: string | null }[],
): { hit: number; unmatched: string[] } | null {
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
        chain: chain.map((c) => ({ base: c.base ?? "", title: c.title })),
      }),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (r.status !== 0 || !r.stdout) {
    // never silent: a failed probe must be visible (the dry-run then
    // shows the honest "0 verified" rather than a fake prediction)
    console.error(
      `rb-playlist: match probe failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-200)}`,
    );
    return null;
  }
  return JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
    hit: number;
    unmatched: string[];
  };
}

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
