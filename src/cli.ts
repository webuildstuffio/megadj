#!/usr/bin/env bun
import { ArchiveState } from "./state";
import { RateLimiter } from "./ratelimit";
import { sync } from "./commands/sync";
import { status, listTracks, statusJson, listJson } from "./commands/status";

const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/DJ-Imports`;
const DB_PATH =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;
const COOKIES = process.env.MEGADJ_COOKIES ?? "chrome";
const COOKIES_FILE = process.env.MEGADJ_COOKIES_FILE ?? null;

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
  console.log(`megadj — DJ library manager: acquire (GetDat), enrich (FullTags), drive it (CrateDeck)

getdat — pull every track from everywhere:
  megadj sync    [--limit N] [--dry-run] [--music-only] [--target-total N] [--sources LM,LL,PLxxxx] [--json]
                                               download from YouTube Music; resumable, rate-limited
  megadj status [--json]                       archive summary + recent runs
  megadj list    [filter] [--json]             list tracks (by status or text)
  megadj adopt   [--json]                      register existing files in the DB
  megadj retry   [--json]                      reset failure counters, then \`megadj sync\` to retry

fulltags — 100% accuracy, 100% coverage, zero manual labour:
  megadj ingest  <folder> [--dry-run] [--no-artwork] [--min-duration N] [--json]
                                               tag+art+dedupe downloads (zips too)
  megadj fetch   [--art|--genres|--tags|--years] [--all] [--jobs N] [--dry-run] [--json]
                                               enrichment pass: tags+genres+years+art
  megadj audit   [--json]                      ground-truth tag/art audit — exits 1 on any gap
  megadj years   [--dry-run] [--json]          verify years vs SC page/yt-dlp (kills AI 2023 guesses)
  megadj beats   [--limit N] [--jobs N] [--force] [--dry-run] [--json]
                                               beat_this → DB ledger (downbeats for cues/grid checks; no tag writes)
  megadj artwork [--model M] [--max N] [--dry-run] [--json]
                                               generate covers for queued tracks (last resort)
  megadj enrich  [--dry-run] [--json]          fill weak genres via MusicBrainz
  megadj organize [--dry-run] [--json]         move downloaded files into genre folders

cratedeck — the Crate: organize, sync & verify every DJ USB:
  megadj doctor  [--json]                      one-shot dependency/env/config diagnostics (exit 1 if broken)
  megadj init                                  first-run bootstrap: scaffold config.toml + doctor
  bun run deck                                 the dashboard: every drive, its health, its playlists
  bun run deckctl status | report | run | coverage | diff    agent/human CLI
  bun run mcp                                  same surface over MCP for AI agents

environment:
  MEGADJ_MUSIC_DIR      target folder (default ~/Music/DJ-Imports)
  MEGADJ_DB             state db path (default ~/.local/state/megadj/archive.db)
  MEGADJ_COOKIES        browser for cookies (default chrome, empty to disable)
  MEGADJ_COOKIES_FILE   exported cookie jar for headless runs (see scripts/export-cookies.sh)
  MEGADJ_ART_MAX        max AI covers per artwork pass (default 20)
  MEGADJ_ART_QUEUE      artwork queue path (default ~/.local/state/megadj/artwork-queue.jsonl)
  OPENROUTER_API_KEY    required for \`artwork\` + AI genre/year (load from keychain, never hardcode)

agents: every command takes --json (one summary object on stdout, exit code
still meaningful) — PRINCIPLES.md §1.`);
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

