// cli-commands.ts — the rekordbox-family verb handlers for the megadj CLI
// (#235: the ten rb-* arms moved here from the dissolved
// src/shared/maintenance-cmds.ts grab-bag — rekordbox repair verbs
// finally have a home file; flag parsing stays on the sanctioned
// cli-flags seam, all logic in the ../rekordbox/* modules).
import type { CliCommandHandler } from "../cli-dispatch";
import {
  manyOf,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
  positionalArgs,
} from "../cli-flags";
import {
  emitResult,
  finishCommandError,
  jsonFlag,
  jsonOpts,
  setExit,
} from "../shared/cli-output";
import { configuredMasterDrive, mountFrom } from "../shared/volume";
import { DB_PATH } from "../cli-env";
import { ArchiveState } from "../archive/state";
import type { AnlzBeat, AnlzSpikeMode } from "./anlz-spike";
import { errMessage as errorText } from "../shared/leaf/fmt";

const rbFixPathsCmd: CliCommandHandler = async (rest) => {
  // rekordbox library repair: stale djmdContent.FolderPath rows after
  // folder moves/merges. Dry-run by default; --apply --yes rewrites
  // rows (backs the DB up first, refuses while rekordbox runs).
  const flags = parseFlags(rest, [], ["json", "apply", "yes"]);
  const mount = mountFrom(positionalArgs(rest, [])[0]);
  const { rbFixPaths, printRbFixReport } = await import("./rb-fix-paths");
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

const rbUnmatchedCmd: CliCommandHandler = async (rest) => {
  // disk→DB reconcile half: audio files NO rekordbox row references.
  // Read-only census by default; --quarantine --yes moves the unknown
  // set to the shelf quarantine (never deletes, manifest kept). Safe
  // while rekordbox runs — only row-less files move.
  const flags = parseFlags(rest, ["ext"], ["json", "quarantine", "yes"]);
  const mount = mountFrom(positionalArgs(rest, ["ext"])[0]);
  const { rbUnmatched, printRbUnmatchedReport } =
    await import("./rb-unmatched");
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

const rbAdoptCmd: CliCommandHandler = async (rest) => {
  // Collection census → archive cross-reference. This reads every
  // master Content row but writes archive.db only: exact Rekordbox IDs
  // live in rekordbox_content while source/YouTube IDs remain intact.
  const flags = parseFlags(rest, [], ["json", "apply", "yes"]);
  const mount = mountFrom(positionalArgs(rest, [])[0]);
  const json = jsonFlag(flags);
  const state = new ArchiveState(DB_PATH);
  try {
    const { rbAdopt, printRbAdoptReport } = await import("./rb-adopt");
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

const rbImportCmd: CliCommandHandler = async (rest) => {
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
  const { rbImport, printRbImportReport } = await import("./rb-import");
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

const rbCuesCmd: CliCommandHandler = async (rest) => {
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
  const { rbCues, printRbCuesReport } = await import("./rb-cues");
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

const rbDedupCmd: CliCommandHandler = async (rest) => {
  // F2 (BUG-2): fingerprint-ish dupe sweep over master.db. Report
  // default; --apply --yes retires loser rows + quarantines files.
  const flags = parseFlags(rest, [], ["report", "apply", "yes", "json"]);
  const args = positionalArgs(rest, []);
  const mount = mountFrom(args[0]);
  const { rbDedup, printRbDedupReport } = await import("./rb-dedup");
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

const rbCommentSyncCmd: CliCommandHandler = async (rest) => {
  // fulltags → RB comment backfill: file TXXX (CAMELOT/ENERGY/MOOD)
  // + archive.db mood ledger → Commnt in FullTags format. Never
  // clobbers a non-empty comment. Dry-run default.
  const flags = parseFlags(rest, ["batch"], ["apply", "yes", "json"]);
  const args = positionalArgs(rest, ["batch"]);
  const mount = mountFrom(args[0]);
  const { rbCommentSync, printRbCommentSyncReport } =
    await import("./rb-comment-sync");
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

const rbPlaylistCmd: CliCommandHandler = async (rest) => {
  // `megadj rb-playlist reconcile` — XML-twin healer (F7): diff
  // djmdPlaylist rows vs masterPlaylists6.xml NODEs; apply adds
  // missing NODEs. Anything else = the set-builder chain writer.
  const restArgs = rest.filter((a) => a !== "reconcile");
  if (rest.length !== restArgs.length) {
    const flags = parseFlags(restArgs, [], ["apply", "yes", "json"]);
    const args = positionalArgs(restArgs, []);
    const mount = mountFrom(args[0]);
    const { rbPlaylistReconcile, printReconcileReport } =
      await import("./rb-playlist-reconcile");
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
  const { rbPlaylist, printRbPlaylistReport } = await import("./rb-playlist");
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

/** Type guard for one --beats row: {num:1..4, bpmx100:int>0, timeMs:int>=0}. */
function isBeatRow(b: unknown): boolean {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  return (
    typeof r.num === "number" &&
    Number.isInteger(r.num) &&
    r.num >= 1 &&
    r.num <= 4 &&
    typeof r.bpmx100 === "number" &&
    Number.isInteger(r.bpmx100) &&
    r.bpmx100 > 0 &&
    typeof r.timeMs === "number" &&
    Number.isInteger(r.timeMs) &&
    r.timeMs >= 0
  );
}

const rbAnlzSpikeCmd: CliCommandHandler = async (rest) => {
  // GA-07 harness: snapshot/compare ANLZ sidecars around a manual
  // rekordbox experiment (re-export, grid nudge), plus set-grid —
  // Q4's direct PQTZ rewrite (dry-run by default; --apply --yes writes
  // with an automatic pre-edit backup + whole-file re-verify). The
  // baseline lives in ~/.local/state/megadj/spike/.
  const flags = parseFlags(
    rest,
    ["tag", "file", "beats"],
    ["json", "apply", "yes"],
  );
  // Two positionals: mount (first) + mode word (snapshot|compare|set-grid).
  // Order-free per usage: `[drive] snapshot|compare|set-grid`.
  const args = positionalArgs(rest, ["tag", "file", "beats"]);
  const modeWord = args.find(
    (a) => a === "snapshot" || a === "compare" || a === "set-grid",
  );
  const mountPos = args.find(
    (a) => a !== "snapshot" && a !== "compare" && a !== "set-grid",
  );
  const mode: AnlzSpikeMode =
    modeWord === "compare"
      ? "compare"
      : modeWord === "set-grid"
        ? "set-grid"
        : "snapshot";
  if (
    args.some(
      (a) =>
        a !== "snapshot" &&
        a !== "compare" &&
        a !== "set-grid" &&
        a !== mountPos,
    )
  ) {
    await finishCommandError({
      command: "rb-anlz-spike",
      error: "too many arguments (usage: [drive] snapshot|compare|set-grid)",
      exitCode: 2,
    });
    return;
  }
  if (modeWord === undefined) {
    await finishCommandError({
      command: "rb-anlz-spike",
      error: "mode is required (snapshot|compare|set-grid)",
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
  const { anlzSpike, printSpikeReport } = await import("./anlz-spike");

  // set-grid: the beats JSON must parse BEFORE anything touches the
  // drive — bad JSON is exit 2 with zero work (the nonNegOpt contract).
  // Guarded parse: a malformed --beats is a usage error, not a crash.
  let beats: AnlzBeat[] | undefined;
  const beatsRaw = flags.strings.get("beats");
  if (mode === "set-grid" && beatsRaw !== undefined) {
    // the console.error is the census's visible-failure shape (boundary-
    // json guard) AND the honest UX: the user sees WHY their beats JSON
    // was rejected, on stderr, before the exit-2 usage error.
    let parseFailed = false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(beatsRaw) as unknown;
    } catch (e) {
      console.error(`rb-anlz-spike: malformed --beats JSON: ${errorText(e)}`);
      parseFailed = true;
    }
    if (
      parseFailed ||
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every(isBeatRow)
    ) {
      await finishCommandError({
        command: "rb-anlz-spike",
        error:
          "--beats must be a JSON array of {num:1..4, bpmx100:int, timeMs:int} rows",
        exitCode: 2,
      });
      return;
    }
    beats = parsed as AnlzBeat[];
  }

  const file = flags.strings.get("file");
  const r = anlzSpike({
    mount,
    tag,
    mode,
    ...(file !== undefined ? { file } : {}),
    ...(beats !== undefined ? { beats } : {}),
    apply: flags.bools.has("apply") && flags.bools.has("yes"),
    ...jsonOpts(json),
  });
  await emitResult(json, r, printSpikeReport);
  if (!r.ok) setExit(1);
};

const rbGridTriageCmd: CliCommandHandler = async (rest) => {
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
    const { gridTriage, printGridTriageReport } = await import("./grid-triage");
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

export const REKORDBOX_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  "rb-fix-paths": rbFixPathsCmd,
  "rb-unmatched": rbUnmatchedCmd,
  "rb-adopt": rbAdoptCmd,
  "rb-import": rbImportCmd,
  "rb-cues": rbCuesCmd,
  "rb-dedup": rbDedupCmd,
  "rb-comment-sync": rbCommentSyncCmd,
  "rb-playlist": rbPlaylistCmd,
  "rb-anlz-spike": rbAnlzSpikeCmd,
  "rb-grid-triage": rbGridTriageCmd,
};
