/**
 * megadj rb-dedup — fingerprint-based duplicate sweep over the master DB
 * (postmortem F2 / BUG-2). Reports pairs of content rows pointing at
 * distinct files whose audio is the same (normalized title + ±2s duration
 * as the cheap classifier, fpcalc fingerprint as the judge), keeps the
 * canonical row (file under Contents/<Artist>/ preferred), and in apply
 * mode retires loser rows + quarantines loser files.
 *
 * Default is --report (rows-only triage); --apply --yes performs DB row
 * deletion + file quarantine. File deletion is NEVER automatic — losers
 * move to <mount>/Quarantine/rb-dedup-<date>/ with a receipt.
 */

import {
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fingerprintFileLength } from "../../fulltags/src/exports";
import {
  dedupDeleteScript,
  dedupScanScript,
  dedupVerifyScript,
} from "./rb-dedup-scripts.js";
import { inspectMutationPaths, pickKeeper } from "./rb-dedup-support.js";
export { pickKeeper, printRbDedupReport } from "./rb-dedup-support.js";
import { quarantineDest } from "../archive/hygiene/apply";
import {
  assertRbClosed,
  backupMaster,
  fileExistsSafe,
  restoreMasterBackup,
} from "./guard.js";

export interface RbDedupOptions {
  mount: string;
  report?: boolean | undefined;
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: (s: string) => void;
}

export interface DupePair {
  keepId: string;
  keepPath: string;
  loseId: string;
  losePath: string;
  title: string;
  durDelta: number;
  /** basis of the match: path-twin (same normalized path) or fingerprint */
  basis: "same-path" | "path-twin" | "fingerprint";
}

export interface ScanRow {
  id: string;
  path: string;
  title: string;
  len: number;
  size: number;
  bitrate: number;
}

export interface ScanPair extends ScanRow {
  other: ScanRow;
  /** Duration/title are only a candidate prefilter, never a verdict. */
  basis: "same-path" | "path-twin" | "candidate";
}

interface ScanResult {
  scanned: number;
  pairs: ScanPair[];
}

interface DeleteResult {
  removedIds: string[];
  errors: [string, string][];
  associations: AssociationExpectation[];
}

interface AssociationExpectation {
  keepId: string;
  playlists: [string, number][];
  cueSignatures: string[];
}

interface AssociationExpectationWire {
  keep_id: string;
  playlists: [string, number][];
  cue_signatures: string[];
}

interface CommandResult {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}

export interface RbDedupDeps {
  assertClosed: (what: string) => void;
  backup: (dbPath: string) => string;
  spawn: (
    command: string,
    args: string[],
    options: { encoding: "utf8"; timeout: number },
  ) => CommandResult;
  fingerprint: (path: string) => string | null;
  fileExists: (path: string) => boolean;
  realpath: (path: string) => string;
  mkdir: (path: string) => void;
  rename: (from: string, to: string) => void;
  writeFile: (path: string, data: string) => void;
  remove: (path: string) => void;
  restore: (dbPath: string, backupPath: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const defaultDeps: RbDedupDeps = {
  assertClosed: assertRbClosed,
  backup: backupMaster,
  spawn: (command, args, options) => spawnSync(command, args, options),
  fingerprint: fingerprintFileLength,
  fileExists: fileExistsSafe,
  realpath: realpathSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  rename: renameSync,
  writeFile: writeFileSync,
  remove: (path) => rmSync(path, { force: true }),
  restore: restoreMasterBackup,
  sleep: Bun.sleep,
  now: () => new Date(),
};

export interface RbDedupResult {
  command: "rb-dedup";
  db: string;
  /** content rows scanned */
  scanned: number;
  /** dupe pairs found */
  pairs: DupePair[];
  /** rows deleted in apply mode */
  removed: number;
  /** files quarantined in apply mode */
  quarantined: string[];
  /** files whose loser row was deleted but file was already gone */
  missingFiles: string[];
  appliedMode: boolean;
  backedUpTo: string | null;
  ok: boolean;
  error?: string;
}

const fail = (
  opts: RbDedupOptions,
  db: string,
  msg: string,
): RbDedupResult => ({
  command: "rb-dedup",
  db,
  scanned: 0,
  pairs: [],
  removed: 0,
  quarantined: [],
  missingFiles: [],
  appliedMode: Boolean(opts.apply),
  backedUpTo: null,
  ok: false,
  error: msg,
});

function parseJsonBoundary(
  raw: string,
  operation: "scan" | "delete" | "verification",
): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`rb-dedup ${operation} returned malformed JSON${detail}`, {
      cause: error,
    });
  }
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

