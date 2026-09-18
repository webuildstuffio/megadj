/**
 * megadj rb-playlist — bridge a set-builder proposal into the shelf
 * master DB (rekordbox playlist). The write-side twin of `megadj
 * megaset` (AGENTS.md: RB auto-writes are the rb-* seams' job only).
 *
 * Unlike rb-import this injects NO new DjmdContent rows: every chain
 * track was already imported by the fullpush pipeline — we only create
 * the playlist (under a parent group) and link EXISTING content rows by
 * filename. Matching prefers the NFC/casefold-normalized full path and uses
 * a basename only when it identifies exactly one content row (archive paths
 * can differ from SHELF1/Contents paths). The FileNameL 60-char clip is
 * tolerated; unmatched tracks are reported, never silently dropped.
 *
 * Safety gates (identical to rb-import):
 *   1. flags validated before any I/O (--apply requires --yes)
 *   2. set inputs validated by the SAME parser the CLI/web use
 *   3. target master DB must exist before the archive is scanned
 *   4. the chain comes from the SAME engine (`buildMegaset`) the CLI/web use
 *   5. rekordbox must be QUIT (pgrep) — it holds a live WAL
 *   6. dated DB backup (+ WAL/SHM) next to the master before any write
 *   7. dry-run by default; --apply --yes to write
 *   8. post-verify: song-playlist row count == linked + TrackNo contiguity
 *
 * Split per concern (#232): this file keeps the gates + chain build +
 * read-only predict probe + the rbPlaylist sequencer;
 * rb-playlist-apply.ts owns the write/verify arm (the playlist-twin
 * mutation and the apply-leg result shape).
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { ArchiveReader } from "../../cratedeck/src/archive";
import {
  buildMegaset,
  parseMegasetQuery,
  SET_PRESETS,
  type MegasetPresetId,
} from "../../cratedeck/src/megaset";
import { clampMegasetPool } from "../../cratedeck/shared/types";
import { DB_PATH } from "../cli-env";
import {
  applyConfirmationRefusal,
  lastJsonLine,
  printResult,
  rbPythonFile,
} from "./rb-command-kit.js";
import { masterDbPath } from "./master-path.js";
import { errorText } from "../shared/error-text";
import { commandLog } from "../shared/progress";
import { rekordboxRunning } from "./guard.js";
import {
  parseMatchPrediction,
  parseWriteOutput,
  parseVerifyOutput,
  PYRK_TAG,
  type MatchPrediction,
} from "./rb-playlist-scripts.js";
import {
  rbPlaylistApplyLeg,
  unmatchedRows,
  type ChainTrack,
} from "./rb-playlist-apply";

export interface RbPlaylistOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Same params as `megadj megaset` — one engine, one validation. */
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  /** Playlist name (defaults to "megaset <preset> <minutes>min <date>"). */
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
  /** #106 Phase D: per-step handoff windows from the cues ledger, in
   *  chain order ("45s @ bar 25"; null = no cue row for that track).
   *  Dry-run evidence only — the apply leg writes the playlist rows, not
   *  cue pads (cue writes are a separate gated surface). */
  cueWindows: { title: string; mixIn: string | null; mixOut: string | null }[];
  /** In apply mode: playlist row ID. */
  playlistId: string | null;
  /** Post-write verify: song-playlist rows under our playlist. */
  verified: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  errors: string[];
  ok: boolean;
  error?: string;
}

// PYRK_TAG + the python program builders (buildScript/verifyScript/predictScript) +
// the boundary parsers moved to rb-playlist-scripts.ts (#88 item 2) — import-only here.
/** Deterministic date stamp for the default playlist name. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build the chain with the SAME engine the CLI/web use, and keep each
 *  track's archive FILENAME — the join key into the master's content
 *  rows. One readonly archive pass; candidates carry file_path. */
