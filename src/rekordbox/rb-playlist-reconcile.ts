/**
 * megadj rb-playlist reconcile — the XML-twin healer (postmortem F7).
 * `djmdPlaylist` rows and `masterPlaylists6.xml` NODEs are TWINS: RB reads
 * the sidebar from the XML; a DB row without its XML node shows the
 * "Playlist … not found in masterPlaylists6.xml" warning and the playlist
 * vanishes on an RB rebuild (40+ hits during the Sep 11–13 intake).
 *
 * Report mode diffs both sides. Apply mode adds missing NODEs (with
 * correctly-encoded attributes) and reports XML-orphan nodes (present in
 * XML, absent in DB — RB tolerates them, we only flag).
 *
 * Works on any RB7 master directory: <mount>/PIONEER/Master/ holding
 * master.db + masterPlaylists6.xml (SHELF1-style layout), or the local
 * ~/Library/Pioneer/rekordbox when pointed at it explicitly.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertRbClosed, backupMaster } from "./guard.js";

export interface PlaylistTwin {
  id: string;
  name: string;
  parentId: string;
  /** side(s) where this playlist lives */
  inDb: boolean;
  inXml: boolean;
  attribute: number; // 0 = playlist, 1 = folder
  seq: number;
}

export interface ReconcileResult {
  command: "rb-playlist-reconcile";
  db: string;
  xml: string;
  /** playlists present in DB with their XML twin status */
  missingXmlNodes: PlaylistTwin[];
  /** XML NODEs with no DB row (flagged, never touched) */
  orphanXmlNodes: { id: string; name: string }[];
  /** nodes added to the XML in apply mode */
  added: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

export function masterDirFor(mount: string): { db: string; xml: string } {
  // explicit master.db path (env) wins; else treat `mount` as a dir that
  // may BE the master dir (local RB root holds master.db directly) or a
  // drive root with the PIONEER/Master layout.
  if (process.env.MEGADJ_RB_MASTER) {
    const base = process.env.MEGADJ_RB_MASTER.replace(/\/master\.db$/u, "");
    return {
      db: join(base, "master.db"),
      xml: join(base, "masterPlaylists6.xml"),
    };
  }
  const base = mount.startsWith("/")
    ? mount.replace(/\/+$/u, "")
    : `/Volumes/${mount.replace(/\/+$/u, "")}`;
  if (existsSync(join(base, "master.db")))
    return {
      db: join(base, "master.db"),
      xml: join(base, "masterPlaylists6.xml"),
    };
  if (base.endsWith("/Master"))
    return {
      db: join(base, "master.db"),
      xml: join(base, "masterPlaylists6.xml"),
    };
  if (base.endsWith("/PIONEER"))
    return {
      db: join(base, "Master", "master.db"),
      xml: join(base, "Master", "masterPlaylists6.xml"),
    };
  return {
    db: join(base, "PIONEER", "Master", "master.db"),
    xml: join(base, "PIONEER", "Master", "masterPlaylists6.xml"),
  };
}

/** DB-side playlist census (READ-ONLY python probe). */
export function twinScanScript(): string {
  return `
import json, sys
from pyrekordbox.db6.database import deobfuscate, BLOB
from pyrekordbox import db6
from pyrekordbox.db6.tables import DjmdPlaylist

db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))
rows = [
    {"id": str(p.ID), "name": p.Name or "", "parentId": str(p.ParentID or 0),
     "attribute": p.Attribute or 0, "seq": p.Seq or 0}
    for p in db.query(DjmdPlaylist).all()
]
db.close()
print(json.dumps({"db": rows}))
`;
}

/** Attribute grabber for one NODE tag string (`key="value"`). */
const xmlAttr = (tag: string, key: string): string | null => {
  const m = new RegExp(`${key}="([^"]*)"`, "u").exec(tag);
  return m?.[1] ?? null;
};

/** XML entity escaper for attribute values. */
const escapeXml = (s: string): string =>
  s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

/** XML-side parse: NODE entries from masterPlaylists6. RB7 stores `Id` as
 *  a HEX string of the DB's decimal ID (F4-rev4 spike finding, verified:
 *  151/156 local rows match when read as hex). `attribute`: 0 = playlist,
 *  1 = folder. Malformed lines are skipped, not crashed. */
export function parseXmlNodes(xml: string): {
  id: string; // DB-side decimal id (converted from the XML hex)
  hexId: string;
  name: string | null; // internal nodes have no Name attr
  parentId: string;
  attribute: number;
}[] {
  const out: {
    id: string;
    hexId: string;
    name: string | null;
    parentId: string;
    attribute: number;
  }[] = [];
  const re = /<NODE\b([^>]*)>/gu;
  for (const m of xml.matchAll(re)) {
    const tag = m[1] ?? "";
    const hexId = xmlAttr(tag, "Id");
    if (hexId === null) continue;
    let id = "";
    try {
      id = String(Number.parseInt(hexId, 16));
    } catch {
      continue;
    }
    out.push({
      id,
      hexId,
      name: xmlAttr(tag, "Name"),
      // ParentId is also hex in RB7 XML — convert so comparisons happen in
      // the DB's decimal id space end to end.
      parentId: hexToDecimalId(xmlAttr(tag, "ParentId") ?? "0"),
      attribute: Number(xmlAttr(tag, "Attribute") ?? "0"),
    });
  }
  return out;
}

/** RB7 XML stores ids as hex; the DB stores decimal. One converter, used
 *  everywhere (Number.parseInt never throws on garbage — returns NaN). */
export function hexToDecimalId(hex: string): string {
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? String(n) : hex;
}

/** Build a NODE line matching RB7's own format: hex Id, Timestamp,
 *  Lib_Type/CheckType on playlists, attribute-escaped Name. */
export function nodeLine(t: {
  name: string | null;
  id: string;
  parentId: string;
  attribute: number;
}): string {
  const hex = Number(t.id).toString(16).toUpperCase();
  const parentHex = Number(t.parentId).toString(16).toUpperCase();
  const name = t.name === null ? "" : ` Name="${escapeXml(t.name)}"`;
  return `    <NODE${name} Id="${hex}" ParentId="${parentHex}" Attribute="${t.attribute}" Timestamp="${Date.now()}" Lib_Type="0" CheckType="0"/>`;
}

export async function rbPlaylistReconcile(opts: {
  mount: string;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}): Promise<ReconcileResult> {
  const log = opts.log ?? (() => {});
  const { db, xml } = masterDirFor(opts.mount);
  const apply = opts.apply === true && opts.yes === true;
  const mk = (msg: string): ReconcileResult => ({
    command: "rb-playlist-reconcile",
    db,
    xml,
    missingXmlNodes: [],
    orphanXmlNodes: [],
    added: 0,
    appliedMode: apply,
    backedUpTo: null,
    ok: false,
    error: msg,
  });

  if (opts.apply && !opts.yes)
    return mk("--apply requires --yes (report first, ALWAYS)");
  if (!existsSync(db)) return mk(`no master DB at ${db}`);
  if (!existsSync(xml))
    return mk(
      `no masterPlaylists6.xml at ${xml} (sidecar must live beside master.db)`,
    );
  try {
    assertRbClosed("rb-playlist reconcile");
  } catch (e) {
    return mk((e as Error).message);
  }

  const r = spawnSync(
    "uv",
    ["run", "--with", "pyrekordbox", "python", "-c", twinScanScript(), db],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return mk(`DB scan failed: ${(r.stderr ?? "").slice(-200)}`);
  const dbRows = (
    JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as {
      db: PlaylistTwin[];
    }
  ).db;

  const xmlRaw = readFileSync(xml, "utf8");
  const xmlNodes = parseXmlNodes(xmlRaw);
  // RB7 keeps RB-internal smart folders DB-side only by design (CUE
  // analysis playlist, per-key folders, etc.). Their tell: they carry no
  // Name in XML, or no XML NODE at all. We only reconcile NAMED DB rows
  // missing their NODE — real user playlists that vanish on an RB rebuild.
  const xmlById = new Map(xmlNodes.map((n) => [n.id, n]));
  const missingXmlNodes: PlaylistTwin[] = dbRows
    .filter((p) => p.id !== "0" && !xmlById.has(p.id) && p.name.length > 0)
    .map((p) => ({ ...p, inDb: true, inXml: false }));
  const dbIds = new Set(dbRows.map((p) => p.id));
  const orphanXmlNodes = xmlNodes
    .filter((n) => n.name !== null && !dbIds.has(n.id))
    .map((n) => ({ id: n.id, name: n.name as string }));

  let backedUpTo: string | null = null;
  let added = 0;
  if (apply && missingXmlNodes.length) {
    backedUpTo = backupMaster(db);
    // XML backup alongside (same stamp family)
    copyFileSync(
      xml,
      `${xml}.bak-${new Date().toISOString().replace(/[-:T]/gu, "").slice(0, 15)}`,
    );
    // insert missing NODEs before the closing </PLAYLISTS>, after the last
    // existing NODE line, using each row's real parent + attr
    const lines = xmlRaw.split("\n");
    const insertAt = lines.reduce(
      (acc, l, i) => (l.includes("<NODE") ? i + 1 : acc),
      0,
    );
    const newLines = missingXmlNodes.map((p) =>
      nodeLine({
        name: p.name,
        id: p.id,
        parentId: p.parentId,
        attribute: p.attribute,
      }),
    );
    lines.splice(insertAt, 0, ...newLines);
    writeFileSync(xml, lines.join("\n"));
    added = newLines.length;
    log(`reconcile: added ${added} missing NODE(s) to ${xml}`);
  }

  return {
    command: "rb-playlist-reconcile",
    db,
    xml,
    missingXmlNodes,
    orphanXmlNodes,
    added,
    appliedMode: apply,
    backedUpTo,
    ok: true,
  };
}

export function printReconcileReport(
  r: ReconcileResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(
    `twins: ${r.missingXmlNodes.length} DB playlist(s) missing their XML NODE · ${r.orphanXmlNodes.length} XML-only orphan(s)`,
  );
  for (const p of r.missingXmlNodes.slice(0, 15))
    log(`  ✗ "${p.name}" (Id ${p.id}, attr ${p.attribute}) in DB, not in XML`);
  for (const o of r.orphanXmlNodes.slice(0, 5))
    log(
      `  ? XML node "${o.name}" (${o.id}) has no DB row (flagged, untouched)`,
    );
  if (r.appliedMode) log(`applied: ${r.added} NODE(s) added · backups written`);
  else if (r.missingXmlNodes.length)
    log(
      `dry-run — re-run with --apply --yes (rekordbox quit) to add ${r.missingXmlNodes.length} NODE(s)`,
    );
  else log("clean — every DB playlist has its XML twin");
}