function isScanRow(value: unknown): value is ScanRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "path" in value &&
    typeof value.path === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "len" in value &&
    finiteNonNegative(value.len) &&
    "size" in value &&
    finiteNonNegative(value.size) &&
    "bitrate" in value &&
    finiteNonNegative(value.bitrate)
  );
}

function isScanPair(value: unknown): value is ScanPair {
  return (
    isScanRow(value) &&
    "other" in value &&
    isScanRow(value.other) &&
    "basis" in value &&
    (value.basis === "same-path" ||
      value.basis === "path-twin" ||
      value.basis === "candidate")
  );
}

export function parseScanResult(raw: string): ScanResult {
  const value = parseJsonBoundary(raw, "scan");
  if (
    typeof value !== "object" ||
    value === null ||
    !("scanned" in value) ||
    !finiteNonNegative(value.scanned) ||
    !Number.isInteger(value.scanned) ||
    !("pairs" in value) ||
    !isUnknownArray(value.pairs) ||
    !value.pairs.every(isScanPair)
  ) {
    throw new Error(
      "rb-dedup scan returned invalid JSON: expected a finite census and complete candidate rows",
    );
  }
  return { scanned: value.scanned, pairs: value.pairs };
}

export function parseDeleteResult(
  raw: string,
  expectedIds?: readonly string[],
): DeleteResult {
  const value = parseJsonBoundary(raw, "delete");
  if (
    typeof value !== "object" ||
    value === null ||
    !("removed_ids" in value) ||
    !isUnknownArray(value.removed_ids) ||
    !value.removed_ids.every(
      (id): id is string => typeof id === "string" && id.length > 0,
    ) ||
    new Set(value.removed_ids).size !== value.removed_ids.length ||
    !("errors" in value) ||
    !isUnknownArray(value.errors) ||
    !value.errors.every(
      (entry): entry is [string, string] =>
        isUnknownArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    ) ||
    !("associations" in value) ||
    !isUnknownArray(value.associations) ||
    !value.associations.every(
      (association) =>
        typeof association === "object" &&
        association !== null &&
        "keep_id" in association &&
        typeof association.keep_id === "string" &&
        association.keep_id.length > 0 &&
        "playlists" in association &&
        isUnknownArray(association.playlists) &&
        association.playlists.every(
          (membership: unknown) =>
            isUnknownArray(membership) &&
            membership.length === 2 &&
            typeof membership[0] === "string" &&
            membership[0].length > 0 &&
            finiteNonNegative(membership[1]) &&
            Number.isInteger(membership[1]),
        ) &&
        "cue_signatures" in association &&
        isUnknownArray(association.cue_signatures) &&
        association.cue_signatures.every(
          (signature: unknown) =>
            typeof signature === "string" && signature.length > 0,
        ),
    )
  ) {
    throw new Error(
      "rb-dedup delete returned invalid JSON: expected removed ids, errors, and association proofs",
    );
  }
  const result: DeleteResult = {
    removedIds: value.removed_ids,
    errors: value.errors,
    associations: (value.associations as AssociationExpectationWire[]).map(
      (association) => ({
        keepId: association.keep_id,
        playlists: association.playlists,
        cueSignatures: association.cue_signatures,
      }),
    ),
  };
  // One keeper can absorb multiple losers from the same duplicate cluster,
  // so keeper ids may repeat. The subprocess emits one proof per removed row
  // in mapping order; only that one-to-one cardinality is required here.
  if (result.associations.length !== result.removedIds.length) {
    throw new Error(
      "rb-dedup delete returned invalid JSON: association proofs do not match removed rows",
    );
  }
  if (expectedIds) {
    const expected = new Set(expectedIds);
    const acknowledged = [
      ...result.removedIds,
      ...result.errors.map(([id]) => id),
    ];
    if (
      acknowledged.length !== expected.size ||
      new Set(acknowledged).size !== acknowledged.length ||
      acknowledged.some((id) => !expected.has(id))
    ) {
      throw new Error(
        "rb-dedup delete returned invalid JSON: acknowledgements do not match requested loser ids",
      );
    }
  }
  return result;
}

