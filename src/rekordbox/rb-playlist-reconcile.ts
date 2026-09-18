/**
 * megadj rb-playlist reconcile — the XML-twin healer (postmortem F7).
 * `djmdPlaylist` rows and `masterPlaylists6.xml` NODEs are TWINS: RB reads
 * the sidebar from the XML; a DB row without its XML node shows the
 * "Playlist … not found in masterPlaylists6.xml" warning and the playlist
 * vanishes on an RB rebuild (40+ hits during the Sep 11–13 intake).
 *
 * Report mode diffs both sides. Apply mode repairs missing or stale NODEs
 * (with correctly encoded attributes) and reports XML-orphan nodes (present
 * in XML, absent in DB — RB tolerates them, we only flag).
 *
 * Works on any RB7 master directory: <mount>/PIONEER/Master/ holding
 * master.db + masterPlaylists6.xml (SHELF1-style layout), or the local
 * ~/Library/Pioneer/rekordbox when pointed at it explicitly.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord, isUnknownArray } from "../../cratedeck/shared/guards.js";
import { assertRbClosed } from "./guard.js";
import {
  applyConfirmed,
  applyConfirmationRefusal,
  lastJsonLine,
  parseJsonBoundary,
  printResult,
  rbPythonFile,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";
import { commandLog } from "../shared/progress";
import {
  applyPlaylistTwinMutation,
  parsePlaylistXmlNodes,
  playlistNodeLine,
} from "./rb-playlist-twin.js";

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
  /** nodes repaired in the XML in apply mode (legacy field name) */
  added: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

export function masterDirFor(mount: string): { db: string; xml: string } {
  // SSOT (issue #66): masterDbPath owns env override + all layout
  // resolution (explicit .db path, Master dir, PIONEER dir, drive root,
  // volume name). The XML twin always lives beside the DB.
  const db = masterDbPath(mount);
  const dir = dirname(db);
  return { db, xml: join(dir, "masterPlaylists6.xml") };
}

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
  return parsePlaylistXmlNodes(xml).map((node) => ({
    ...node,
    hexId: BigInt(node.id).toString(16).toUpperCase(),
  }));
}

/** Build a NODE line matching RB7's own format: hex Id, Timestamp,
 *  Lib_Type/CheckType on playlists, attribute-escaped Name. */
export function nodeLine(t: {
  name: string | null;
  id: string;
  parentId: string;
  attribute: number;
}): string {
  return playlistNodeLine(t);
}

function parseTwinScanOutput(
  raw: string,
): Omit<PlaylistTwin, "inDb" | "inXml">[] {
  const value = parseJsonBoundary(raw, "playlist DB scan");
  if (!isRecord(value) || !isUnknownArray(value.db))
    throw new Error("playlist DB scan returned an invalid payload");
  return value.db.map((row) => {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(row.id) ||
      typeof row.name !== "string" ||
      typeof row.parentId !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(row.parentId) ||
      !Number.isSafeInteger(row.attribute) ||
      !Number.isSafeInteger(row.seq)
    )
      throw new Error("playlist DB scan returned an invalid row");
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      attribute: row.attribute as number,
      seq: row.seq as number,
    };
  });
}

export async function rbPlaylistReconcile(opts: {
  mount: string;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}): Promise<ReconcileResult> {
  const log = opts.log ?? commandLog({ json: opts.json });
  const { db, xml } = masterDirFor(opts.mount);
  const apply = applyConfirmed(opts);
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

  if (applyConfirmationRefusal(opts) !== null)
    return mk(applyConfirmationRefusal(opts) ?? "unreachable");
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

  const r = rbPythonFile({
    file: "playlist-reconcile-scan.py",
    args: [db],
    timeoutMs: 120_000,
  });
  if (r.status !== 0 || !r.stdout)
    return mk(`DB scan failed: ${r.stderr.slice(-200)}`);
  let dbRows: Omit<PlaylistTwin, "inDb" | "inXml">[];
  try {
    dbRows = parseTwinScanOutput(lastJsonLine(r.stdout));
  } catch (error) {
    return mk(errorText(error));
  }

  const xmlRaw = readFileSync(xml, "utf8");
  const xmlNodes = parseXmlNodes(xmlRaw);
  // RB7 keeps RB-internal smart folders DB-side only by design (CUE
  // analysis playlist, per-key folders, etc.). Their tell: they carry no
  // Name in XML, or no XML NODE at all. We only reconcile NAMED DB rows
  // missing or disagreeing with their NODE — real user playlists that vanish
  // on an RB rebuild or return under stale names/parents.
  const xmlById = new Map(xmlNodes.map((n) => [n.id, n]));
  const missingXmlNodes: PlaylistTwin[] = dbRows
    .filter((p) => {
      if (p.id === "0" || p.name.length === 0) return false;
      const xmlNode = xmlById.get(p.id);
      return (
        xmlNode === undefined ||
        xmlNode.name !== p.name ||
        xmlNode.parentId !== p.parentId ||
        xmlNode.attribute !== p.attribute
      );
    })
    .map((p) => ({ ...p, inDb: true, inXml: false }));
  const dbIds = new Set(dbRows.map((p) => p.id));
  const orphanXmlNodes = xmlNodes
    .filter((n) => n.name !== null && !dbIds.has(n.id))
    .map((n) => ({ id: n.id, name: n.name as string }));

  let backedUpTo: string | null = null;
  let added = 0;
  if (apply && missingXmlNodes.length) {
    try {
      const nodes = missingXmlNodes.map((p) => ({
        name: p.name,
        id: p.id,
        parentId: p.parentId,
        attribute: p.attribute,
      }));
      const mutation = applyPlaylistTwinMutation({
        dbPath: db,
        what: "rb-playlist reconcile",
        mutateDb: () => nodes,
        nodes: (value) => value,
        verifyDb: () => {},
      });
      backedUpTo = mutation.backedUpTo;
    } catch (error) {
      return {
        ...mk(errorText(error)),
        missingXmlNodes,
        orphanXmlNodes,
        backedUpTo,
      };
    }
    added = missingXmlNodes.length;
    log(`reconcile: repaired ${added} missing or stale NODE(s) in ${xml}`);
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
  printResult(log, r, (body) => {
    log(
      `twins: ${body.missingXmlNodes.length} DB playlist(s) need XML repair · ${body.orphanXmlNodes.length} XML-only orphan(s)`,
    );
    for (const p of body.missingXmlNodes.slice(0, 15))
      log(
        `  ✗ "${p.name}" (Id ${p.id}, attr ${p.attribute}) XML twin is missing or stale`,
      );
    for (const o of body.orphanXmlNodes.slice(0, 5))
      log(
        `  ? XML node "${o.name}" (${o.id}) has no DB row (flagged, untouched)`,
      );
    if (body.appliedMode)
      log(`applied: ${body.added} NODE(s) repaired · backups written`);
    else if (body.missingXmlNodes.length)
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to repair ${body.missingXmlNodes.length} NODE(s)`,
      );
    else log("clean — every DB playlist has its XML twin");
  });
}