function buildChain(
  opts: RbPlaylistOptions,
  parsed: { preset: MegasetPresetId; minutes: number },
):
  { chain: ChainTrack[]; preset: string; minutes: number } | { error: string } {
  const archive = new ArchiveReader(DB_PATH);
  try {
    if (!archive.available()) return { error: `no archive at ${DB_PATH}` };
    const { candidates } = archive.setCandidates(
      clampMegasetPool(opts.limit ?? null),
    );

    const built = buildMegaset({
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
          path: fp ?? null,
          // the FILENAME is the join key into the master's content rows —
          // basename it ONCE here so every consumer (predict, apply)
          // sends exactly what buildScript matches
          base: fp ? basename(fp) : null,
          title: s.title ?? s.videoId,
          mixIn: cueWindowLabel(s.mixInCue),
          mixOut: cueWindowLabel(s.mixOutCue),
        };
      }),
      preset: parsed.preset,
      minutes: parsed.minutes,
    };
  } finally {
    archive.close();
  }
}

/** The handoff evidence string for one window ("45s @ bar 25"), or null. */
const cueWindowLabel = (
  cue: { bar: number; position: number } | null,
): string | null =>
  cue === null ? null : `${Math.round(cue.position)}s @ bar ${cue.bar}`;

/** Dry-run honesty: predict the matches READ-ONLY so the report shows
 *  real numbers, never a fake "0 linked". */
function predictUnmatched(
  dbPath: string,
  chain: ChainTrack[],
  log: (s: string) => void,
): { unmatched: string[]; error?: string } {
  try {
    const pred = predictMatches(
      dbPath,
      chain.map((c) => ({ path: c.path, base: c.base, title: c.title })),
    );
    log(
      `rb-playlist: predict ${pred.hit}/${chain.length} chain tracks have master rows (read-only probe)`,
    );
    return { unmatched: pred.unmatched };
  } catch (error) {
    return { unmatched: [], error: errorText(error) };
  }
}

/** Early-gate failure: everything not yet known stays at its zero value. */
function gateFail(
  opts: RbPlaylistOptions,
  dbPath: string,
  group: string,
  error: string,
): RbPlaylistResult {
  return {
    command: "rb-playlist",
    db: dbPath,
    playlist: opts.playlist ?? "",
    group,
    preset: opts.preset ?? "peak",
    minutes: 0,
    chain: 0,
    linked: 0,
    unmatched: [],
    cueWindows: [],
    playlistId: null,
    verified: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    errors: [],
    ok: false,
    error,
  };
}

/** The dry-run leg: read-only match prediction, no DB writes. */
function rbPlaylistDryRunLeg(
  opts: RbPlaylistOptions,
  dbPath: string,
  group: string,
  playlistName: string,
  chain: ChainTrack[],
  preset: string,
  minutes: number,
  log: (s: string) => void,
): RbPlaylistResult {
  const pred = predictUnmatched(dbPath, chain, log);
  if (pred.error !== undefined) {
    return {
      ...gateFail(opts, dbPath, group, pred.error),
      playlist: playlistName,
      preset,
      minutes,
      chain: chain.length,
      cueWindows: [],
      errors: [pred.error],
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
    linked: 0,
    unmatched: unmatchedRows(pred.unmatched),
    cueWindows: chain.map((c) => ({
      title: c.title ?? c.videoId,
      mixIn: c.mixIn,
      mixOut: c.mixOut,
    })),
    playlistId: null,
    verified: 0,
    appliedMode: false,
    backedUpTo: null,
    errors: [],
    ok: true,
  };
}

export async function rbPlaylist(
  opts: RbPlaylistOptions,
): Promise<RbPlaylistResult> {
  const log = opts.log ?? commandLog({});
  const dbPath = masterDbPath(opts.mount);
  const group = opts.group ?? "DJ-Imports";

  // gate 1 — flags before any I/O
  const flagRefusal = applyConfirmationRefusal(opts);
  if (flagRefusal !== null) return gateFail(opts, dbPath, group, flagRefusal);

  // gate 2 — validate the shared set-builder inputs without touching either
  // database. Invalid presets must still beat a missing-drive error.
  const parsed = parseMegasetQuery({
    preset: opts.preset ?? null,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) return gateFail(opts, dbPath, group, parsed.error);

  // gate 3 — reject an absent master before scanning/probing every archive
  // file. This is both the cheap failure path and a hardware safety boundary.
  if (!existsSync(dbPath))
    return gateFail(opts, dbPath, group, `no master DB at ${dbPath}`);

  // gate 4 — the chain (same engine as megaset CLI/web)
  const built = buildChain(opts, parsed);
  if ("error" in built) return gateFail(opts, dbPath, group, built.error);
  const { chain, preset, minutes } = built;
  const noFile = chain.filter((c) => c.base === null).length;
  if (noFile > 0)
    log(
      `rb-playlist: ${noFile} chain tracks have no local file path — reported as unmatched`,
    );
  const playlistName =
    opts.playlist ?? `megaset ${preset} ${minutes}min ${todayStamp()}`;
  log(
    `rb-playlist: chain of ${chain.length} (${preset}, ${minutes} min) → "${playlistName}" in "${group}" on ${dbPath}`,
  );

  // gate 5 — rekordbox quit
  if (rekordboxRunning())
    return gateFail(
      opts,
      dbPath,
      group,
      "rekordbox is running — quit it (live WAL) before rb-playlist",
    );

  if (opts.apply && opts.yes) {
    return rbPlaylistApplyLeg(
      opts,
      dbPath,
      group,
      playlistName,
      chain,
      preset,
      minutes,
      log,
    );
  }

  // dry-run honesty: predict the matches READ-ONLY so the report shows
  // real numbers, never a fake "0 linked"
  return rbPlaylistDryRunLeg(
    opts,
    dbPath,
    group,
    playlistName,
    chain,
    preset,
    minutes,
    log,
  );
}

/** Dry-run prediction: read-only probe of the master (no writes). */
function predictMatches(
  dbPath: string,
  chain: { path: string | null; base: string | null; title: string | null }[],
): { hit: number; unmatched: string[] } {
  const result = rbPythonFile({
    file: "playlist-predict.kit.py",
    args: [
      dbPath,
      JSON.stringify({
        chain: chain.map((c) => ({
          path: c.path ?? "",
          base: c.base ?? "",
          title: c.title,
        })),
      }),
    ],
    timeoutMs: 120_000,
    withPkg: PYRK_TAG,
  });
  return parsePredictionProcess(result);
}

function parsePredictionProcess(result: {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}): MatchPrediction {
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `rb-playlist match probe failed (exit ${String(result.status)}): ${(result.stderr ?? "").slice(-200)}`,
    );
  }
  try {
    return parseMatchPrediction(lastJsonLine(result.stdout));
  } catch (error) {
    throw new Error(
      `rb-playlist match probe returned an invalid result: ${errorText(error)}`,
      { cause: error },
    );
  }
}

