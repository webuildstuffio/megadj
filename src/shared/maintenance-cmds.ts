/**
 * maintenance-cmds.ts — the shelf-maintenance command cases for cli.ts
 * (file-length guard: cli.ts sits at the 800-line cap; these cases
 * live here as one unit, same seam as the old shelf_cmds.ts). Pure
 * flag-parsing + dynamic import + delegation — all logic lives in
 * src/commands/shelf-hygiene.ts, rb-fix-paths.ts, and grid-triage.ts.
 *
 * Flags go through cli-flags.ts (`parseFlags`/`nonNegOpt`/
 * `firstPositional`) — the sanctioned parser. Hand-rolling broke three
 * ways at once (super-sure pass, Sep 10): space-form flags documented in
 * usage/runbook (`--tag q1`, `--limit 20`) silently unparsed; `--limit
 * 20` parsed the value as NaN and `slice(0, Math.max(0, NaN))` triaged
 * ZERO rows while "succeeding" (the exact Number() trap AGENTS.md
 * bans); and the positional filter ate the `snapshot`/`compare` mode
 * word plus `--compare DJMASTER`'s value.
 *
 * #88 (scope 1): the arms are named handler functions behind the
 * MAINTENANCE_COMMANDS table instead of a 12-case switch (CCN 67 — the
 * repo's last P0-complexity function). The `MaintenanceVerb` union
 * makes the table exhaustive at compile time: a verb without a handler
 * — or a handler without a verb — is a type error, not a silent
 * fall-through.
 */

import { DB_PATH } from "../cli-env";
import {
  parseFlags,
  nonNegOpt,
  nonNegOptInvalid,
  positionalArgs as positionalArgsShared,
} from "../cli-flags";
import { ArchiveState } from "../archive/state";
import {
  configuredMasterDrive,
  resolveShelfVolume,
  volumePath,
} from "./volume";
import { finishCommandError, setExit, writeJson } from "./cli-output";
import type { AnlzSpikeMode } from "../rekordbox/anlz-spike";

/** Commands handled by this module; cli.ts and the parity census share it. */
export const MAINTENANCE_VERBS = [
  "shelf-hygiene",
  "shelf-restore",
  "tmp-purge",
  "rb-fix-paths",
  "rb-unmatched",
  "rb-adopt",
  "rb-import",
  "rb-playlist",
  "rb-cues",
  "rb-dedup",
  "rb-comment-sync",
  "rb-anlz-spike",
  "rb-grid-triage",
] as const;

export type MaintenanceVerb = (typeof MAINTENANCE_VERBS)[number];

/** One maintenance arm: parse flags, delegate, set exits. */
export type MaintenanceHandler = (rest: string[]) => Promise<void>;

/** Resolve the drive mount: first positional (`SHELF1` or an absolute
 * path) else the configured volume name. Shared by every arm below. */
function mountFrom(positional: string | undefined): string {
  if (positional) return volumePath(positional);
  return resolveShelfVolume();
}

/** The common `--json` read shared by every arm. */
function jsonFlag(flags: ReturnType<typeof parseFlags>): boolean {
  return flags.bools.has("json");
}

/** Option-object fragment: `json` + the matching quiet progress log. */
function jsonOpts(json: boolean): {
  json: boolean;
  log: (message: string) => void;
} {
  return { json, log: progressLog(json) };
}

/** Keep progress messages off stdout when --json owns that channel. */
function progressLog(json: boolean): (message: string) => void {
  return (message) => {
    if (!json) console.log(message);
  };
}

/** Emit a command result (the #88 shared seam): `--json` writes exactly
 *  one stdout object through the awaited `writeJson` seam; otherwise
 *  render the human report. Every maintenance arm ends with this — the
 *  old 10× hand-written if/else was where report/json parity drifted. */
async function emitResult<T>(
  json: boolean,
  result: T,
  printReport: (result: T, log: (message: string) => void) => void,
): Promise<void> {
  if (json) await writeJson(result);
  else printReport(result, console.log);
}

/** Repeatable `--key=value` string options (shelf-hygiene's
 * confirm/dismiss lists). */
function manyOf(rest: string[], key: string): string[] {
  return rest
    .filter((a) => a.startsWith(`--${key}=`))
    .map((a) => a.slice(key.length + 3))
    .filter((v): v is string => v.length > 0);
}

/** First positional that is not a consumed flag VALUE: `--tag q1
 * snapshot` must not read "q1" as a positional. Mirrors parseFlags'
 * space-form consumption (a `--key` in stringOpts eats the next
 * non-flag arg). Hand-rolled here first (Sep 10) — promoted to
 * cli-flags.positionalArgs as the one seam; alias keeps the 14 call
 * sites in this file unchanged. */