interface VerifyRow {
  id: string;
  path: string;
  playlists: [string, number][];
  cueSignatures: string[];
  cueOwnersValid: boolean;
}

interface VerifyRowWire {
  id: string;
  path: string;
  playlists: [string, number][];
  cue_signatures: string[];
  cue_owners_valid: boolean;
}

function parseVerifyRows(raw: string): VerifyRow[] {
  const value = parseJsonBoundary(raw, "verification");
  if (
    typeof value !== "object" ||
    value === null ||
    !("rows" in value) ||
    !isUnknownArray(value.rows) ||
    !value.rows.every(
      (row): row is VerifyRowWire =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        typeof row.id === "string" &&
        row.id.length > 0 &&
        "path" in row &&
        typeof row.path === "string" &&
        "playlists" in row &&
        isUnknownArray(row.playlists) &&
        row.playlists.every(
          (membership: unknown) =>
            isUnknownArray(membership) &&
            membership.length === 2 &&
            typeof membership[0] === "string" &&
            finiteNonNegative(membership[1]) &&
            Number.isInteger(membership[1]),
        ) &&
        "cue_signatures" in row &&
        isUnknownArray(row.cue_signatures) &&
        row.cue_signatures.every(
          (signature: unknown) =>
            typeof signature === "string" && signature.length > 0,
        ) &&
        "cue_owners_valid" in row &&
        typeof row.cue_owners_valid === "boolean",
    ) ||
    new Set(value.rows.map((row) => row.id)).size !== value.rows.length
  ) {
    throw new Error(
      "rb-dedup verification returned invalid JSON: expected unique id/path rows",
    );
  }
  return value.rows.map((row) => ({
    id: row.id,
    path: row.path,
    playlists: row.playlists,
    cueSignatures: row.cue_signatures,
    cueOwnersValid: row.cue_owners_valid,
  }));
}

function connectGraph(
  graph: Map<string, Set<string>>,
  first: string,
  second: string,
): void {
  const firstEdges = graph.get(first) ?? new Set<string>();
  firstEdges.add(second);
  graph.set(first, firstEdges);
  const secondEdges = graph.get(second) ?? new Set<string>();
  secondEdges.add(first);
  graph.set(second, secondEdges);
}

function graphComponentIds(
  graph: Map<string, Set<string>>,
  start: string,
): Set<string> {
  const found = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    for (const neighbor of graph.get(id) ?? []) pending.push(neighbor);
  }
  return found;
}

function compareStableIds(first: string, second: string): number {
  if (/^\d+$/u.test(first) && /^\d+$/u.test(second)) {
    const firstNumber = BigInt(first);
    const secondNumber = BigInt(second);
    if (firstNumber < secondNumber) return -1;
    if (firstNumber > secondNumber) return 1;
  }
  return first.localeCompare(second);
}

/** Turn cheap scan candidates into mutation proposals. Distinct paths must
 * have identical, full fingerprints; null or mismatch always means keep
 * both. A loser appears once, while one canonical keeper may own a cluster. */
