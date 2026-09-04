#!/usr/bin/env bun
import { ArchiveState } from "./state";
import { RateLimiter } from "./ratelimit";
import { sync } from "./commands/sync";
import { status, listTracks } from "./commands/status";

const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/YTMusic-Liked`;
const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
const COOKIES = process.env.MEGADJ_COOKIES ?? "chrome";
const COOKIES_FILE = process.env.MEGADJ_COOKIES_FILE ?? null;

function printHelp(): void {
  console.log(`megadj — YouTube Music library archiver for rekordbox

usage:
  megadj sync    [--limit N] [--dry-run] [--music-only] [--target-total N] [--sources LM,LL,PLxxxx]
  megadj enrich  [--dry-run]                   fill weak genres via MusicBrainz
  megadj ingest  <folder> [--dry-run] [--no-artwork] [--min-duration N]
                                             tag + artwork external downloads
  megadj artwork                              process queued artwork via image-maker
  megadj organize [--dry-run]                   move downloads into genre folders
  megadj status                              archive summary + recent runs
  megadj list    [filter]                    list tracks (by status or text)
  megadj retry                                retry failed tracks
  megadj adopt                                register existing files in the DB
  megadj help                                this help

environment:
  MEGADJ_MUSIC_DIR   target folder (default ~/Music/YTMusic-Liked)
  MEGADJ_DB          state db path (default ~/.local/state/megadj/archive.db)
  MEGADJ_COOKIES     browser for cookies (default chrome, empty to disable)`);
}

/** Bun's util.parseArgs is broken (strict:true rejects known options,
 *  strict:false coerces string values to true), so parse manually. */
interface ParsedFlags {
  strings: Map<string, string>;
  bools: Set<string>;
}

function parseFlags(
  args: string[],
  stringOpts: string[],
  boolOpts: string[],
): ParsedFlags {
  const strings = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--") break;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      if (boolOpts.includes(key)) {
        if (val !== "true" && val !== "false") continue;
        if (val === "true") bools.add(key);
      } else {
        strings.set(key, val);
      }
      continue;
    }
    const key = arg.slice(2);
    if (boolOpts.includes(key)) {
      bools.add(key);
    } else if (stringOpts.includes(key)) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        strings.set(key, next);
        i++;
      }
    }
  }
  return { strings, bools };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith("--")) ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const state = new ArchiveState(DB_PATH);

  try {
    switch (command) {
      case "sync": {
        const flags = parseFlags(
          process.argv.slice(3),
          ["limit", "sources", "target-total"],
          ["dry-run", "music-only"],
        );
        const limiter = new RateLimiter({
          onPace: (ms) =>
            process.stderr.write(`  (pacing ${Math.round(ms / 100) / 10}s)\n`),
          onBackoff: (attempt, ms, reason) =>
            process.stderr.write(
              `  (backoff #${attempt}: ${(ms / 1000).toFixed(1)}s — ${reason.slice(0, 60)})\n`,
            ),
        });
        const limitRaw = flags.strings.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const dryRun = flags.bools.has("dry-run");
        const musicOnly = flags.bools.has("music-only");
        const targetRaw = flags.strings.get("target-total");
        const targetTotal = targetRaw ? Number(targetRaw) : undefined;
        const sourcesStr = flags.strings.get("sources") ?? "LM";
        const sources = sourcesStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((id) => ({
            id,
            label: id === "LM" ? "liked" : id === "LL" ? "liked-videos" : id,
          }));
        await sync({
          state,
          limiter,
          musicDir: MUSIC_DIR,
          cookiesFromBrowser: COOKIES || null,
          cookiesFile: COOKIES_FILE,
          limit,
          dryRun,
          musicOnly,
          targetTotal,
          sources,
        });
        break;
      }
      case "status": {
        status(state);
        break;
      }
      case "list": {
        const filter = process.argv.slice(3).find((a) => !a.startsWith("--"));
        listTracks(state, filter);
        break;
      }
      case "retry": {
        // Failed tracks with attempts < 5 are already picked up by sync;
        // this resets the ladder for everything failed.
        state.resetFailures();
        console.log("failure counters reset — run `megadj sync` to retry");
        break;
      }
      case "adopt": {
        const { adopt } = await import("./commands/adopt");
        await adopt({ state, musicDir: MUSIC_DIR });
        break;
      }
      case "organize": {
        const flags = parseFlags(process.argv.slice(3), [], ["dry-run"]);
        const { organize } = await import("./commands/organize");
        await organize({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
        });
        break;
      }
      case "enrich": {
        const flags = parseFlags(process.argv.slice(3), [], ["dry-run"]);
        const { enrich } = await import("./commands/enrich");
        await enrich({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
        });
        break;
      }
      case "ingest": {
        const flags = parseFlags(
          process.argv.slice(3),
          ["ingest", "folder"],
          ["dry-run", "no-artwork"],
        );
        const folder =
          flags.strings.get("folder") ??
          process.argv
            .slice(3)
            .find((a) => !a.startsWith("--") && a !== "ingest");
        if (!folder) {
          console.error(
            "ingest: pass a folder — megadj ingest <folder> [--dry-run]",
          );
          process.exitCode = 1;
          break;
        }
        const { ingest } = await import("./commands/ingest");
        await ingest({
          state,
          musicDir: MUSIC_DIR,
          folder,
          dryRun: flags.bools.has("dry-run"),
          noArtwork: flags.bools.has("no-artwork"),
          minDuration: flags.strings.get("min-duration")
            ? Number(flags.strings.get("min-duration"))
            : undefined,
        });
        break;
      }
      case "artwork": {
        const { artwork } = await import("./commands/artwork");
        await artwork({ state });
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
