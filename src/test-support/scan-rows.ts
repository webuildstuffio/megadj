/**
 * scan-rows.ts — fake scan/pair/finding builders for the dedupe + hygiene
 * suites (issue #146 builder 2).
 *
 * Replaces (jscpd's top src/ test clones):
 *  - the 58-line `candidate`/`scanRow`/`scanEdge`/`samePathRow` block in
 *    src/rekordbox/rb-dedup.test.ts
 *  - the hand-rolled HygieneStore finding objects in
 *    src/archive/hygiene/store.test.ts (`finding()`) and
 *    src/shelf/hygiene.test.ts (`mk()`/`store0.upsert`)
 *  - the `upgradePair()` DedupePair builder in
 *    src/shelf/dedupe.test.ts
 *
 * Defaults mirror what every suite assumed: same title, 180 s, 256 kbps,
 * 1_000 bytes — per-field overrides for the property under test.
 */
import { newFindingId, type Finding } from "../archive/hygiene/types";
import type { ScanPair, ScanRow } from "../rekordbox/rb-dedup-parse";
import type { DedupePair } from "../shelf/dedupe-types";

const rowDefaults = {
  title: "Same title",
  len: 180,
  size: 1_000,
  bitrate: 256,
};

/** A bare ScanRow (one side of a dupescan pair). */
export function scanRow(id: string, overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id,
    path: `/music/${id}.aiff`,
    ...rowDefaults,
    ...overrides,
  };
}

/** A ScanPair whose `other` defaults to a sibling row of the same shape.
 *  `basis` defaults to "candidate" (the rb-dedup scan output). */
export function scanPair(
  id: string,
  overrides: Partial<ScanPair> = {},
): ScanPair {
  const { other, ...rest } = overrides;
  return {
    ...scanRow(id, rest),
    basis: "candidate",
    other: other ?? scanRow(`${id}-other`, { path: `/music/${id}-other.aiff` }),
    ...rest,
  };
}

/** A shelf-twin DedupePair (the wire type shelf-dedupe applies). */
export function dedupePair(overrides: Partial<DedupePair> = {}): DedupePair {
  return {
    original: "/vol/Contents/Artist/song.mp3",
    twin: "/vol/Contents/Artist/song [TESTDRIVE].mp3",
    bytesOriginal: 3,
    bytesTwin: 4,
    method: "fingerprint",
    verdict: "keep-twin",
    reason: "test quality upgrade",
    loser: null,
    ...overrides,
  };
}

/** A HygieneStore finding with the defaults every suite wrote by hand:
 *  open acoustic-twin pair at /V/Contents/A, quarantine-loser action. */
export function hygieneFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: newFindingId(),
    kind: "acoustic-twin",
    severity: "likely",
    status: "open",
    paths: ["/V/Contents/A/keep.mp3", "/V/Contents/A/lose.mp3"],
    bytes: [4_000_000, 4_010_000],
    md5s: [null, null],
    fps: ["fp", "fp"],
    evidence: { subcategory: "quality-diff" },
    proposedAction: { type: "quarantine-loser" },
    keeperPath: "/V/Contents/A/keep.mp3",
    walkToken: "tok",
    autoSafe: false,
    createdAt: "2026-09-10T00:00:00.000Z",
    decidedAt: null,
    appliedAt: null,
    validation: null,
    ...overrides,
  };
}
