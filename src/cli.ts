#!/usr/bin/env bun
import { ArchiveState } from "./state";
import type { OrganizeOptions } from "./commands/organize";
import { RateLimiter } from "./ratelimit";
import { sync } from "./commands/sync";
import { status, listTracks, statusJson, listJson } from "./commands/status";
import { printHelp as printHelpImpl } from "./usage";

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
  void printHelpImpl();
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

/** Non-negative numeric option with a hard error (`--limit 5`). Returns
 * undefined when absent — AND undefined when present but invalid (after
 * printing the error + exitCode 2), so callers can break out instead of
 * letting NaN flow through as "unlimited" (NaN is falsy: it would skip
 * every slice/stop guard downstream). The beats/mood/cues case blocks
 * each hand-rolled this check 3× inline. */
function nonNegOpt(
  flags: ParsedFlags,
  key: string,
  cmd: string,
): number | undefined {
  const raw = flags.strings.get(key);
  if (raw === undefined) return undefined;
  // Strict raw check BEFORE Number(): Number("") is 0 and Number(" 5 ") is
  // 5, but an empty/whitespace-only value is a typo, not a number — and
  // NaN/Infinity must never slip through as a limit either.
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    console.error(
      `${cmd}: --${key} must be a non-negative number (got "${raw}")`,
    );
    process.exitCode = 2;
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    console.error(
      `${cmd}: --${key} must be a non-negative number (got "${raw}")`,
    );
    process.exitCode = 2;
    return undefined;
  }
  return n;
}

