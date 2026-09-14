import type { OrganizeOptions } from "./getdat/commands/organize";
import { sync } from "./getdat/commands/sync";
import { RateLimiter } from "./getdat/ratelimit";
import { firstPositional, nonNegOpt, parseFlags } from "./cli-flags";
import type { CliCommandHandler } from "./cli-command";
import { listJson, listTracks, status, statusJson } from "./shared/status";
import { writeJson, writeJsonText } from "./shared/cli-output";

const doctor: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { runDoctor, printDoctor, doctorJson } =
    await import("./shared/doctor");
  const results = runDoctor();
  if (flags.bools.has("json")) {
    await writeJsonText(doctorJson(results));
    process.exitCode = results.some((check) => !check.ok && check.required)
      ? 1
      : 0;
  } else {
    process.exitCode = printDoctor(results);
  }
};

const init: CliCommandHandler = async () => {
  const { runInit } = await import("./shared/doctor");
  process.exitCode = runInit();
};

const syncCommand: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(
    rest,
    ["limit", "sources", "target-total"],
    ["dry-run", "music-only", "json"],
  );
  const limiter = new RateLimiter({
    onPace: (ms) =>
      process.stderr.write(`  (pacing ${Math.round(ms / 100) / 10}s)\n`),
    onBackoff: (attempt, ms, reason) =>
      process.stderr.write(
        `  (backoff #${attempt}: ${(ms / 1000).toFixed(1)}s — ${reason.slice(0, 60)})\n`,
      ),
  });
  const limit = nonNegOpt(flags, "limit", "sync");
  if (limit === undefined && flags.strings.get("limit") !== undefined) return;
  const targetTotal = nonNegOpt(flags, "target-total", "sync");
  if (
    targetTotal === undefined &&
    flags.strings.get("target-total") !== undefined
  )
    return;

  const sources = (flags.strings.get("sources") ?? "LM")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      label: id === "LM" ? "liked" : id === "LL" ? "liked-videos" : id,
    }));
  await sync({
    state: context.state,
    limiter,
    musicDir: context.musicDir,
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
    limit,
    dryRun: flags.bools.has("dry-run"),
    musicOnly: flags.bools.has("music-only"),
    targetTotal,
    sources,
    json: flags.bools.has("json"),
  });
};

const statusCommand: CliCommandHandler = async (rest, { state }) => {
  if (rest.includes("--json")) await statusJson(state);
  else status(state);
};

const list: CliCommandHandler = async (rest, { state }) => {
  const filter = rest.find((arg) => !arg.startsWith("--"));
  if (rest.includes("--json")) await listJson(state, filter);
  else listTracks(state, filter);
};

const retry: CliCommandHandler = async (rest, { state }) => {
  state.resetFailures();
  if (rest.includes("--json")) {
    await writeJson({ command: "retry", reset: true });
  } else {
    console.log("failure counters reset — run `megadj sync` to retry");
  }
};

const organizeOrEnrich =
  (command: "organize" | "enrich"): CliCommandHandler =>
  async (rest, { state, musicDir }) => {
    const flags = parseFlags(rest, [], ["dry-run", "json"]);
    const mod: Record<
      "organize" | "enrich",
      (options: OrganizeOptions) => Promise<void>
    > = await import(
      command === "organize"
        ? "./getdat/commands/organize"
        : "./fulltags/enrich"
    );
    await mod[command]({
      state,
      musicDir,
      dryRun: flags.bools.has("dry-run"),
      json: flags.bools.has("json"),
    });
  };

const adopt: CliCommandHandler = async (rest, { state, musicDir }) => {
  const { adopt: adoptLocal, adoptFromShelf } =
    await import("./getdat/commands/adopt");
  const json = rest.includes("--json");
  if (rest.includes("--shelf")) {
    await adoptFromShelf({
      state,
      musicDir,
      json,
      shelf: true,
      dryRun: !rest.includes("--apply"),
    });
    return;
  }
  await adoptLocal({ state, musicDir, json });
};

const ingest: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["ingest", "folder", "min-duration"],
    ["dry-run", "no-artwork", "json"],
  );
  const folder = firstPositional(rest, "ingest") ?? flags.strings.get("folder");
  if (!folder) {
    console.error("ingest: pass a folder — megadj ingest <folder> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const minDurationRaw = flags.strings.get("min-duration");
  const minDuration =
    minDurationRaw !== undefined ? Number(minDurationRaw) : Number.NaN;
  if (minDurationRaw !== undefined && !Number.isFinite(minDuration)) {
    console.error(
      `ingest: --min-duration must be a number of seconds (got "${minDurationRaw}")`,
    );
    process.exitCode = 1;
    return;
  }
  const { ingest: ingestFolder } = await import("./getdat/commands/ingest");
  await ingestFolder({
    state,
    musicDir,
    folder,
    dryRun: flags.bools.has("dry-run"),
    noArtwork: flags.bools.has("no-artwork"),
    minDuration: minDurationRaw !== undefined ? minDuration : undefined,
    json: flags.bools.has("json"),
  });
};

const upgrade: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(rest, ["limit"], ["dry-run", "json"]);
  const limit = nonNegOpt(flags, "limit", "upgrade");
  if (limit === undefined && flags.strings.get("limit") !== undefined) return;
  const { upgrade: upgradeTracks } = await import("./getdat/commands/upgrade");
  await upgradeTracks({
    state: context.state,
    musicDir: context.musicDir,
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
    limit,
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

export const CORE_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  doctor,
  init,
  sync: syncCommand,
  status: statusCommand,
  list,
  retry,
  organize: organizeOrEnrich("organize"),
  enrich: organizeOrEnrich("enrich"),
  adopt,
  ingest,
  upgrade,
};
