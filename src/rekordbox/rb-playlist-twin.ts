/** Atomic, compensating mutation seam for Rekordbox playlist DB/XML twins. */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicReplace as atomicReplaceFile } from "../shared/atomic-file";
import {
  assertRbClosed,
  backupMaster,
  restoreMasterBackup,
  sleepSync,
} from "./guard.js";

export interface PlaylistXmlNode {
  id: string;
  name: string | null;
  parentId: string;
  attribute: number;
}

interface PlaylistTwinTestHooks {
  assertClosed?: (what: string) => void;
  sleep?: (ms: number) => void;
  writeXml?: (path: string, content: string) => void;
}

export interface PlaylistTwinMutationOptions<T> {
  dbPath: string;
  what: string;
  mutateDb: () => T;
  nodes: (value: T) => readonly PlaylistXmlNode[];
  verifyDb: (value: T) => void;
  log?: ((message: string) => void) | undefined;
  onBackup?: ((paths: { db: string; xml: string }) => void) | undefined;
  /** Dependency seams for filesystem-only regression tests. */
  testHooks?: PlaylistTwinTestHooks | undefined;
}

export interface PlaylistTwinMutationResult<T> {
  value: T;
  backedUpTo: string;
  xmlBackedUpTo: string;
}

export function playlistXmlPath(dbPath: string): string {
  return join(dirname(dbPath), "masterPlaylists6.xml");
}

export function hexToDecimalId(hex: string): string {
  if (!/^[0-9a-f]+$/iu.test(hex)) throw new Error(`invalid hex id: ${hex}`);
  return BigInt(`0x${hex}`).toString(10);
}

function decimalToHexId(decimal: string): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(decimal))
    throw new Error(`invalid decimal id: ${decimal}`);
  return BigInt(decimal).toString(16).toUpperCase();
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

const unescapeXml = (value: string): string =>
  value
    .replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");

const xmlAttr = (tag: string, key: string): string | null =>
  new RegExp(`${key}="([^"]*)"`, "u").exec(tag)?.[1] ?? null;