export const __test = {
  parsePredictionProcess,
  parseWriteOutput,
  parseVerifyOutput,
  parseMatchPrediction,
};

export function printRbPlaylistReport(
  r: RbPlaylistResult,
  log: (s: string) => void,
): void {
  printResult(log, r, (body) => {
    log(
      `chain ${body.chain} → linked ${body.linked} · playlist "${body.playlist}" (in "${body.group}") on ${body.db}`,
    );
    for (const u of body.unmatched.slice(0, 10))
      log(`  ? ${u.title} — ${u.reason}`);
    if (body.unmatched.length > 10)
      log(`  … and ${body.unmatched.length - 10} more unmatched`);
    for (const e of body.errors.slice(0, 10)) log(`  ✗ ${e}`);
    if (body.appliedMode) {
      log(
        `post-verify: ${body.verified}/${body.linked} rows linked${body.backedUpTo ? ` · backup ${body.backedUpTo}` : ""}`,
      );
    } else {
      log(
        `dry-run — re-run with --apply --yes (rekordbox quit) to create the playlist and link ${body.chain} tracks`,
      );
      if (body.unmatched.length > 0) {
        log(
          `${body.unmatched.length} chain track(s) have no master row yet — they will be skipped and reported`,
        );
      }
      // #106 Phase D: per-step handoff windows — dry-run evidence for the
      // phrase-aware handoff plan (the apply leg writes playlist rows,
      // never cue pads). Tracks without a ledger row say so honestly.
      if (body.cueWindows.some((w) => w.mixIn !== null || w.mixOut !== null)) {
        for (const w of body.cueWindows) {
          const windows =
            w.mixIn !== null || w.mixOut !== null
              ? [
                  w.mixIn !== null ? `mix-in ${w.mixIn}` : null,
                  w.mixOut !== null ? `mix-out ${w.mixOut}` : null,
                ].filter((part) => part !== null)
              : ["no cue windows (no cues ledger row)"];
          log(`  ♪ ${w.title} — ${windows.join(" · ")}`);
        }
      }
    }
  });
}