/** First positional argument (skips flags and the command word itself). */
function firstPositional(args: string[], cmd: string): string | undefined {
  return args.find((a) => !a.startsWith("--") && a !== cmd);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith("--")) ?? "help";
  /** Everything after the command — every case below parses this. */
  const rest = process.argv.slice(3);

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

  // Fleet bootstrap: [booth].fleet from the shared config.toml (or
  // MEGADJ_FLEET="xdj-xz,cdj-3000" override). Both gates — audio and
  // text — key off this, so the audit answers for the players the user
  // actually spins. Unknown ids fall back to the default trio.
  try {
    const { loadConfig } = await import("../cratedeck/src/config");
    const cfg = loadConfig(
      process.env.CRATEDECK_ROOT ?? import.meta.dir + "/../cratedeck",
    );
    const envFleet = process.env.MEGADJ_FLEET?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { setBoothFleet } = await import("../fulltags/src/exports");
    setBoothFleet(envFleet && envFleet.length > 0 ? envFleet : cfg.boothFleet);
  } catch (e) {
    // No config / unreadable config → the default trio still guards the
    // audit (logged, never silent — the AGENTS.md catch rule).
    console.error(
      `booth fleet: config.toml unreadable (${e instanceof Error ? e.message : String(e)}) — using default fleet`,
    );
  }

  const state = new ArchiveState(DB_PATH);

  try {
    switch (command) {
      case "doctor": {
        const flags = parseFlags(rest, [], ["json"]);
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
        // Numeric options must mean what they say: non-numeric or negative
        // input is an error, never "unlimited" (NaN is falsy and would skip
        // every guard — a typo like --limit abc or --target-total 10o must
        // not start an UNBOUNDED download run). 0 = attempt nothing.
        const limit = nonNegOpt(flags, "limit", "sync");
        if (limit === undefined && flags.strings.get("limit") !== undefined) {
          // nonNegOpt already set exitCode 2 + printed the error
          break;
        }
        const targetTotal = nonNegOpt(flags, "target-total", "sync");
        if (
          targetTotal === undefined &&
          flags.strings.get("target-total") !== undefined
        ) {
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
          limit: limit,
          dryRun,
          musicOnly,
          targetTotal: targetTotal,
          sources,
          json: flags.bools.has("json"),
        });
        break;
      }
      case "status": {
        const json = rest.includes("--json");
        if (json) statusJson(state);
        else status(state);
        break;
      }
      case "booth-fix": {
        const flags = parseFlags(
          rest,
          ["booth-fix"],
          ["apply", "yes", "dry-run", "json"],
        );
        const { boothFix } = await import("./commands/booth-fix");
        const report = await boothFix({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
          apply: flags.bools.has("apply") && flags.bools.has("yes"),
          json: flags.bools.has("json"),
          log: (m) => void console.log(m),
        });
        if (flags.bools.has("json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(
            `booth-fix: ${report.checked} checked, ${report.fixable} fixable, ${report.applied} applied (fleet: ${report.fleet.join(", ")})`,
          );
          for (const r of report.rows) {
            console.log(`  [${r.gate}: ${r.reasons.join(",")}] ${r.plan}`);
            console.log(`    ${r.file}`);
          }
          if (report.rows.some((r) => r.action === "none"))
            process.exitCode = 1;
        }
        break;
      }
      case "shelf-sync": {
        // shelf master = the archive-grade HDD; sticks only mirror FROM it.
        // Volume names come from config.toml [library] via env overrides —
        // never hardcoded literals (AGENTS.md rule).
        const json = rest.includes("--json");
        const dryRun = rest.includes("--dry-run");
        const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
        const stickVolumes = [
          process.env.USB_SYNC_MASTER ?? "DJMASTER",
          process.env.USB_SYNC_MIRROR ?? "DJMIRROR",
        ];
        const { shelfSync } = await import("./commands/shelf-sync");
        await shelfSync({
          musicDir: MUSIC_DIR,
          shelfVolume: `/Volumes/${shelfVolume}`,
          stickVolumes: stickVolumes.map((v) => `/Volumes/${v}`),
          dryRun,
          json,
        });
        break;
      }
      case "shelf-archive": {
        // The intake sweep: drive(s) → shelf, additive + verified. The
        // generalization of the Sep 9 2026 three-stick manual merge.
        // Volumes come from config.toml [library] defaults via env
        // overrides — never hardcoded literals (AGENTS.md rule).
        const json = rest.includes("--json");
        const dryRun = rest.includes("--dry-run");
        const deep = rest.includes("--deep");
        const trashes = rest.includes("--trashes");
        const intoEq = rest.find((a) => a.startsWith("--into="));
        const into = intoEq ? decodeURIComponent(intoEq.slice(7)) : undefined;
        const shelfVolume = process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1";
        const suffixEq = rest.find((a) => a.startsWith("--suffix="));
        const suffix = suffixEq ? suffixEq.slice(9) : undefined;
        // positional volumes; default to the configured master+mirror when
        // none are named (the "did both sticks fully land?" check)
        const master = process.env.USB_SYNC_MASTER ?? "DJMASTER";
        const mirror = process.env.USB_SYNC_MIRROR ?? "DJMIRROR";
        const positionals = rest.filter(
          (a) => !a.startsWith("--") && a !== "shelf-archive",
        );
        const volumes = positionals.length ? positionals : [master, mirror];
        const { shelfArchive } = await import("./commands/shelf-archive");
        await shelfArchive({
          volumes: volumes.map((v) =>
            v.startsWith("/Volumes/") ? v : `/Volumes/${v}`,
          ),
          shelfVolume: `/Volumes/${shelfVolume}`,
          into,
          trashes,
          deep,
          suffix,
          dryRun,
          json,
        });
        break;
      }
      case "shelf-dedupe": {
        const apply = rest.includes("--apply");
        const yes = rest.includes("--yes");
        const json = rest.includes("--json");
        const { shelfDedupe } = await import("./commands/shelf-dedupe");
        await shelfDedupe({ apply, yes, json });
        break;
      }
      case "shelf-dupescan": {
        const json = rest.includes("--json");
        const quarantine = rest.includes("--quarantine");
        const yes = rest.includes("--yes");
        const onlyIdentical = rest.includes("--only-identical");
        const { shelfDupescan } = await import("./commands/shelf-dupescan");
        await shelfDupescan({ json, quarantine, yes, onlyIdentical });
        break;
      }
      case "shelf-hygiene":
      case "rb-fix-paths": {
        // The maintenance family lives in commands/maintenance_cmds.ts
        // (file-length guard), same seam shape as the old shelf_cmds.ts.
        const { runMaintenanceCommand } =
          await import("./commands/maintenance_cmds");
        await runMaintenanceCommand(command, rest);
        break;
      }
      case "shelf-sweeps": {
        // The DB record of every drive → shelf sweep (queryable state, not
        // markdown). `--json` = full history; text = one line per drive.
        const json = rest.includes("--json");
        const state2 = new ArchiveState(DB_PATH);
        try {
          const rows = state2.shelfSweeps.latestPerDrive();
          const hist = state2.shelfSweeps.history();
          if (json) {
            console.log(
              JSON.stringify(
                { command: "shelf-sweeps", latest: rows, history: hist },
                null,
                2,
              ),
            );
          } else {
            console.log("shelf sweeps (latest per drive):");
            for (const r of rows) {
              const done = r.finished_at
                ? r.finished_at.slice(0, 10)
                : "running";
              const gb = (r.bytes_copied / 1e9).toFixed(2);
              console.log(
                `  ${r.drive.padEnd(16)} ${r.verdict.padEnd(9)} ${done}  ` +
                  `${r.files_seen} files · ${r.covered_exact} covered · ${r.preserved} preserved · ${r.copied} copied (${gb} GB)${r.failed ? ` · FAILED ${r.failed}` : ""}${r.deep ? " · deep" : ""}`,
              );
            }
            if (rows.length === 0)
              console.log(
                "  (no sweeps recorded yet — run megadj shelf-archive)",
              );
          }
        } finally {
          state2.close();
        }
        break;
      }
      case "list": {
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
        if (rest.includes("--json")) {
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
        const flags = parseFlags(rest, [], ["dry-run", "json"]);
        const mod: Record<
          "organize" | "enrich",
          (opts: OrganizeOptions) => Promise<void>
        > = await import(
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
        const json = rest.includes("--json");
        await adopt({ state, musicDir: MUSIC_DIR, json });
        break;
      }
      case "convert": {
        const flags = parseFlags(
          rest,
          ["convert"],
          ["dry-run", "no-artwork", "json"],
        );
        const { convertArchive } = await import("./commands/convert");
        const report = await convertArchive({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
          noArtwork: flags.bools.has("no-artwork"),
          json: flags.bools.has("json"),
        });
        if (flags.bools.has("json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(
            `convert: ${report.converted}/${report.total} wav→aiff` +
              (report.artAdded ? `, ${report.artAdded} art embedded` : "") +
              (report.artQueued ? `, ${report.artQueued} art queued` : "") +
              (report.failed.length
                ? `, ${report.failed.length} FAILED (wavs kept)`
                : ""),
          );
          for (const f of report.failed)
            console.log(`  ✗ ${f.reason}: ${f.file}`);
          for (const w of report.hiresWarnings) console.log(`  ⚠ ${w}`);
          if (report.failed.length) process.exitCode = 1;
        }
        break;
      }
      case "dedupe-archive": {
        const flags = parseFlags(
          rest,
          ["dedupe-archive"],
          ["apply", "yes", "json"],
        );
        const { dedupeArchive } = await import("./commands/dedupe-archive");
        const report = await dedupeArchive({
          musicDir: MUSIC_DIR,
          dbPath: DB_PATH,
          apply: flags.bools.has("apply"),
          yes: flags.bools.has("yes"),
          json: flags.bools.has("json"),
        });
        if (flags.bools.has("json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(
            `dedupe-archive: ${report.groups.length} group(s), ` +
              `${(report.redundantBytes / 1e9).toFixed(2)} GB redundant` +
              (report.applied
                ? ` — quarantined ${report.quarantined}, review ${report.skippedForReview}`
                : " (report only — add --apply --yes)"),
          );
          for (const e of report.errors) console.log(`  ✗ ${e}`);
          if (report.errors.length) process.exitCode = 1;
        }
        break;
      }
      case "ingest": {
        const flags = parseFlags(
          rest,
          // "min-duration" must be registered or parseFlags skips it and
          // its value falls through to the positional folder → walkAudio("90")
          ["ingest", "folder", "min-duration"],
          ["dry-run", "no-artwork", "json"],
        );
        const folder =
          firstPositional(rest, "ingest") ?? flags.strings.get("folder");
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
      case "drop": {
        const flags = parseFlags(
          rest,
          ["drop", "target"],
          ["dry-run", "no-mood", "json"],
        );
        const target =
          firstPositional(rest, "drop") ?? flags.strings.get("target");
        if (!target) {
          console.error(
            "drop: pass a folder or URL — megadj drop <folder-or-url> [--dry-run] [--no-mood]",
          );
          process.exitCode = 1;
          break;
        }
        const { drop } = await import("./commands/drop");
        await drop({
          state,
          musicDir: MUSIC_DIR,
          target,
          dryRun: flags.bools.has("dry-run"),
          noMood: flags.bools.has("no-mood"),
          json: flags.bools.has("json"),
          cookiesFromBrowser: COOKIES || null,
          cookiesFile: COOKIES_FILE,
        });
        break;
      }
      case "artwork": {
        const flags = parseFlags(rest, ["model", "max"], ["dry-run", "json"]);
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
          rest,
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
        const json = rest.includes("--json");
        const { auditArchive } = await import("./commands/fetch");
        const { auditRowFlags } = await import("./commands/audit-row");
        const report = await auditArchive(MUSIC_DIR);
        const gaps = report.rows.filter((r) => !r.complete);
        const unplayable = gaps.filter((r) => !r.playable);
        const unreadable = gaps.filter((r) => !r.readable);
        if (json) {
          console.log(
            JSON.stringify(
              {
                ok: gaps.length === 0,
                total: report.total,
                complete: report.complete,
                unplayable: unplayable.map((r) => r.file),
                unreadable: unreadable.map((r) => ({
                  file: r.file,
                  reasons: r.unreadableReasons,
                })),
                incomplete: gaps.map((r) => ({
                  file: r.file,
                  missing: auditRowFlags(r),
                })),
              },
              null,
              2,
            ),
          );
          if (gaps.length) process.exitCode = 1;
          break;
        }
        const dims =
          "art + title + artist + album + genre + year + mood + energy + player-compat + booth-text";
        console.log(
          `audit: ${report.complete}/${report.total} complete (${dims})`,
        );
        if (gaps.length) {
          console.log(`\nincomplete:`);
          for (const r of gaps) {
            console.log(`  [${auditRowFlags(r)}] ${r.file}`);
          }
          process.exitCode = 1;
        } else {
          console.log("✅ all tracks fully tagged + booth-playable");
        }
        break;
      }
      case "years": {
        // the fix_years pass, one entry point: verifies every track's year
        // against the SC page / yt-dlp timestamp (never the AI guess)
        const flags = parseFlags(rest, [], ["dry-run", "json"]);
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
          rest,
          ["limit", "jobs"],
          ["force", "dry-run", "json"],
        );
        // Invalid numeric input must abort the case, never flow through
        // (undefined-after-error means bail — same contract as sync).
        const beatsLimit = nonNegOpt(flags, "limit", "beats");
        if (
          beatsLimit === undefined &&
          flags.strings.get("limit") !== undefined
        )
          break;
        const { beats } = await import("./commands/beats");
        await beats({
          state,
          musicDir: MUSIC_DIR,
          jobs: numOpt(flags, "jobs"),
          limit: beatsLimit,
          force: flags.bools.has("force"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "mood": {
        // Roadmap rev 6.1 #4: ONNX mood/dance/valence → DB ledger. File
        // stamps (TXXX:MOOD) sync first; unstamped tracks analyze inline.
        // --embeddings (I49): also mirror the effnet 1280-d embedding into
        // the `embeddings` ledger for "sounds like" queries.
        const flags = parseFlags(
          rest,
          ["limit", "jobs"],
          ["force", "dry-run", "json", "embeddings"],
        );
        const moodLimit = nonNegOpt(flags, "limit", "mood");
        if (moodLimit === undefined && flags.strings.get("limit") !== undefined)
          break;
        const { mood } = await import("./commands/mood");
        await mood({
          state,
          musicDir: MUSIC_DIR,
          jobs: numOpt(flags, "jobs"),
          limit: moodLimit,
          force: flags.bools.has("force"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
          embeddings: flags.bools.has("embeddings"),
        });
        break;
      }
      case "similar": {
        // Roadmap I49 "sounds like": cosine kNN over the embeddings
        // ledger. Pure read — the vectors come from `megadj mood
        // --embeddings` (same ONNX probe run as the mood heads).
        const flags = parseFlags(rest, ["similar", "k"], ["json"]);
        const id =
          firstPositional(rest, "similar") ?? flags.strings.get("similar");
        if (!id) {
          console.error(
            "similar: pass a video id — `megadj similar <video_id> [--k N]`",
          );
          process.exit(1);
        }
        const { similar } = await import("./commands/similar");
        await similar({
          state,
          videoId: id,
          k: numOpt(flags, "k"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "upgrade": {
        // Roadmap D24: re-fetch below-floor (LOWQ) tracks at best quality.
        // The swap is fingerprint-gated: a different recording is refused,
        // the old file never leaves until every gate passes.
        const flags = parseFlags(rest, ["limit"], ["dry-run", "json"]);
        const upgradeLimit = nonNegOpt(flags, "limit", "upgrade");
        if (
          upgradeLimit === undefined &&
          flags.strings.get("limit") !== undefined
        )
          break;
        const { upgrade } = await import("./commands/upgrade");
        await upgrade({
          state,
          musicDir: MUSIC_DIR,
          cookiesFromBrowser: COOKIES || null,
          cookiesFile: COOKIES_FILE,
          limit: upgradeLimit,
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "cues": {
        // Roadmap cues slice: DJ phrase markers (8-bar) from the beats
        // ledger's downbeats — DB-side only, no player writes.
        const flags = parseFlags(rest, ["limit"], ["force", "dry-run", "json"]);
        const cuesLimit = nonNegOpt(flags, "limit", "cues");
        if (cuesLimit === undefined && flags.strings.get("limit") !== undefined)
          break;
        const { cues } = await import("./commands/cues");
        await cues({
          state,
          limit: cuesLimit,
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