export function parsePlaylistXmlNodes(xml: string): PlaylistXmlNode[] {
  const out: PlaylistXmlNode[] = [];
  for (const match of xml.matchAll(/<NODE\b([^>]*)>/gu)) {
    const tag = match[1] ?? "";
    const hexId = xmlAttr(tag, "Id");
    if (hexId === null) continue;
    try {
      const attributeText = xmlAttr(tag, "Attribute") ?? "0";
      if (!/^\d+$/u.test(attributeText)) continue;
      const attributeRaw = Number.parseInt(attributeText, 10);
      if (!Number.isSafeInteger(attributeRaw) || attributeRaw < 0) continue;
      const name = xmlAttr(tag, "Name");
      out.push({
        id: hexToDecimalId(hexId),
        name: name === null ? null : unescapeXml(name),
        parentId: hexToDecimalId(xmlAttr(tag, "ParentId") ?? "0"),
        attribute: attributeRaw,
      });
    } catch (error) {
      console.error(
        `masterPlaylists6.xml contains an invalid NODE: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return out;
}

export function playlistNodeLine(node: PlaylistXmlNode): string {
  const name = node.name === null ? "" : ` Name="${escapeXml(node.name)}"`;
  return `    <NODE${name} Id="${decimalToHexId(node.id)}" ParentId="${decimalToHexId(node.parentId)}" Attribute="${node.attribute}" Timestamp="${Date.now()}" Lib_Type="0" CheckType="0"/>`;
}

function playlistNodesMatch(
  actual: PlaylistXmlNode,
  expected: PlaylistXmlNode,
): boolean {
  return (
    actual.name === expected.name &&
    actual.parentId === expected.parentId &&
    actual.attribute === expected.attribute
  );
}

function atomicReplace(path: string, content: string | Uint8Array): void {
  // shared seam (#162): collision-proof sibling, mode-preserving swap,
  // residue unlink on every failure path
  atomicReplaceFile(path, content);
}

export function appendPlaylistNodesAtomic(
  xmlPath: string,
  nodes: readonly PlaylistXmlNode[],
  writeXml: (path: string, content: string) => void = atomicReplace,
): void {
  const raw = readFileSync(xmlPath, "utf8");
  const expectedById = new Map<string, PlaylistXmlNode>();
  for (const node of nodes) {
    const duplicate = expectedById.get(node.id);
    if (duplicate !== undefined && !playlistNodesMatch(duplicate, node)) {
      throw new Error(`conflicting playlist XML metadata for id ${node.id}`);
    }
    expectedById.set(node.id, node);
  }

  const found = new Set<string>();
  let changed = false;
  const repaired = raw.replace(/<NODE\b[^>]*>/gu, (tag) => {
    const current = parsePlaylistXmlNodes(tag)[0];
    if (current === undefined) return tag;
    const expected = expectedById.get(current.id);
    if (expected === undefined) return tag;
    found.add(current.id);
    if (playlistNodesMatch(current, expected)) return tag;
    changed = true;
    return playlistNodeLine(expected).trimStart();
  });
  const missing = [...expectedById.values()].filter(
    (node) => !found.has(node.id),
  );
  if (!changed && missing.length === 0) return;
  const closing = repaired.lastIndexOf("</PLAYLISTS>");
  if (closing === -1)
    throw new Error(`${xmlPath} has no closing PLAYLISTS element`);
  const before = repaired.slice(0, closing);
  const separator = before.endsWith("\n") ? "" : "\n";
  const inserted =
    missing.length === 0
      ? ""
      : `${separator}${missing.map(playlistNodeLine).join("\n")}\n`;
  writeXml(xmlPath, `${before}${inserted}${repaired.slice(closing)}`);
}

function verifyPlaylistNodes(
  xmlPath: string,
  expected: readonly PlaylistXmlNode[],
): void {
  const actual = new Map(
    parsePlaylistXmlNodes(readFileSync(xmlPath, "utf8")).map((node) => [
      node.id,
      node,
    ]),
  );
  for (const node of expected) {
    const found = actual.get(node.id);
    if (found === undefined || !playlistNodesMatch(found, node)) {
      throw new Error(
        `playlist XML post-verify failed for ${node.name ?? node.id} (${node.id})`,
      );
    }
  }
}

/**
 * Mutate playlist rows and their XML twins as one compensating operation.
 * Any mutation/XML/verification failure restores both backup families.
 */
export function applyPlaylistTwinMutation<T>(
  options: PlaylistTwinMutationOptions<T>,
): PlaylistTwinMutationResult<T> {
  const xmlPath = playlistXmlPath(options.dbPath);
  if (!existsSync(options.dbPath))
    throw new Error(`no master DB at ${options.dbPath}`);
  if (!existsSync(xmlPath))
    throw new Error(`no masterPlaylists6.xml at ${xmlPath}`);

  const closed = options.testHooks?.assertClosed ?? assertRbClosed;
  const sleep = options.testHooks?.sleep ?? sleepSync;
  const writeXml = options.testHooks?.writeXml ?? atomicReplace;
  closed(options.what);
  const backedUpTo = backupMaster(options.dbPath);
  const suffix = backedUpTo.slice(options.dbPath.length);
  const xmlBackedUpTo = `${xmlPath}${suffix}`;
  copyFileSync(xmlPath, xmlBackedUpTo);
  options.onBackup?.({ db: backedUpTo, xml: xmlBackedUpTo });
  options.log?.(
    `playlist twins backed up to ${backedUpTo} and ${xmlBackedUpTo}`,
  );

  try {
    sleep(250);
    closed(options.what);
    const value = options.mutateDb();
    const nodes = options.nodes(value);
    appendPlaylistNodesAtomic(xmlPath, nodes, writeXml);
    sleep(250);
    options.verifyDb(value);
    verifyPlaylistNodes(xmlPath, nodes);
    return { value, backedUpTo, xmlBackedUpTo };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      closed(`restoring failed ${options.what}`);
      restoreMasterBackup(options.dbPath, backedUpTo);
      atomicReplace(xmlPath, readFileSync(xmlBackedUpTo));
    } catch (restoreError) {
      throw new Error(
        `${options.what} failed: ${message}; automatic restore also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}; backups: ${backedUpTo}, ${xmlBackedUpTo}`,
        { cause: restoreError },
      );
    }
    throw new Error(
      `${options.what} failed: ${message}; restored DB and XML from backups`,
      { cause: error },
    );
  }
}