export function buildDupePairs(
  candidates: ScanPair[],
  fingerprint: (path: string) => string | null = fingerprintFileLength,
): DupePair[] {
  const fingerprintCache = new Map<string, string | null>();
  const getFingerprint = (path: string): string | null => {
    if (!fingerprintCache.has(path))
      fingerprintCache.set(path, fingerprint(path));
    return fingerprintCache.get(path) ?? null;
  };
  const rows = new Map<string, ScanRow>();
  const graph = new Map<string, Set<string>>();
  const pathGraph = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    if (candidate.basis === "candidate") {
      const first = getFingerprint(candidate.path);
      if (first === null) continue;
      const second = getFingerprint(candidate.other.path);
      if (second === null || second !== first) continue;
    }
    rows.set(candidate.id, rows.get(candidate.id) ?? candidate);
    rows.set(
      candidate.other.id,
      rows.get(candidate.other.id) ?? candidate.other,
    );
    connectGraph(graph, candidate.id, candidate.other.id);
    if (candidate.basis !== "candidate")
      connectGraph(pathGraph, candidate.id, candidate.other.id);
  }

  const physicalComponents = new Map<string, string>();
  for (const id of [...pathGraph.keys()].toSorted()) {
    if (physicalComponents.has(id)) continue;
    const component = [...graphComponentIds(pathGraph, id)].toSorted();
    const label = component[0];
    if (label === undefined) continue;
    for (const member of component) physicalComponents.set(member, label);
  }

  const pairs: DupePair[] = [];

  const visited = new Set<string>();
  for (const start of [...graph.keys()].toSorted()) {
    if (visited.has(start)) continue;
    const ids = [...graphComponentIds(graph, start)].toSorted();
    for (const id of ids) visited.add(id);
    const componentRows = ids
      .map((id) => rows.get(id))
      .filter((row): row is ScanRow => row !== undefined);
    const [first, ...rest] = componentRows;
    if (first === undefined) continue;
    const keep = rest.reduce((current, row) => {
      if (
        current.path === row.path &&
        current.bitrate === row.bitrate &&
        current.size === row.size
      )
        return compareStableIds(current.id, row.id) <= 0 ? current : row;
      return pickKeeper(current, row) === "a" ? current : row;
    }, first);

    for (const lose of componentRows) {
      if (lose.id === keep.id) continue;
      const samePathComponent =
        physicalComponents.get(keep.id) !== undefined &&
        physicalComponents.get(keep.id) === physicalComponents.get(lose.id);
      pairs.push({
        keepId: keep.id,
        keepPath: keep.path,
        loseId: lose.id,
        losePath: lose.path,
        title: keep.title,
        durDelta: Math.abs(keep.len - lose.len),
        basis: samePathComponent
          ? keep.path === lose.path
            ? "same-path"
            : "path-twin"
          : "fingerprint",
      });
    }
  }
  return pairs;
}

