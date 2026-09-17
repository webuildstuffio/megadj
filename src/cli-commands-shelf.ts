import type { CliCommandHandler } from "./cli-command";
import { parseFlags } from "./cli-flags";
import { writeJson, setExit } from "./shared/cli-output";
import {
  runShelfArchive,
  runShelfSweeps,
  runShelfSync,
} from "./shelf/cli-cmds";

const shelfSync: CliCommandHandler = async (rest) => {
  await runShelfSync(rest);
};

const shelfArchive: CliCommandHandler = async (rest) => {
  await runShelfArchive(rest);
};

const shelfDedupe: CliCommandHandler = async (rest) => {
  const { shelfDedupe: dedupe } = await import("./shelf/dedupe");
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
  const { shelfDupescan: scan } = await import("./shelf/dupescan");
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
  const { convertArchive } = await import("./fulltags/convert");
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
  const { dedupeArchive: dedupe } = await import("./shelf/dedupe-archive");
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

export const SHELF_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  "shelf-sync": shelfSync,
  "shelf-archive": shelfArchive,
  "shelf-dedupe": shelfDedupe,
  "shelf-dupescan": shelfDupescan,
  "shelf-sweeps": shelfSweeps,
  convert,
  "dedupe-archive": dedupeArchive,
};
