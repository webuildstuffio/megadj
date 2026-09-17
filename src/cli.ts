#!/usr/bin/env bun
import { ArchiveState } from "./archive/state";
import { COOKIES, COOKIES_FILE, DB_PATH, MUSIC_DIR } from "./cli-env";
export { COOKIES, COOKIES_FILE, DB_PATH, MUSIC_DIR } from "./cli-env";
import { dispatchCommand } from "./cli-dispatch";
import { drainStdout, finishCommandError } from "./shared/cli-output";
import {
  MAINTENANCE_VERBS,
  runMaintenanceCommand,
} from "./shared/maintenance-cmds";
import { printHelp as printHelpImpl } from "./usage";

export {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
  positionalArgs,
} from "./cli-flags";

/** macOS-only by design (Principle 2) — fail fast with the reason. */
function assertMac(): void {
  if (process.platform !== "darwin") {
    console.error(
      "megadj is macOS-only by design (docs/PRINCIPLES.md §2) — it drives rekordbox, Pioneer hardware, and macOS browser cookies.",
    );
    process.exit(2);
  }
}

function printHelp(): void {
  void printHelpImpl();
}

async function configureBoothFleet(): Promise<void> {
  try {
    const { loadConfig } = await import("../cratedeck/src/config");
    const config = loadConfig(
      process.env.CRATEDECK_ROOT ?? `${import.meta.dir}/../cratedeck`,
    );
    const environmentFleet = process.env.MEGADJ_FLEET?.split(",")
      .map((player) => player.trim())
      .filter(Boolean);
    const { setBoothFleet } = await import("./fulltags/player-compat");
    setBoothFleet(
      environmentFleet && environmentFleet.length > 0
        ? environmentFleet
        : config.boothFleet,
    );
  } catch (error) {
    console.error(
      `booth fleet: config.toml unreadable (${error instanceof Error ? error.message : String(error)}) — using default fleet`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((argument) => !argument.startsWith("--")) ?? "help";
  const rest = process.argv.slice(3);

  if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    argv.includes("--help") ||
    argv.includes("-h")
  ) {
    printHelp();
    return;
  }

  assertMac();
  await configureBoothFleet();

  const state = new ArchiveState(DB_PATH);
  try {
    if ((MAINTENANCE_VERBS as readonly string[]).includes(command)) {
      await runMaintenanceCommand(command, rest);
      return;
    }
    const handled = await dispatchCommand(command, rest, {
      state,
      musicDir: MUSIC_DIR,
      dbPath: DB_PATH,
      cookies: COOKIES,
      cookiesFile: COOKIES_FILE,
    });
    if (!handled) {
      // #160 ring 3: json-mode-safe unknown-command epilogue (was bare
      // stderr + raw exit-code write; the json channel stays clean).
      await finishCommandError({
        command,
        json: rest.includes("--json"),
        error: `unknown command: ${command} — try \`megadj --help\``,
        exitCode: 1,
      });
    }
  } finally {
    state.close();
  }
}

await main();
await drainStdout();
