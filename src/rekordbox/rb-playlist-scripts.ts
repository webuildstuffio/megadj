// rb-playlist-scripts.ts — boundary parsers for rb-playlist's python
// corpus programs (#88 item 2 extraction; #194 moved the program bodies
// themselves into rb-scripts/playlist-*.py, spawned via rbPythonFile —
// this module keeps ONLY the JSON-stdout validators).
import {
  isDecimalIdOrNull,
  isStringArray,
  makePayloadParser,
} from "./rb-command-kit.js";
import { isNonNegativeInteger } from "../../cratedeck/shared/guards";

export const PYRK_TAG =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git@f695541827cc488af267d6ca8a8e0052598d85a0";

export interface PyOut {
  linked: number;
  unmatched: string[];
  playlistId: string | null;
  parentId: string | null;
  errors: string[];
}

export interface PlaylistVerifyOut {
  rows: number;
  contiguous: boolean;
}

export interface MatchPrediction {
  hit: number;
  unmatched: string[];
}

export function parseWriteOutput(raw: string): PyOut {
  return makePayloadParser<PyOut>(
    "pyrekordbox playlist write",
    "pyrekordbox playlist write returned an invalid result payload",
    {
      linked: isNonNegativeInteger,
      unmatched: isStringArray,
      playlistId: isDecimalIdOrNull,
      parentId: isDecimalIdOrNull,
      errors: isStringArray,
    },
  )(raw);
}

export function parseVerifyOutput(raw: string): PlaylistVerifyOut {
  return makePayloadParser<PlaylistVerifyOut>(
    "pyrekordbox playlist post-verify",
    "pyrekordbox playlist post-verify returned an invalid result payload",
    {
      rows: isNonNegativeInteger,
      contiguous: (v): v is boolean => typeof v === "boolean",
    },
  )(raw);
}

export function parseMatchPrediction(raw: string): MatchPrediction {
  return makePayloadParser<MatchPrediction>(
    "pyrekordbox playlist match probe",
    "pyrekordbox playlist match probe returned an invalid result payload",
    {
      hit: isNonNegativeInteger,
      unmatched: isStringArray,
    },
  )(raw);
}