/** Numeric string option: `numOpt(flags, "jobs")` → number | undefined. */
function numOpt(flags: ParsedFlags, key: string): number | undefined {
  const raw = flags.strings.get(key);
  return raw ? Number(raw) || undefined : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith("--")) ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // `megadj <cmd> --help` documents, never executes — organize must not
  // move files because someone asked what it does.
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  assertMac();

  const state = new ArchiveState(DB_PATH);

  try {
    switch (command) {
      case "doctor": {
        const flags = parseFlags(process.argv.slice(3), [], ["json"]);
        const { runDoctor, printDoctor, doctorJson } =
          await import("./commands/doctor");
        const results = runDoctor();
        if (flags.bools.has("json")) {
          console.log(doctorJson(results));
          // --json keeps the same contract as text mode: exit 1 if any
          // required check is broken (usable as a script/local gate —
          // there is no CI by principle; PRINCIPLES.md §1)
          process.exitCode = results.some((c) => !c.ok && c.required) ? 1 : 0;
        } else {
          process.exitCode = printDoctor(results);
        }
        break;
      }
      case "init": {
        const { runInit } = await import("./commands/doctor");
        process.exitCode = runInit();
        break;
      }
      case "sync": {
        const flags = parseFlags(
          process.argv.slice(3),
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
        // Numeric options must mean what they say: non-numeric or negative
        // input is an error, never "unlimited" (NaN is falsy and would skip
        // every guard — a typo like --limit abc or --target-total 10o must
        // not start an UNBOUNDED download run). 0 = attempt nothing.
        const intOpt = (key: string): { value?: number; error?: string } => {
          const raw = flags.strings.get(key);
          if (raw === undefined) return {};
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0)
            return {
              error: `sync: --${key} must be a whole number >= 0 (got "${raw}")`,
            };
          return { value: n };
        };
        const limit = intOpt("limit");
        if (limit.error) {
          console.error(limit.error);
          process.exitCode = 1;
          break;
        }
        const targetTotal = intOpt("target-total");
        if (targetTotal.error) {
          console.error(targetTotal.error);
          process.exitCode = 1;
          break;
        }
        const dryRun = flags.bools.has("dry-run");
        const musicOnly = flags.bools.has("music-only");
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
          limit: limit.value,
          dryRun,
          musicOnly,
          targetTotal: targetTotal.value,
          sources,
          json: flags.bools.has("json"),
        });
        break;
      }
      case "status": {
        const json = process.argv.slice(3).includes("--json");
        if (json) statusJson(state);
        else status(state);
        break;
      }
      case "list": {
        const rest = process.argv.slice(3);
        const filter = rest.find((a) => !a.startsWith("--"));
        if (rest.includes("--json")) {
          listJson(state, filter);
        } else {
          listTracks(state, filter);
        }
        break;
      }
      case "retry": {
        // Failed tracks with attempts < 5 are already picked up by sync;
        // this resets the ladder for everything failed.
        state.resetFailures();
        if (process.argv.slice(3).includes("--json")) {
          // P1 (--json on every command): one summary object on stdout.
          console.log(JSON.stringify({ command: "retry", reset: true }));
        } else {
          console.log("failure counters reset — run `megadj sync` to retry");
        }
        break;
      }
      case "organize":
      case "enrich": {
        // organize and enrich share the exact same option surface.
        const flags = parseFlags(
          process.argv.slice(3),
          [],
          ["dry-run", "json"],
        );
        const mod = await import(
          command === "organize" ? "./commands/organize" : "./commands/enrich"
        );
        await mod[command]({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "adopt": {
        const { adopt } = await import("./commands/adopt");
        const json = process.argv.slice(3).includes("--json");
        await adopt({ state, musicDir: MUSIC_DIR, json });
        break;
      }
      case "ingest": {
        const flags = parseFlags(
          process.argv.slice(3),
          // "min-duration" must be registered or parseFlags skips it and
          // its value falls through to the positional folder → walkAudio("90")
          ["ingest", "folder", "min-duration"],
          ["dry-run", "no-artwork", "json"],
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
        const minDurRaw = flags.strings.get("min-duration");
        const minDurNum = minDurRaw !== undefined ? Number(minDurRaw) : NaN;
        if (minDurRaw !== undefined && !Number.isFinite(minDurNum)) {
          console.error(
            `ingest: --min-duration must be a number of seconds (got "${minDurRaw}")`,
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
          minDuration: minDurRaw !== undefined ? minDurNum : undefined,
          json: flags.bools.has("json"),
        });
        break;
      }
      case "artwork": {
        const flags = parseFlags(
          process.argv.slice(3),
          ["model", "max"],
          ["dry-run", "json"],
        );
        const { artwork } = await import("./commands/artwork");
        await artwork({
          state,
          model: flags.strings.get("model"),
          maxImages: numOpt(flags, "max"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "fetch": {
        const flags = parseFlags(
          process.argv.slice(3),
          ["jobs"],
          ["art", "genres", "tags", "years", "all", "dry-run", "json"],
        );
        const { fetch } = await import("./commands/fetch");
        await fetch({
          all: flags.bools.has("all"),
          only: (["art", "genres", "tags", "years"].find((k) =>
            flags.bools.has(k),
          ) ?? "all") as "art" | "genres" | "tags" | "years" | "all",
          jobs: numOpt(flags, "jobs"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "audit": {
        const json = process.argv.slice(3).includes("--json");
        const { auditArchive } = await import("./commands/fetch");
        const report = auditArchive(MUSIC_DIR);
        const gaps = report.rows.filter((r) => !r.complete);
        if (json) {
          console.log(
            JSON.stringify(
              {
                ok: gaps.length === 0,
                total: report.total,
                complete: report.complete,
                incomplete: gaps.map((r) => ({
                  file: r.file,
                  missing: (Object.entries(r) as [string, unknown][])
                    .filter(([k, v]) => k !== "file" && k !== "complete" && !v)
                    .map(([k]) => k),
                })),
              },
              null,
              2,
            ),
          );
          if (gaps.length) process.exitCode = 1;
          break;
        }
        console.log(
          `audit: ${report.complete}/${report.total} complete (art + title + artist + album + genre + year)`,
        );
        if (gaps.length) {
          console.log(`\nincomplete:`);
          for (const r of gaps) {
            const miss = (Object.entries(r) as [string, unknown][])
              .filter(([k, v]) => k !== "file" && k !== "complete" && !v)
              .map(([k]) => k)
              .join(",");
            console.log(`  [${miss}] ${r.file}`);
          }
          process.exitCode = 1;
        } else {
          console.log("✅ all tracks fully tagged");
        }
        break;
      }
      case "years": {
        // the fix_years pass, one entry point: verifies every track's year
        // against the SC page / yt-dlp timestamp (never the AI guess)
        const flags = parseFlags(
          process.argv.slice(3),
          [],
          ["dry-run", "json"],
        );
        const { runFixYears } = await import("../tools/fix_years");
        await runFixYears({
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "beats": {
        // Roadmap rev 5 §2/#2 pivot: beat_this → DB ledger, NEVER tags
        // (the tempo gate failed 12/24; arrays feed cues + grid checks).
        const flags = parseFlags(
          process.argv.slice(3),
          ["limit", "jobs"],
          ["force", "dry-run", "json"],
        );
        const limRaw = flags.strings.get("limit");
        const limNum = limRaw !== undefined ? Number(limRaw) : NaN;
        if (limRaw !== undefined && (!Number.isFinite(limNum) || limNum < 0)) {
          console.error(
            `beats: --limit must be a non-negative number (got "${limRaw}")`,
          );
          process.exitCode = 1;
          break;
        }
        const { beats } = await import("./commands/beats");
        await beats({
          state,
          musicDir: MUSIC_DIR,
          jobs: numOpt(flags, "jobs"),
          limit: limRaw !== undefined ? limNum : undefined,
          force: flags.bools.has("force"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
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
