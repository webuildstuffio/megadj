import type { CliCommandHandler } from "./cli-command";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  numOpt,
  parseFlags,
} from "./cli-flags";
import { writeJson } from "./shared/cli-output";
import { FETCH_TARGETS, type FetchTarget } from "./fulltags/fetch-target";

const boothFix: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["booth-fix"],
    ["apply", "yes", "dry-run", "json"],
  );
  const { boothFix: fix } = await import("./fulltags/booth-fix");
  const report = await fix({
    state,
    musicDir,
    dryRun: flags.bools.has("dry-run"),
    apply: flags.bools.has("apply") && flags.bools.has("yes"),
    json: flags.bools.has("json"),
    log: (message) => void console.log(message),
  });
  if (flags.bools.has("json")) {
    await writeJson(report);
    return;
  }

  console.log(
    `booth-fix: ${report.checked} checked, ${report.fixable} fixable, ${report.applied} applied (fleet: ${report.fleet.join(", ")})`,
  );
  for (const row of report.rows) {
    console.log(`  [${row.gate}: ${row.reasons.join(",")}] ${row.plan}`);
    console.log(`    ${row.file}`);
  }
  if (report.rows.some((row) => row.action === "none")) process.exitCode = 1;
};

const drop: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(
    rest,
    ["drop", "target", "max-beat-seconds"],
    ["dry-run", "no-mood", "no-fetch", "ai-fallback", "json"],
  );
  if (nonNegOptInvalid(flags, "max-beat-seconds")) return;
  const maxBeatSeconds = nonNegOpt(flags, "max-beat-seconds", "drop");
  const target = firstPositional(rest, "drop") ?? flags.strings.get("target");
  if (!target) {
    console.error(
      "drop: pass a folder or URL — megadj drop <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback]",
    );
    process.exitCode = 1;
    return;
  }
  const { drop: dropTarget } = await import("./shared/drop");
  await dropTarget({
    state: context.state,
    musicDir: context.musicDir,
    target,
    dryRun: flags.bools.has("dry-run"),
    noMood: flags.bools.has("no-mood"),
    noFetch: flags.bools.has("no-fetch"),
    aiFallback: flags.bools.has("ai-fallback"),
    maxBeatSeconds,
    json: flags.bools.has("json"),
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
  });
};

const artwork: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["model", "max"], ["dry-run", "json"]);
  const { artwork: addArtwork } = await import("./fulltags/artwork");
  await addArtwork({
    state,
    model: flags.strings.get("model"),
    maxImages: numOpt(flags, "max"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const fetchCommand: CliCommandHandler = async (rest) => {
  const flags = parseFlags(
    rest,
    ["jobs"],
    ["art", "genres", "tags", "years", "all", "ai-fallback", "dry-run", "json"],
  );
  if (nonNegOptInvalid(flags, "jobs")) return;
  const jobs = nonNegOpt(flags, "jobs", "fetch");
  const { fetch } = await import("./fulltags/fetch");
  const only: FetchTarget =
    FETCH_TARGETS.find(
      (target) => target !== "all" && flags.bools.has(target),
    ) ?? "all";
  await fetch({
    all: flags.bools.has("all"),
    only,
    jobs,
    aiFallback: flags.bools.has("ai-fallback"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const audit: CliCommandHandler = async (rest, { musicDir }) => {
  const { auditArchive } = await import("./fulltags/fetch");
  const { auditRowFlags } = await import("./fulltags/audit-row");
  const report = await auditArchive(musicDir);
  const gaps = report.rows.filter((row) => !row.complete);
  const unplayable = gaps.filter((row) => !row.playable);
  const unreadable = gaps.filter((row) => !row.readable);
  if (rest.includes("--json")) {
    await writeJson({
      ok: gaps.length === 0,
      total: report.total,
      complete: report.complete,
      unplayable: unplayable.map((row) => row.file),
      unreadable: unreadable.map((row) => ({
        file: row.file,
        reasons: row.unreadableReasons,
      })),
      incomplete: gaps.map((row) => ({
        file: row.file,
        missing: auditRowFlags(row),
      })),
    });
    if (gaps.length) process.exitCode = 1;
    return;
  }

  const dimensions =
    "art + title + artist + album + genre + year + mood + energy + player-compat + booth-text";
  console.log(
    `audit: ${report.complete}/${report.total} complete (${dimensions})`,
  );
  if (gaps.length) {
    console.log("\nincomplete:");
    for (const row of gaps)
      console.log(`  [${auditRowFlags(row)}] ${row.file}`);
    process.exitCode = 1;
  } else {
    console.log("✅ all tracks fully tagged + booth-playable");
  }
};

const tagCheck: CliCommandHandler = async (rest, { musicDir }) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { walkAudioFiles, tagHealth } = await import("../fulltags/src/exports");
  const files = walkAudioFiles(musicDir);
  const bad: { file: string; reasons: string[] }[] = [];
  for (const file of files) {
    const health = tagHealth(file);
    if (!health.ok) bad.push({ file, reasons: health.reasons });
  }
  if (flags.bools.has("json")) {
    console.log(
      JSON.stringify(
        { ok: bad.length === 0, checked: files.length, bad },
        null,
        2,
      ),
    );
  } else if (bad.length === 0) {
    console.log(
      `✅ tag-check: all ${files.length} files' tags parse clean (structure, text, booth display)`,
    );
  } else {
    console.log(
      `tag-check: ${bad.length} of ${files.length} files have broken/suspect tags:`,
    );
    for (const row of bad)
      console.log(`  [${row.reasons.join(", ")}] ${row.file}`);
    console.log(
      "\nwhat these mean: no-title-artist = identity frames empty; mojibake-* = double-encoded text (fix the spelling and re-stamp); control-bytes-* = invisible junk in frame text; booth-text:* = garbles on a CDJ/XDJ display (see `megadj booth-fix --dry-run`).",
    );
  }
  if (bad.length) process.exitCode = 1;
};

const years: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, [], ["dry-run", "json"]);
  const { runFixYears } = await import("./fulltags/years");
  await runFixYears({
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

export const TAG_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  "booth-fix": boothFix,
  drop,
  artwork,
  fetch: fetchCommand,
  audit,
  "tag-check": tagCheck,
  years,
};
