// rb-import-verify.ts — the verify/apply arm of rb-import (#203 split,
// the rb-dedup pattern): the subprocess payload parsers (write + post-
// verify), the verification contract, and the ONE sanctioned master-DB
// write (applyImport). rb-import.ts keeps the gates, probe, dupe gate,
// and the rbImport sequencer; this module owns everything that runs
// AFTER the dupe gate says yes.
import { isNonNegativeInteger, isUnknownArray } from "../shared/leaf/guards";
import {
  isDecimalIdOrNull,
  isStringPair,
  lastJsonLine,
  makePayloadParser,
  rbPythonFile,
} from "./rb-command-kit.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";

export interface PyOut {
  inserted: number;
  already: number;
  gated: number;
  linked: number;
  playlistId: string | null;
  parentId: string | null;
  errors: [string, string][];
}

export interface VerifyOut {
  hit: number;
  broken: number;
  total: number;
  playlistRows: number;
  contiguous: boolean;
  playlistExists: boolean;
}

const isStringPairList = (v: unknown): v is [string, string][] =>
  isUnknownArray(v) && v.every(isStringPair);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const parseWriteShape = makePayloadParser<PyOut>(
  "pyrekordbox write",
  "pyrekordbox write returned an invalid result payload",
  {
    inserted: isNonNegativeInteger,
    already: isNonNegativeInteger,
    linked: isNonNegativeInteger,
    gated: isNonNegativeInteger,
    playlistId: isDecimalIdOrNull,
    parentId: isDecimalIdOrNull,
    errors: isStringPairList,
  },
);

const parseVerifyShape = makePayloadParser<VerifyOut>(
  "pyrekordbox post-verify",
  "pyrekordbox post-verify returned invalid counters",
  {
    hit: isNonNegativeInteger,
    broken: isNonNegativeInteger,
    total: isNonNegativeInteger,
    playlistRows: isNonNegativeInteger,
    contiguous: isBoolean,
    playlistExists: isBoolean,
  },
);

export function parseWriteOutput(raw: string): PyOut {
  return parseWriteShape(raw);
}

export function parseVerifyOutput(raw: string): VerifyOut {
  return parseVerifyShape(raw);
}

export function verificationError(
  found: number,
  py: PyOut,
  verified: VerifyOut,
): string | null {
  // F11: gated files are accounted for but get NO content row and NO
  // playlist row — the verify expectations use the row-bearing count.
  const rows = py.inserted + py.already;
  if (py.errors.length > 0)
    return `pyrekordbox write reported ${py.errors.length} row error(s)`;
  if (rows + py.gated !== found)
    return `pyrekordbox write accounted for ${rows + py.gated}/${found} imported files`;
  if (verified.total < verified.hit)
    return `post-verify returned impossible counters (${verified.hit} hits across ${verified.total} rows)`;
  if (verified.hit !== rows)
    return `post-verify referenced ${verified.hit}/${rows} imported files`;
  if (verified.broken !== 0)
    return `post-verify found ${verified.broken} missing file path(s) in the collection`;
  if (!verified.playlistExists)
    return "post-verify could not re-read the playlist row";
  if (!verified.contiguous)
    return "post-verify found a non-contiguous playlist TrackNo sequence";
  if (verified.playlistRows !== rows)
    return `post-verify found ${verified.playlistRows}/${rows} playlist member rows`;
  return null;
}

/** The success counters + error bookkeeping the apply phase threads
 *  through (mutation + verify callbacks write into these). */
export interface ApplyCounters {
  py: PyOut;
  backedUpTo: string | null;
  verified: number;
  stillBroken: number;
}

/** rb-import phase 3 (#181): the ONE sanctioned master-DB write — dated
 *  backup via the twin seam, pyrekordbox write, XML twin nodes, delayed
 *  fresh-process post-verify. Throws only for the caller's failure
 *  envelope; all counters are kept in `counters` so a mid-apply error
 *  still reports partial state. `gatedPaths` are F11 dupe-gated files —
 *  imported never, and excluded from post-verify's expected row count. */
export function applyImport(
  ctx: {
    dbPath: string;
    folder: string;
    playlist: string;
    group: string | null;
    payloadFiles: (string | number | null)[][];
    gatedPaths: string[];
    log: (s: string) => void;
  },
  counters: ApplyCounters,
): void {
  const { dbPath, playlist, group, payloadFiles, gatedPaths } = ctx;
  const mutation = applyPlaylistTwinMutation({
    dbPath,
    what: "rb-import",
    log: ctx.log,
    onBackup: ({ db }) => {
      counters.backedUpTo = db;
    },
    mutateDb: () => {
      const result = rbPythonFile({
        file: "import-write.kit.py",
        args: [
          dbPath,
          JSON.stringify({
            files: payloadFiles,
            playlist,
            group,
            gated: gatedPaths.map((p) => [p]),
          }),
        ],
        timeoutMs: 300_000,
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
      const result = rbPythonFile({
        file: "import-verify.py",
        args: [
          dbPath,
          JSON.stringify(payloadFiles.map((file) => file[0])),
          value.playlistId,
        ],
        timeoutMs: 120_000,
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