export async function rbDedup(
  opts: RbDedupOptions,
  dependencyOverrides: Partial<RbDedupDeps> = {},
): Promise<RbDedupResult> {
  const deps: RbDedupDeps = { ...defaultDeps, ...dependencyOverrides };
  const dbPath =
    process.env.MEGADJ_RB_MASTER ??
    `${opts.mount.replace(/\/+$/u, "")}/PIONEER/Master/master.db`;
  const apply = opts.apply === true && opts.yes === true;

  if (opts.apply && !opts.yes)
    return fail(opts, dbPath, "--apply requires --yes (report first, ALWAYS)");
  try {
    deps.assertClosed("rb-dedup");
  } catch (e) {
    return fail(opts, dbPath, (e as Error).message);
  }

  const r = deps.spawn(
    "uv",
    ["run", "--with", "pyrekordbox", "python", "-c", dedupScanScript(), dbPath],
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.status !== 0 || !r.stdout)
    return fail(
      opts,
      dbPath,
      `scan failed (exit ${String(r.status)}): ${(r.stderr ?? "").slice(-300)}`,
    );
  let out: ScanResult;
  try {
    out = parseScanResult(r.stdout.trim().split("\n").pop() ?? "");
  } catch (error) {
    return fail(
      opts,
      dbPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  const unique = buildDupePairs(out.pairs, deps.fingerprint);

  let removed = 0;
  const quarantined: string[] = [];
  const missingFiles: string[] = [];
  let backedUpTo: string | null = null;
  const mutationErrors: string[] = [];

  if (apply && unique.length) {
    const pathInspection = inspectMutationPaths(
      opts.mount,
      unique,
      deps.realpath,
    );
    if (pathInspection.errors.length)
      return fail(
        opts,
        dbPath,
        `unsafe mutation paths: ${pathInspection.errors.join("; ")}`,
      );
    try {
      deps.assertClosed("rb-dedup --apply backup");
    } catch (error) {
      return fail(
        opts,
        dbPath,
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      backedUpTo = deps.backup(dbPath);
    } catch (error) {
      return fail(
        opts,
        dbPath,
        `backup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // 1. merge associations, then delete loser rows (one transaction/pair).
    const loseIds = unique.map((p) => p.loseId);
    const pairByLoser = new Map(unique.map((pair) => [pair.loseId, pair]));
    try {
      // The report/fingerprinting pass can take minutes. Close the race by
      // checking again at the last possible moment before the write spawn.
      deps.assertClosed("rb-dedup --apply delete");
    } catch (error) {
      return {
        ...fail(
          opts,
          dbPath,
          error instanceof Error ? error.message : String(error),
        ),
        backedUpTo,
      };
    }
    const rd = deps.spawn(
      "uv",
      [
        "run",
        "--with",
        "pyrekordbox",
        "python",
        "-c",
        dedupDeleteScript(),
        dbPath,
        JSON.stringify(unique.map((pair) => [pair.loseId, pair.keepId])),
      ],
      { encoding: "utf8", timeout: 300_000 },
    );
    let del: DeleteResult = { removedIds: [], errors: [], associations: [] };
    if (rd.status !== 0 || !rd.stdout) {
      mutationErrors.push(
        `row deletion process failed (exit ${String(rd.status)}): ${(rd.stderr ?? "").slice(-300)}`,
      );
    } else {
      try {
        del = parseDeleteResult(
          rd.stdout.trim().split("\n").pop() ?? "",
          loseIds,
        );
      } catch (error) {
        mutationErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const removedIds = new Set(del.removedIds);
    removed = removedIds.size;
    if (del.errors.length)
      mutationErrors.push(
        `row deletion errors: ${del.errors.map(([i, e]) => `${i}: ${e}`).join(", ")}`,
      );
    for (const [index, loserId] of del.removedIds.entries()) {
      const expectedKeeper = pairByLoser.get(loserId)?.keepId;
      const actualKeeper = del.associations[index]?.keepId;
      if (expectedKeeper === undefined || actualKeeper !== expectedKeeper) {
        mutationErrors.push(
          `association proof mismatch for loser ${loserId}: expected keeper ${expectedKeeper ?? "unknown"}, got ${actualKeeper ?? "missing"}`,
        );
      }
    }

    // 2. quarantine loser files (never delete) — EXCEPT same-path pairs,
    // where both rows point at ONE file the keeper still uses.
    const stamp = deps.now().toISOString().slice(0, 10);
    const qdir = join(
      opts.mount.replace(/\/+$/u, ""),
      "Quarantine",
      `rb-dedup-${stamp}`,
    );
    let receipt: string | null = null;
    let receiptAttempted = false;
    const moves: { source: string; destination: string }[] = [];
    for (const p of mutationErrors.length === 0 ? unique : []) {
      // Never move a file when its loser row was not confirmed deleted.
      if (!removedIds.has(p.loseId)) continue;
      // Exact/NFC+casefold path twins and equal resolved realpaths are one
      // physical file on the target macOS/ExFAT shelf. Only retire the extra
      // DB row; moving that path would also move the keeper's bytes.
      if (pathInspection.sharedLoserIds.has(p.loseId)) continue;
      if (!deps.fileExists(p.losePath)) {
        missingFiles.push(p.losePath);
        continue;
      }
      if (p.losePath === p.keepPath) continue; // belt: never move keeper's file
      try {
        deps.mkdir(qdir);
        const dest = quarantineDest(qdir, p.losePath);
        deps.rename(p.losePath, dest);
        quarantined.push(dest);
        moves.push({ source: p.losePath, destination: dest });
      } catch (error) {
        mutationErrors.push(
          `quarantine failed for ${p.losePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    }

    // A successful subprocess is not proof. Wait briefly, then read the
    // affected content rows from a new pyrekordbox process and compare the
    // complete requested loser/keeper set against disk reality.
    let verifyRows: VerifyRow[] | null = null;
    try {
      await deps.sleep(250);
      deps.assertClosed("rb-dedup post-write verification");
      const ids = [
        ...new Set(unique.flatMap((pair) => [pair.keepId, pair.loseId])),
      ];
      const verification = deps.spawn(
        "uv",
        [
          "run",
          "--with",
          "pyrekordbox",
          "python",
          "-c",
          dedupVerifyScript(),
          dbPath,
          JSON.stringify(ids),
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      if (verification.status !== 0 || !verification.stdout) {
        mutationErrors.push(
          `verification read failed (exit ${String(verification.status)}): ${(verification.stderr ?? "").slice(-300)}`,
        );
      } else {
        verifyRows = parseVerifyRows(
          verification.stdout.trim().split("\n").pop() ?? "",
        );
      }
    } catch (error) {
      mutationErrors.push(
        `verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (verifyRows) {
      const rowById = new Map(verifyRows.map((row) => [row.id, row]));
      // The fresh DB is the source of truth even when the delete process
      // exited badly or returned malformed acknowledgements.
      removed = unique.filter((pair) => !rowById.has(pair.loseId)).length;
      const survivingLosers = unique
        .filter((pair) => rowById.has(pair.loseId))
        .map((pair) => pair.loseId);
      if (survivingLosers.length)
        mutationErrors.push(
          `loser rows still present: ${survivingLosers.join(", ")}`,
        );
      const missingKeepers = unique
        .filter((pair) => !rowById.has(pair.keepId))
        .map((pair) => pair.keepId);
      if (missingKeepers.length)
        mutationErrors.push(
          `keeper rows missing: ${missingKeepers.join(", ")}`,
        );
      const mismatchedKeepers = unique
        .filter((pair) => {
          const row = rowById.get(pair.keepId);
          return row !== undefined && row.path !== pair.keepPath;
        })
        .map((pair) => pair.keepId);
      if (mismatchedKeepers.length)
        mutationErrors.push(
          `keeper path mismatch: ${mismatchedKeepers.join(", ")}`,
        );
      const missingKeeperFiles = unique
        .filter((pair) => !deps.fileExists(pair.keepPath))
        .map((pair) => pair.keepId);
      if (missingKeeperFiles.length)
        mutationErrors.push(
          `keeper files missing: ${missingKeeperFiles.join(", ")}`,
        );
      const associationsByKeeper = new Map(
        del.associations.map((association) => [
          association.keepId,
          association,
        ]),
      );
      for (const [keeperId, expected] of associationsByKeeper) {
        const actual = rowById.get(keeperId);
        if (
          actual !== undefined &&
          JSON.stringify(actual.playlists) !==
            JSON.stringify(expected.playlists)
        ) {
          mutationErrors.push(`playlist associations mismatch: ${keeperId}`);
        }
        if (
          actual !== undefined &&
          JSON.stringify(actual.cueSignatures) !==
            JSON.stringify(expected.cueSignatures)
        ) {
          mutationErrors.push(`cue associations mismatch: ${keeperId}`);
        }
        if (actual !== undefined && !actual.cueOwnersValid)
          mutationErrors.push(`cue ownership mismatch: ${keeperId}`);
      }
    }

    // A receipt is part of the successful mutation contract. Give each run
    // a collision-proof receipt and compensate if persisting it fails.
    if (mutationErrors.length === 0 && moves.length > 0) {
      try {
        deps.mkdir(qdir);
        receipt = quarantineDest(qdir, "receipt.json");
        receiptAttempted = true;
        const appliedPairs = unique.filter((pair) =>
          removedIds.has(pair.loseId),
        );
        deps.writeFile(
          receipt,
          JSON.stringify(
            {
              date: stamp,
              pairs: appliedPairs,
              removedRows: removed,
              quarantined,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        mutationErrors.push(
          `receipt write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (mutationErrors.length > 0) {
      let restored = false;
      try {
        deps.assertClosed("restoring failed rb-dedup");
        deps.restore(dbPath, backedUpTo);
        restored = true;
        removed = 0;
        mutationErrors.push(`restored from backup ${backedUpTo}`);
      } catch (error) {
        mutationErrors.push(
          `automatic DB restore failed; ${removed} loser row(s) remain absent: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (restored) {
        for (const move of moves.toReversed()) {
          try {
            deps.rename(move.destination, move.source);
            const index = quarantined.indexOf(move.destination);
            if (index !== -1) quarantined.splice(index, 1);
          } catch (error) {
            mutationErrors.push(
              `quarantine reversal failed; DB row was restored at ${move.source} but file remains at ${move.destination}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      if (receiptAttempted && receipt) {
        try {
          deps.remove(receipt);
        } catch (error) {
          mutationErrors.push(
            `failed to remove compensated receipt ${receipt}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  const result: RbDedupResult = {
    command: "rb-dedup",
    db: dbPath,
    scanned: out.scanned,
    pairs: unique,
    removed,
    quarantined,
    missingFiles,
    appliedMode: apply,
    backedUpTo,
    ok: mutationErrors.length === 0,
  };
  if (mutationErrors.length) result.error = mutationErrors.join("; ");
  return result;
}