const positionalArgs = positionalArgsShared;

// ---- shelf tier ----------------------------------------------------------

const shelfRestoreCmd: MaintenanceHandler = async (rest) => {
  const flags = parseFlags(rest, ["into"], ["json"]);
  const input = positionalArgs(rest, ["into"])[0];
  if (!input) {
    await finishCommandError({
      command: "shelf-restore",
      error: "finding-id|path is required",
      exitCode: 2,
    });
    return;
  }
  const { shelfRestore } = await import("../shelf/restore");
  const r = await shelfRestore({
    input,
    into: flags.strings.get("into"),
    shelfVolume: mountFrom(undefined),
    dbPath: DB_PATH,
    ...jsonOpts(jsonFlag(flags)),
  });
  if (!r.ok) setExit(1);
};

const shelfHygieneCmd: MaintenanceHandler = async (rest) => {
  // Detect → ledger → review → apply → validate (the shelf-hygiene
  // feature, CLI half; the web queue lives in CrateDeck). Findings
  // live in the archive DB — the SSOT every surface reads.
  const flags = parseFlags(
    rest,
    ["kind", "shelf", "bucket"],
    ["json", "apply", "yes"],
  );
  const { shelfHygiene } = await import("../shelf/hygiene");
  await shelfHygiene({
    ...jsonOpts(jsonFlag(flags)),
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    // repeatable list flags stay raw-parsed: parseFlags keeps only
    // the last value per key, and confirm/dismiss are multi-value
    confirm: manyOf(rest, "confirm"),
    dismiss: manyOf(rest, "dismiss"),
    kind: flags.strings.get("kind"),
    bucket: flags.strings.get("bucket"),
    shelfVolume: flags.strings.get("shelf"),
  });
};

// ---- tmp tier ------------------------------------------------------------

const tmpPurgeCmd: MaintenanceHandler = async (rest) => {
  // #236: the stale-fixture sweep (cratedeck-hashcancel-* et al grew to
  // 16k dirs / 2.6 GB). Read-only by default; --apply deletes; --all
  // drops the 24h age gate (only when the test gate is known-quiet).
  const flags = parseFlags(rest, [], ["apply", "all", "json"]);
  const json = jsonFlag(flags);
  const { tmpPurge, printTmpPurgeReport } = await import("../shelf/tmp-purge");
  const r = tmpPurge({
    apply: flags.bools.has("apply"),
    all: flags.bools.has("all"),
    json,
    log: progressLog(json),
  });
  await emitResult(json, r, printTmpPurgeReport);
  if (!r.ok) setExit(1);
};

// ---- rekordbox tier ------------------------------------------------------

