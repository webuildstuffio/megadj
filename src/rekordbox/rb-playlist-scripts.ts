// rb-playlist-scripts.ts — boundary parsers for rb-playlist's python
// corpus programs (#88 item 2 extraction; #194 moved the program bodies
// themselves into rb-scripts/playlist-*.py, spawned via rbPythonFile —
// this module keeps ONLY the JSON-stdout validators).
import {
  isDecimalIdOrNull,
  isStringArray,
  parseJsonBoundary,
} from "./rb-command-kit.js";
import { isRecord, isNonNegativeInteger } from "../../cratedeck/shared/guards";

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
  const value = parseJsonBoundary(raw, "pyrekordbox playlist write");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.linked) ||
    !isStringArray(value.unmatched) ||
    !isDecimalIdOrNull(value.playlistId) ||
    !isDecimalIdOrNull(value.parentId) ||
    !isStringArray(value.errors)
  ) {
    throw new Error(
      "pyrekordbox playlist write returned an invalid result payload",
    );
  }
  return {
    linked: value.linked,
    unmatched: value.unmatched,
    playlistId: value.playlistId,
    parentId: value.parentId,
    errors: value.errors,
  };
}

export function parseVerifyOutput(raw: string): PlaylistVerifyOut {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist post-verify");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.rows) ||
    typeof value.contiguous !== "boolean"
  ) {
    throw new Error(
      "pyrekordbox playlist post-verify returned an invalid result payload",
    );
  }
  return { rows: value.rows, contiguous: value.contiguous };
}

export function parseMatchPrediction(raw: string): MatchPrediction {
  const value = parseJsonBoundary(raw, "pyrekordbox playlist match probe");
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.hit) ||
    !isStringArray(value.unmatched)
  ) {
    throw new Error(
      "pyrekordbox playlist match probe returned an invalid result payload",
    );
  }
  return { hit: value.hit, unmatched: value.unmatched };
}
