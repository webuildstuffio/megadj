// cli-commands.ts — the shelf-family verb handlers for the megadj CLI
// (#243: moved from src/cli-commands-shelf.ts — product command bodies
// live in their domain dirs; src/ root keeps host-kit + census only).
// (#235: the shelf-hygiene/restore, intake-status and tmp-purge arms
// joined from the dissolved maintenance-cmds grab-bag — shelf verbs
// live in the shelf domain, whatever their registry group label.)
import type { CliCommandHandler } from "../cli-dispatch";
import { manyOf, parseFlags, positionalArgs } from "../cli-flags";
import {
  emitResult,
  finishCommandError,
  jsonFlag,
  jsonOpts,
  progressLog,
  setExit,
  writeJson,
} from "../shared/cli-output";
import { mountFrom, volumePath } from "../shared/volume";
import { DB_PATH, MUSIC_DIR } from "../cli-env";
import { ArchiveState } from "../core/state";
import { runShelfArchive, runShelfSweeps, runShelfSync } from "./cli-cmds";

const shelfSync: CliCommandHandler = async (rest) => {
  await runShelfSync(rest);
};

const shelfArchive: CliCommandHandler = async (rest) => {
  await runShelfArchive(rest);
};

const shelfDedupe: CliCommandHandler = async (rest) => {
  const { shelfDedupe: dedupe } = await import("./dedupe");
  await dedupe({
    apply: rest.includes("--apply"),
    yes: rest.includes("--yes"),
    json: rest.includes("--json"),
  });
};

const shelfDupescan: CliCommandHandler = async (rest) => {
  const scanDirs: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--scan-dir") {
      const value = rest[index + 1];
      if (value) scanDirs.push(value);
    }
  }
  const { shelfDupescan: scan } = await import("./dupescan");
  await scan({
    json: rest.includes("--json"),
    quarantine: rest.includes("--quarantine"),
    yes: rest.includes("--yes"),
    onlyIdentical: rest.includes("--only-identical"),
    scanDirs,
  });
};

const shelfSweeps: CliCommandHandler = async (rest) => {
  await runShelfSweeps(rest);
};

const convert: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["convert"],
    ["dry-run", "no-artwork", "json"],
  );
  const { convertArchive } = await import("../fulltags/write/convert");
  const report = await convertArchive({
    state,
    musicDir,
    dryRun: flags.bools.has("dry-run"),
    noArtwork: flags.bools.has("no-artwork"),
    json: flags.bools.has("json"),
  });
  if (flags.bools.has("json")) {
    await writeJson(report);
    return;
  }

  console.log(
    `convert: ${report.converted}/${report.total} wav→aiff${
      report.artAdded ? `, ${report.artAdded} art embedded` : ""
    }${report.artQueued ? `, ${report.artQueued} art queued` : ""}${
      report.failed.length ? `, ${report.failed.length} FAILED (wavs kept)` : ""
    }`,
  );
  for (const failure of report.failed)
    console.log(`  ✗ ${failure.reason}: ${failure.file}`);
  for (const warning of report.hiresWarnings) console.log(`  ⚠ ${warning}`);
  // #160 ring 3: setExit is the one mutation point.
  if (report.failed.length) setExit(1);
};

const dedupeArchive: CliCommandHandler = async (rest, { musicDir, dbPath }) => {
  const flags = parseFlags(rest, ["dedupe-archive"], ["apply", "yes", "json"]);
  const { dedupeArchive: dedupe } = await import("./dedupe-archive");
  const report = await dedupe({
    musicDir,
    dbPath,
    apply: flags.bools.has("apply"),
    yes: flags.bools.has("yes"),
    json: flags.bools.has("json"),
  });
  if (flags.bools.has("json")) {
    await writeJson(report);
    return;
  }

  console.log(
    `dedupe-archive: ${report.groups.length} group(s), ${(report.redundantBytes / 1e9).toFixed(2)} GB redundant${
      report.applied
        ? ` — quarantined ${report.quarantined}, review ${report.skippedForReview}`
        : " (report only — add --apply --yes)"
    }`,
  );
  for (const error of report.errors) console.log(`  ✗ ${error}`);
  // #160 ring 3: setExit is the one mutation point.
  if (report.errors.length) setExit(1);
};

// ---- #235 arms from the dissolved maintenance-cmds grab-bag ---------------
// (shelf-restore merged with the #36 quarantine-family arm of the same
// verb — ONE arm, the #160/#238-contract version: json-safe usage
// epilogue + shelfVolume + emitResult seams.)

/** `megadj shelf-restore <finding-id|path> [--into F] [--json]` — the
 *  one-row undo (lives in restore.ts; the guard ladder is engine
 *  policy, this arm is parse + delegate + exit). */
const shelfRestoreCmd: CliCommandHandler = async (rest) => {
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
  const { shelfRestore } = await import("./restore");
  const r = await shelfRestore({
    input,
    into: flags.strings.get("into"),
    shelfVolume: mountFrom(undefined),
    dbPath: DB_PATH,
    ...jsonOpts(jsonFlag(flags)),
  });
  if (!r.ok) setExit(1);
};

const intakeStatusCmd: CliCommandHandler = async (rest) => {
  // #238 (postmortem F5): ONE reconciled census — files on disk ↔
  // archive.db rows under NFC+casefold (the case-variant path class
  // that ate 3 files can't read as a mismatch here). Optional master
  // leg degrades honestly when the drive is absent. Read-only.
  const flags = parseFlags(rest, [], ["json"]);
  const mountPos = positionalArgs(rest, [])[0];
  const mount = mountPos ? volumePath(mountPos) : undefined;
  const json = jsonFlag(flags);
  const state = new ArchiveState(DB_PATH);
  try {
    const { intakeStatus, printIntakeStatus } = await import("./intake-status");
    const r = intakeStatus({
      state,
      musicDir: MUSIC_DIR,
      driveMount: mount,
      json,
      log: progressLog(json),
    });
    await emitResult(json, r, printIntakeStatus);
    const drift =
      r.rowsMissingOnDisk > 0 ||
      r.filesWithoutDbRow > 0 ||
      r.caseCollisions.length > 0;
    if (drift) setExit(1);
  } finally {
    state.close();
  }
};