const rbFixPathsCmd: MaintenanceHandler = async (rest) => {
  // rekordbox library repair: stale djmdContent.FolderPath rows after
  // folder moves/merges. Dry-run by default; --apply --yes rewrites
  // rows (backs the DB up first, refuses while rekordbox runs).
  const flags = parseFlags(rest, [], ["json", "apply", "yes"]);
  const mount = mountFrom(positionalArgs(rest, [])[0]);
  const { rbFixPaths, printRbFixReport } =
    await import("../rekordbox/rb-fix-paths");
  const json = jsonFlag(flags);
  const r = await rbFixPaths({
    mount,
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printRbFixReport);
  if (!r.ok) setExit(1);
};

const rbUnmatchedCmd: MaintenanceHandler = async (rest) => {
  // disk→DB reconcile half: audio files NO rekordbox row references.
  // Read-only census by default; --quarantine --yes moves the unknown
  // set to the shelf quarantine (never deletes, manifest kept). Safe
  // while rekordbox runs — only row-less files move.
  const flags = parseFlags(rest, ["ext"], ["json", "quarantine", "yes"]);
  const mount = mountFrom(positionalArgs(rest, ["ext"])[0]);
  const { rbUnmatched, printRbUnmatchedReport } =
    await import("../rekordbox/rb-unmatched");
  const json = jsonFlag(flags);
  const r = await rbUnmatched({
    mount,
    ext: manyOf(rest, "ext"),
    quarantine: flags.bools.has("quarantine"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printRbUnmatchedReport);
  // gate parity: an unresolved backlog is a visible failure state —
  // but a SUCCESSFUL apply (quarantine ran) leaves unknown == 0 and
  // must read as success; failing it would block automation loops
  if (!r.ok || (r.unknown > 0 && !r.appliedMode)) setExit(1);
};

const rbAdoptCmd: MaintenanceHandler = async (rest) => {
  // Collection census → archive cross-reference. This reads every
  // master Content row but writes archive.db only: exact Rekordbox IDs
  // live in rekordbox_content while source/YouTube IDs remain intact.
  const flags = parseFlags(rest, [], ["json", "apply", "yes"]);
  const mount = mountFrom(positionalArgs(rest, [])[0]);
  const json = jsonFlag(flags);
  const state = new ArchiveState(DB_PATH);
  try {
    const { rbAdopt, printRbAdoptReport } =
      await import("../rekordbox/rb-adopt");
    const result = rbAdopt({
      state,
      archiveDb: DB_PATH,
      mount,
      apply: flags.bools.has("apply"),
      yes: flags.bools.has("yes"),
      ...jsonOpts(json),
    });
    await emitResult(json, result, printRbAdoptReport);
    if (!result.ok || (!result.appliedMode && result.missingFiles > 0))
      setExit(1);
  } finally {
    state.close();
  }
};

/** The shared rb-writer option block (`playlist` + `group` + apply/yes +
 *  json contract) — rb-import and rb-playlist carry identical option
 *  surfaces on top of their own fields (jscpd-flagged twin). */
function rbWriteOpts(
  flags: ReturnType<typeof parseFlags>,
  json: boolean,
): {
  playlist: string | undefined;
  group: string | undefined;
  apply: boolean;
  yes: boolean;
} & ReturnType<typeof jsonOpts> {
  return {
    playlist: flags.strings.get("playlist"),
    group: flags.strings.get("group"),
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  };
}

const rbImportCmd: MaintenanceHandler = async (rest) => {
  // the SANCTIONED headless master-DB import (AGENTS.md: auto-writes
  // are rb-import's job only). One playlist per intake folder under a
  // parent group; dated backup + rekordbox-quit gate + whole-table
  // verify. F11 dupe gate on by default; --allow-dupe escapes it.
  // Dry-run by default; --apply --yes writes.
  const flags = parseFlags(
    rest,
    ["playlist", "group"],
    ["apply", "yes", "json", "allow-dupe"],
  );
  const args = positionalArgs(rest, ["playlist", "group"]);
  const mount = mountFrom(args[0]);
  const folder = args[1];
  if (!folder) {
    // json-safe usage epilogue (P1/#160 ring 3): usage class = exit 2 —
    // the bare finishCommandError call printed human text on stderr even
    // for --json runs and exited 1 (a command-failure code, not usage).
    await finishCommandError({
      command: "rb-import",
      json: flags.bools.has("json"),
      error:
        "usage — megadj rb-import <mount> <folder> [--playlist NAME] [--group NAME] [--allow-dupe] [--apply --yes]",
      exitCode: 2,
    });
    return;
  }
  const { rbImport, printRbImportReport } =
    await import("../rekordbox/rb-import");
  const json = jsonFlag(flags);
  const r = await rbImport({
    mount,
    folder,
    ...rbWriteOpts(flags, json),
    allowDupe: flags.bools.has("allow-dupe"),
  });
  await emitResult(json, r, printRbImportReport);
  if (!r.ok || r.dupes.length > 0) setExit(1);
};

const rbCuesCmd: MaintenanceHandler = async (rest) => {
  // F1/F3 seam (docs/fulltags/intake-cue-postmortem.md): the ONLY writer of
  // djmdCue rows. Default: census of the provenance-pinned Sep 12
  // incident rows; legitimate Kind=0 memory cues are never restamped.
  const flags = parseFlags(
    rest,
    [],
    ["restamp", "ledger", "force", "apply", "yes", "json"],
  );
  const args = positionalArgs(rest, []);
  const mount = mountFrom(args[0]);
  const { rbCues, printRbCuesReport } = await import("../rekordbox/rb-cues");
  const json = jsonFlag(flags);
  const r = await rbCues({
    mount,
    restamp: flags.bools.has("restamp"),
    fromLedger: flags.bools.has("ledger"),
    force: flags.bools.has("force"),
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printRbCuesReport);
  if (!r.ok) setExit(1);
};

const rbDedupCmd: MaintenanceHandler = async (rest) => {
  // F2 (BUG-2): fingerprint-ish dupe sweep over master.db. Report
  // default; --apply --yes retires loser rows + quarantines files.
  const flags = parseFlags(rest, [], ["report", "apply", "yes", "json"]);
  const args = positionalArgs(rest, []);
  const mount = mountFrom(args[0]);
  const { rbDedup, printRbDedupReport } = await import("../rekordbox/rb-dedup");
  const json = jsonFlag(flags);
  const r = await rbDedup({
    mount,
    report: flags.bools.has("report"),
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printRbDedupReport);
  if (!r.ok) setExit(1);
};

const rbCommentSyncCmd: MaintenanceHandler = async (rest) => {
  // fulltags → RB comment backfill: file TXXX (CAMELOT/ENERGY/MOOD)
  // + archive.db mood ledger → Commnt in FullTags format. Never
  // clobbers a non-empty comment. Dry-run default.
  const flags = parseFlags(rest, ["batch"], ["apply", "yes", "json"]);
  const args = positionalArgs(rest, ["batch"]);
  const mount = mountFrom(args[0]);
  const { rbCommentSync, printRbCommentSyncReport } =
    await import("../rekordbox/rb-comment-sync");
  const json = jsonFlag(flags);
  const r = await rbCommentSync({
    mount,
    batch: flags.strings.get("batch"),
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printRbCommentSyncReport);
  if (!r.ok) setExit(1);
};

const rbPlaylistCmd: MaintenanceHandler = async (rest) => {
  // `megadj rb-playlist reconcile` — XML-twin healer (F7): diff
  // djmdPlaylist rows vs masterPlaylists6.xml NODEs; apply adds
  // missing NODEs. Anything else = the set-builder chain writer.
  const restArgs = rest.filter((a) => a !== "reconcile");
  if (rest.length !== restArgs.length) {
    const flags = parseFlags(restArgs, [], ["apply", "yes", "json"]);
    const args = positionalArgs(restArgs, []);
    const mount = mountFrom(args[0]);
    const { rbPlaylistReconcile, printReconcileReport } =
      await import("../rekordbox/rb-playlist-reconcile");
    const json = jsonFlag(flags);
    const r = await rbPlaylistReconcile({
      mount,
      apply: flags.bools.has("apply"),
      yes: flags.bools.has("yes"),
      ...jsonOpts(json),
    });
    await emitResult(json, r, printReconcileReport);
    if (!r.ok) setExit(1);
    return;
  }
  // set-builder chain → master-DB playlist. The write-side twin of
  // `megadj megaset`: NO new content rows, only playlist + links to
  // rows the fullpush pipeline already imported (basename match).
  // Same gates as rb-import: dated backup, rekordbox-quit gate,
  // dry-run default, post-verify.
  const flags = parseFlags(
    rest,
    ["playlist", "group", "preset", "minutes", "opener", "limit"],
    ["apply", "yes", "json"],
  );
  const args = positionalArgs(rest, [
    "playlist",
    "group",
    "preset",
    "minutes",
    "opener",
    "limit",
  ]);
  const mount = mountFrom(args[0]);
  const json = jsonFlag(flags);
  // nonNegOpt is the sanctioned numeric seam (cli-flags.ts): bad input =
  // json-safe exit-2 epilogue, zero work. The old hand-rolled numOpt twin
  // duplicated it and needed exitCode READS to bail out (the census's only
  // sanctioned reads) — nonNegOpt + nonNegOptInvalid needs neither.
  if (nonNegOptInvalid(flags, "minutes", "rb-playlist", json)) return;
  const minutes = nonNegOpt(flags, "minutes", "rb-playlist", json);
  if (nonNegOptInvalid(flags, "limit", "rb-playlist", json)) return;
  const limit = nonNegOpt(flags, "limit", "rb-playlist", json);
  const { rbPlaylist, printRbPlaylistReport } =
    await import("../rekordbox/rb-playlist");
  const r = await rbPlaylist({
    mount,
    preset: flags.strings.get("preset"),
    minutes,
    opener: flags.strings.get("opener"),
    limit,
    ...rbWriteOpts(flags, json),
  });
  await emitResult(json, r, printRbPlaylistReport);
  if (!r.ok || r.unmatched.length > 0) setExit(1);
};

// ---- analysis/harness tier ----------------------------------------------

const rbAnlzSpikeCmd: MaintenanceHandler = async (rest) => {
  // GA-07 harness: snapshot/compare ANLZ sidecars around a manual
  // rekordbox experiment (re-export, grid nudge). Read-only on the
  // drive; the baseline lives in ~/.local/state/megadj/spike/.
  const flags = parseFlags(rest, ["tag"], ["json"]);
  // Two positionals: mount (first) + mode word (snapshot|compare).
  // Order-free per usage: `[drive] snapshot|compare`.
  const args = positionalArgs(rest, ["tag"]);
  const modeWord = args.find((a) => a === "snapshot" || a === "compare");
  const mountPos = args.find((a) => a !== "snapshot" && a !== "compare");
  const mode: AnlzSpikeMode = modeWord === "compare" ? "compare" : "snapshot";
  if (args.some((a) => a !== "snapshot" && a !== "compare" && a !== mountPos)) {
    await finishCommandError({
      command: "rb-anlz-spike",
      error: "too many arguments (usage: [drive] snapshot|compare)",
      exitCode: 2,
    });
    return;
  }
  if (modeWord === undefined) {
    await finishCommandError({
      command: "rb-anlz-spike",
      error: "mode is required (snapshot|compare)",
      exitCode: 2,
    });
    return;
  }
  const tag = flags.strings.get("tag") ?? "";
  if (!tag) {
    await finishCommandError({
      command: "rb-anlz-spike",
      error: "--tag=<label> is required (names the baseline file)",
      exitCode: 2,
    });
    return;
  }
  const mount = mountFrom(mountPos);
  const json = jsonFlag(flags);
  const { anlzSpike, printSpikeReport } =
    await import("../rekordbox/anlz-spike");
  const r = anlzSpike({
    mount,
    tag,
    mode,
    ...jsonOpts(json),
  });
  await emitResult(json, r, printSpikeReport);
  if (!r.ok) setExit(1);
};

const rbGridTriageCmd: MaintenanceHandler = async (rest) => {
  // GA-03 triage + GA-04 completion: decode the collection ANLZ
  // grid, byte-compare against a stick (--compare), and audit our
  // fitted ledger grids against what rekordbox actually wrote.
  // Read-only — no pgrep guard needed (only writes need it).
  const flags = parseFlags(rest, ["limit", "compare"], ["json"]);
  const limit = nonNegOpt(flags, "limit", "rb-grid-triage");
  // `--limit` present but invalid: nonNegOpt printed the error and
  // set exit 2 — bail with zero work (the nonNegOpt contract).
  if (flags.strings.has("limit") && limit === undefined) return;
  const rawCompare = flags.strings.get("compare");
  if (rawCompare === "") {
    await finishCommandError({
      command: "rb-grid-triage",
      error: "--compare= requires a drive name",
      exitCode: 2,
    });
    return;
  }
  // `--compare DJMASTER` (string value), bare `--compare` (default to
  // the CONFIGURED master drive — config.toml library.master_drive is the
  // SSOT; the old undocumented MEGADJ_MASTER_DRIVE env twin made this arm
  // diverge from every other surface's drive name), or absent
  // (undefined = no compare).
  const compareDrive =
    rawCompare !== undefined
      ? rawCompare
      : rest.includes("--compare")
        ? configuredMasterDrive()
        : undefined;
  const mount = mountFrom(
    positionalArgs(rest, ["limit", "compare"]).find(
      (a) => a !== "snapshot" && a !== "compare",
    ),
  );
  const json = jsonFlag(flags);
  const state = new ArchiveState(DB_PATH);
  try {
    const { gridTriage, printGridTriageReport } =
      await import("../rekordbox/grid-triage");
    const r = await gridTriage({
      mount,
      state,
      limit,
      compareDrive,
      ...jsonOpts(json),
    });
    await emitResult(json, r, printGridTriageReport);
    if (!r.ok) setExit(1);
  } finally {
    state.close();
  }
};

// ---- the dispatch table (compile-time exhaustive over the verbs) --------

export const MAINTENANCE_COMMANDS: Readonly<
  Record<MaintenanceVerb, MaintenanceHandler>
> = {
  "shelf-hygiene": shelfHygieneCmd,
  "shelf-restore": shelfRestoreCmd,
  "tmp-purge": tmpPurgeCmd,
  "rb-fix-paths": rbFixPathsCmd,
  "rb-unmatched": rbUnmatchedCmd,
  "rb-adopt": rbAdoptCmd,
  "rb-import": rbImportCmd,
  "rb-playlist": rbPlaylistCmd,
  "rb-cues": rbCuesCmd,
  "rb-dedup": rbDedupCmd,
  "rb-comment-sync": rbCommentSyncCmd,
  "rb-anlz-spike": rbAnlzSpikeCmd,
  "rb-grid-triage": rbGridTriageCmd,
};

/** Thin runner: table lookup + delegate (the old CCN-67 switch). */
export async function runMaintenanceCommand(
  command: string,
  rest: string[],
): Promise<void> {
  const handler = MAINTENANCE_COMMANDS[command as MaintenanceVerb];
  if (!handler) return;
  await handler(rest);
}
