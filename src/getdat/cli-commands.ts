// cli-commands.ts — the getdat-family verb handlers for the megadj CLI
// (#243: moved from src/cli-commands-core.ts — product command bodies
// live in their domain dirs; src/ root keeps host-kit + census only).
//
// doctor/init ride here too: they are the toolkit's lifecycle commands
// (registry group "cratedeck") with no domain of their own, and their
// arms keep doctor's probes LAZY (dynamic import) so a plain
// `megadj status` never pays the diagnostics module graph at boot.
//
// Flags go through cli-flags.ts (`parseFlags`/`nonNegOpt`/
// `nonNegOptInvalid`/`firstPositional`) — the sanctioned parser; bad
// numeric input = json-safe exit 2, zero work.
import type { OrganizeOptions } from "./commands/organize";
import { sync } from "./commands/sync";
import { RateLimiter } from "./ratelimit";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
} from "../cli-flags";
import type { CliCommandHandler } from "../cli-dispatch";
import { listJson, listTracks, status, statusJson } from "../shared/status";
import {
  writeJson,
  writeJsonText,
  finishCommandError,
  setExit,
} from "../shared/cli-output";

const doctor: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { runDoctor, printDoctor, doctorJson } =
    await import("../shared/doctor");
  // The deck-service check is async (launchctl + an HTTP probe) — run it
  // alongside the sync checks and append so both output formats carry it.
  const { checkDeckService } = await import("../shared/doctor-checks");
  const [results, deckCheck] = await Promise.all([
    Promise.resolve(runDoctor()),
    checkDeckService(),
  ]);
  results.push(deckCheck);
  if (flags.bools.has("json")) {
    await writeJsonText(doctorJson(results));
    // #160 ring 3: setExit is the one mutation point.
    setExit(results.some((check) => !check.ok && check.required) ? 1 : 0);
  } else {
    setExit(printDoctor(results));
  }
};

const init: CliCommandHandler = async () => {
  const { runInit } = await import("../shared/doctor");
  setExit(runInit());
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
  if (nonNegOptInvalid(flags, "limit", "sync", flags.bools.has("json"))) return;
  const limit = nonNegOpt(flags, "limit", "sync", flags.bools.has("json"));
  if (nonNegOptInvalid(flags, "target-total", "sync", flags.bools.has("json")))
    return;
  const targetTotal = nonNegOpt(
    flags,
    "target-total",
    "sync",
    flags.bools.has("json"),
  );

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
        ? "./commands/organize"
        : "../fulltags/fetch/enrich"
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
    await import("./commands/adopt");
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
  const folder =
    firstPositional(rest, "ingest", ["ingest", "folder", "min-duration"]) ??
    flags.strings.get("folder");
  if (!folder) {
    await finishCommandError({
      command: "ingest",
      json: flags.bools.has("json"),
      error: "pass a folder — megadj ingest <folder> [--dry-run]",
      exitCode: 2,
    });
    return;
  }
  // nonNegOpt is the sanctioned numeric seam: negative/empty/non-numeric
  // input = json-safe exit-2 epilogue, zero work. The hand-rolled
  // Number()+isFinite pair let "-30" and "" slip through as 0 (and a
  // bare Number("-30") is finite, so the old guard never fired).
  if (
    nonNegOptInvalid(flags, "min-duration", "ingest", flags.bools.has("json"))
  )
    return;
  const minDuration = nonNegOpt(
    flags,
    "min-duration",
    "ingest",
    flags.bools.has("json"),
  );
  const { ingest: ingestFolder } = await import("./commands/ingest");
  await ingestFolder({
    state,
    musicDir,
    folder,
    dryRun: flags.bools.has("dry-run"),
    noArtwork: flags.bools.has("no-artwork"),
    minDuration,
    json: flags.bools.has("json"),
  });
};

const upgrade: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(rest, ["limit"], ["dry-run", "json"]);
  if (nonNegOptInvalid(flags, "limit", "upgrade", flags.bools.has("json")))
    return;
  const limit = nonNegOpt(flags, "limit", "upgrade", flags.bools.has("json"));
  const { upgrade: upgradeTracks } = await import("./commands/upgrade");
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

export const GETDAT_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
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
