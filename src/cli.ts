#!/usr/bin/env bun
import { parseArgs } from "util";
import { ArchiveState } from "./state";
import { RateLimiter } from "./ratelimit";
import { sync } from "./commands/sync";
import { status, listTracks } from "./commands/status";

const MUSIC_DIR = process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/YTMusic-Liked`;
const DB_PATH = process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
const COOKIES = process.env.MEGADJ_COOKIES ?? "chrome";

function printHelp(): void {
  console.log(`megadj — YouTube Music library archiver for rekordbox

usage:
  megadj sync    [--limit N] [--dry-run]   incremental download of new likes
  megadj status                              archive summary + recent runs
  megadj list    [filter]                    list tracks (by status or text)
  megadj retry                                retry failed tracks
  megadj help                                this help

environment:
  MEGADJ_MUSIC_DIR   target folder (default ~/Music/YTMusic-Liked)
  MEGADJ_DB          state db path (default ~/.local/state/megadj/archive.db)
  MEGADJ_COOKIES     browser for cookies (default chrome, empty to disable)`);
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
  });
  const command = positionals[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const state = new ArchiveState(DB_PATH);

  try {
    switch (command) {
      case "sync": {
        const flags = parseArgs({
          args: process.argv.slice(3),
          boolean: ["dry-run"],
          string: ["limit"],
          allowPositionals: true,
          strict: false,
        }) as { values: { limit?: string; "dry-run"?: boolean } };
        const limiter = new RateLimiter({
          onPace: (ms) => process.stderr.write(`  (pacing ${Math.round(ms / 100) / 10}s)\n`),
          onBackoff: (attempt, ms, reason) =>
            process.stderr.write(
              `  (backoff #${attempt}: ${(ms / 1000).toFixed(1)}s — ${reason.slice(0, 60)})\n`,
            ),
        });
        const limitRaw = flags.values.limit;
        const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;
        const dryRun = flags.values["dry-run"] === true;
        await sync({
          state,
          limiter,
          musicDir: MUSIC_DIR,
          cookiesFromBrowser: COOKIES || null,
          limit,
          dryRun,
        });
        break;
      }
      case "status": {
        status(state);
        break;
      }
      case "list": {
        listTracks(state, positionals[1]);
        break;
      }
      case "retry": {
        // Failed tracks with attempts < 5 are already picked up by sync;
        // this resets the ladder for everything failed.
        state.resetFailures();
        console.log("failure counters reset — run `megadj sync` to retry");
        break;
      }
      default:
        console.error(`unknown command: ${command}`);
        printHelp();
        process.exitCode = 1;
    }
  } finally {
    state.close();
  }
}

await main();