const shelfHygieneCmd: CliCommandHandler = async (rest) => {
  // Detect → ledger → review → apply → validate (the shelf-hygiene
  // feature, CLI half; the web queue lives in CrateDeck). Findings
  // live in the archive DB — the SSOT every surface reads.
  const flags = parseFlags(
    rest,
    ["kind", "shelf", "bucket"],
    ["json", "apply", "yes"],
  );
  const { shelfHygiene } = await import("./hygiene");
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

const tmpPurgeCmd: CliCommandHandler = async (rest) => {
  // #236: the stale-fixture sweep (cratedeck-hashcancel-* et al grew to
  // 16k dirs / 2.6 GB). Read-only by default; --apply deletes; --all
  // drops the 24h age gate (only when the test gate is known-quiet).
  // --state retargets the sweep at ~/.local/state/megadj: superseded
  // archive.db backups (newest lineage per stem kept), orphan SQLite
  // sidecars of DBs not open, age-gated spike/ artifacts.
  const flags = parseFlags(
    rest,
    [],
    ["apply", "all", "json", "state", "orphan-runs"],
  );
  const json = jsonFlag(flags);
  const { tmpPurge, printTmpPurgeReport } = await import("./tmp-purge");
  const r = tmpPurge({
    apply: flags.bools.has("apply"),
    all: flags.bools.has("all"),
    state: flags.bools.has("state"),
    orphanRuns: flags.bools.has("orphan-runs"),
    json,
    log: progressLog(json),
  });
  await emitResult(json, r, printTmpPurgeReport);
  if (!r.ok) setExit(1);
};

// ---- hygiene quarantine family (#35/#36, concurrent agent) — the four
// arms below belong to the SAME shelf domain ----------------------------
// shelf-restore lives ABOVE (merged with the #235 arm of the same verb).

/** `megadj shelf-restore-all [--into F] [--json]` — every applied
 *  finding's loser comes back; per-row failures report, never fatal. */
const shelfRestoreAllCmd: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, ["into"], ["json"]);
  const json = flags.bools.has("json");
  const { shelfRestoreAll } = await import("./restore");
  const r = await shelfRestoreAll({
    into: flags.strings.get("into"),
    dbPath: DB_PATH,
    json,
    // restore-all is quiet per-row: its ONE summary is the output
    log: () => undefined,
  });
  if (json) await writeJson(r);
  else {
    console.log(
      `shelf-restore-all: restored ${r.restored}, failed ${r.failed.length}`,
    );
    for (const f of r.failed) console.log(`  ✗ ${f.findingId}: ${f.error}`);
  }
  if (!r.ok) setExit(1);
};

/** `megadj shelf-quarantine [--shelf V] [--json]` — the N files / X GB
 *  census over recoverable copies. Read-only; drives the web panel. */
const shelfQuarantine: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, ["shelf"], ["json"]);
  const json = flags.bools.has("json");
  const { shelfQuarantineCensus } = await import("./quarantine");
  const r = await shelfQuarantineCensus({
    dbPath: DB_PATH,
    shelfVolume: flags.strings.get("shelf"),
  });
  if (json) await writeJson(r);
  else
    console.log(
      `quarantine: ${r.files} file(s), ${(r.bytes / 1e9).toFixed(2)} GB recoverable, ${r.stale} stale ledger row(s)`,
    );
};

/** `megadj shelf-quarantine-empty --shelf V --yes [--json]` — the
 *  guarded empty: engine lease, per-row errors report. */
const shelfQuarantineEmptyCmd: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, ["shelf"], ["json", "yes"]);
  const json = flags.bools.has("json");
  if (!flags.bools.has("yes")) {
    console.error(
      "shelf-quarantine-empty: pass --yes — this deletes the recoverable copies (the undo window closes)",
    );
    setExit(2);
    return;
  }
  const { shelfQuarantineEmpty } = await import("./quarantine");
  const r = await shelfQuarantineEmpty({
    dbPath: DB_PATH,
    shelfVolume: flags.strings.get("shelf"),
  });
  if (json) await writeJson(r);
  else {
    console.log(
      `quarantine-empty: deleted ${r.deleted} file(s), ${(r.bytes / 1e9).toFixed(2)} GB reclaimed, ${r.failed.length} failed`,
    );
    for (const f of r.failed) console.log(`  ✗ ${f}`);
  }
  if (!r.ok) setExit(1);
};

export const SHELF_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  "shelf-sync": shelfSync,
  "shelf-archive": shelfArchive,
  "shelf-dedupe": shelfDedupe,
  "shelf-dupescan": shelfDupescan,
  "shelf-sweeps": shelfSweeps,
  convert,
  "dedupe-archive": dedupeArchive,
  // #235 (from maintenance-cmds):
  "shelf-restore": shelfRestoreCmd,
  "intake-status": intakeStatusCmd,
  "shelf-hygiene": shelfHygieneCmd,
  "tmp-purge": tmpPurgeCmd,
  // #35/#36 (quarantine family):
  "shelf-restore-all": shelfRestoreAllCmd,
  "shelf-quarantine": shelfQuarantine,
  "shelf-quarantine-empty": shelfQuarantineEmptyCmd,
};
