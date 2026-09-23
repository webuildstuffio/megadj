// rb-playlist-apply.ts — the write/verify arm of rb-playlist (#232
// split, the rb-dedup/rb-import-apply pattern): the ONE sanctioned
// playlist-twin mutation (backup → python write → XML nodes → post-
// verify) and the apply-leg result shape. rb-playlist.ts keeps the
// gates, chain build, read-only predict probe, and the rbPlaylist
// sequencer; this module owns everything that writes the master DB.
import { rbPythonFile } from "./rb-python-file.js";
import { lastJsonLine } from "./rb-command-kit.js";
import { applyPlaylistTwinMutation } from "./rb-playlist-twin.js";
import { errMessage as errorText } from "../shared/leaf/fmt";
import {
  parseVerifyOutput,
  parseWriteOutput,
  PYRK_TAG,
  type PyOut,
} from "./rb-playlist-scripts.js";
import type { RbPlaylistOptions, RbPlaylistResult } from "./rb-playlist.js";
import { gateFail } from "./rb-playlist-types";

/** The chain-track shape the apply leg consumes (produced by
 *  rb-playlist.ts buildChain; declared here as the write-side contract).
 *  `base` is the join key into the master's content rows. */
export interface ChainTrack {
  videoId: string;
  path: string | null;
  base: string | null;
  title: string | null;
  /** #106 Phase D: derived handoff windows (8-bar ledger boundaries),
   *  rendered in the dry-run report as per-step mix evidence. Null when
   *  the track has no cues ledger row — absence is honest. */
  mixIn: string | null;
  mixOut: string | null;
}


/** Apply mode: run the playlist-twin mutation (backup → python write →
 *  XML nodes → post-verify). All failure returns keep the counters the
 *  report needs. */
export function applyPlaylist(
  dbPath: string,
  group: string,
  playlist: string,
  chain: ChainTrack[],
  log: (s: string) => void,
): {
  py: PyOut;
  backedUpTo: string | null;
  verified: number;
  error?: string;
} {
  let backedUpTo: string | null = null;
  const py: PyOut = {
    linked: 0,
    unmatched: [],
    playlistId: null,
    parentId: null,
    errors: [],
  };
  let verified = 0;
  try {
    const mutation = applyPlaylistTwinMutation({
      dbPath,
      what: "rb-playlist",
      log,
      onBackup: ({ db }) => {
        backedUpTo = db;
      },
      mutateDb: () => {
        const result = rbPythonFile({
          file: "playlist-write.kit.py",
          args: [
            dbPath,
            JSON.stringify({
              chain: chain.map((track) => ({
                path: track.path ?? "",
                base: track.base ?? "",
                title: track.title,
              })),
              playlist,
              group,
            }),
          ],
          timeoutMs: 300_000,
          withPkg: PYRK_TAG,
        });
        const value = parseWriteOutput(lastJsonLine(result.stdout));
        if (
          value.playlistId === null ||
          value.parentId === null ||
          value.errors.length > 0
        )
          throw new Error(
            value.errors[0] ??
              "pyrekordbox playlist write returned incomplete playlist ids",
          );
        return value;
      },
      nodes: (value) => {
        if (value.playlistId === null || value.parentId === null)
          throw new Error("playlist mutation returned incomplete ids");
        return [
          { id: value.parentId, name: group, parentId: "0", attribute: 1 },
          {
            id: value.playlistId,
            name: playlist,
            parentId: value.parentId,
            attribute: 0,
          },
        ];
      },
      verifyDb: (value) => {
        if (value.playlistId === null)
          throw new Error("playlist mutation returned no playlist id");
        const result = rbPythonFile({
          file: "playlist-verify.py",
          args: [dbPath, value.playlistId],
          timeoutMs: 120_000,
          withPkg: PYRK_TAG,
        });
        const check = parseVerifyOutput(lastJsonLine(result.stdout));
        verified = check.rows;
        if (!check.contiguous || verified !== value.linked)
          throw new Error(
            !check.contiguous
              ? "post-verify: TrackNo sequence is not contiguous"
              : `post-verify: ${verified}/${value.linked} linked rows found`,
          );
      },
    });
    return { py: mutation.value, backedUpTo: mutation.backedUpTo, verified };
  } catch (error) {
    return { py, backedUpTo, verified, error: errorText(error) };
  }
}

/** Unmatched chain titles → report rows (the reason is uniform). */
export function unmatchedRows(titles: string[]): {
  title: string;
  reason: string;
}[] {
  return titles.map((t) => ({
    title: t,
    reason: "no content row in master — run the fullpush import for it first",
  }));
}

/** The apply leg's success/failure result shapes (gate 5 has passed).
 *  Split from the gates so each half stays reviewable on its own. */
export function rbPlaylistApplyLeg(
  opts: RbPlaylistOptions,
  dbPath: string,
  group: string,
  playlistName: string,
  chain: ChainTrack[],
  preset: string,
  minutes: number,
  log: (s: string) => void,
): RbPlaylistResult {
  const applied = applyPlaylist(dbPath, group, playlistName, chain, log);
  if (applied.error !== undefined) {
    return {
      ...gateFail(opts, dbPath, group, applied.error),
      playlist: playlistName,
      preset,
      minutes,
      chain: chain.length,
      linked: applied.py.linked,
      verified: applied.verified,
      playlistId: applied.py.playlistId,
      backedUpTo: applied.backedUpTo,
      errors: [...applied.py.errors, applied.error],
    };
  }
  return {
    command: "rb-playlist",
    db: dbPath,
    playlist: playlistName,
    group,
    preset,
    minutes,
    chain: chain.length,
    linked: applied.py.linked,
    unmatched: unmatchedRows(applied.py.unmatched),
    // apply leg: the playlist write carries no cue pads (cue writes are a
    // separate gated surface) — the windows stay dry-run evidence only
    cueWindows: chain.map((c) => ({
      title: c.title ?? c.videoId,
      mixIn: c.mixIn,
      mixOut: c.mixOut,
    })),
    playlistId: applied.py.playlistId,
    verified: applied.verified,
    appliedMode: true,
    backedUpTo: applied.backedUpTo,
    errors: applied.py.errors,
    ok: true,
  };
}
