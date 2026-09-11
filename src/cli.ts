#!/usr/bin/env bun
import { ArchiveState } from "./archive/state";
import type { OrganizeOptions } from "./getdat/commands/organize";
import { RateLimiter } from "./getdat/ratelimit";
import { sync } from "./getdat/commands/sync";
import { status, listTracks, statusJson, listJson } from "./shared/status";
import { printHelp as printHelpImpl } from "./usage";
import { MUSIC_DIR, DB_PATH, COOKIES, COOKIES_FILE } from "./cli-env";
import { parseFlags, numOpt, nonNegOpt, firstPositional } from "./cli-flags";
import {
  runShelfSync,
  runShelfArchive,
  runShelfSweeps,
} from "./shelf/cli-shelf-cmds";
import {
  MAINTENANCE_VERBS,
  runMaintenanceCommand,
} from "./shared/maintenance-cmds";
import { writeJson, writeJsonText, drainStdout } from "./shared/cli-output";

// Env constants + flag parsers moved to cli-env.ts / cli-flags.ts, and the
// shelf-family case bodies to cli-shelf-cmds.ts (complexity guard) —
// re-exported so existing `from "./cli"` import sites keep working.
export { MUSIC_DIR, DB_PATH, COOKIES, COOKIES_FILE };
export { parseFlags, numOpt, nonNegOpt, firstPositional };

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
    if ((MAINTENANCE_VERBS as readonly string[]).includes(command)) {
      await runMaintenanceCommand(command, rest);
      return;
    }
    switch (command) {
      case "doctor": {
        const flags = parseFlags(rest, [], ["json"]);
        const { runDoctor, printDoctor, doctorJson } =
          await import("./shared/doctor");
        const results = runDoctor();
        if (flags.bools.has("json")) {
          await writeJsonText(doctorJson(results));
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
        const { runInit } = await import("./shared/doctor");
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
        if (json) await statusJson(state);
        else status(state);
        break;
      }
      case "booth-fix": {
        const flags = parseFlags(
          rest,
          ["booth-fix"],
          ["apply", "yes", "dry-run", "json"],
        );
        const { boothFix } = await import("./fulltags/booth-fix");
        const report = await boothFix({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
          apply: flags.bools.has("apply") && flags.bools.has("yes"),
          json: flags.bools.has("json"),
          log: (m) => void console.log(m),
        });
        if (flags.bools.has("json")) {
          await writeJson(report);
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
        await runShelfSync(rest);
        break;
      }
      case "shelf-archive": {
        // The intake sweep: drive(s) → shelf, additive + verified.
        await runShelfArchive(rest);
        break;
      }
      case "shelf-dedupe": {
        const apply = rest.includes("--apply");
        const yes = rest.includes("--yes");
        const json = rest.includes("--json");
        const { shelfDedupe } = await import("./shelf/shelf-dedupe");
        await shelfDedupe({ apply, yes, json });
        break;
      }
      case "shelf-dupescan": {
        const json = rest.includes("--json");
        const quarantine = rest.includes("--quarantine");
        const yes = rest.includes("--yes");
        const onlyIdentical = rest.includes("--only-identical");
        // repeatable --scan-dir DIR: extra absolute dirs fingerprinted
        // alongside Contents/ (report lens — e.g. the unmatched quarantine)
        const scanDirs: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--scan-dir") {
            const v = rest[i + 1];
            if (v) scanDirs.push(v);
          }
        }
        const { shelfDupescan } = await import("./shelf/shelf-dupescan");
        await shelfDupescan({ json, quarantine, yes, onlyIdentical, scanDirs });
        break;
      }
      case "shelf-sweeps": {
        // The DB record of every drive → shelf sweep (queryable state, not
        // markdown). `--json` = full history; text = one line per drive.
        await runShelfSweeps(rest);
        break;
      }
      case "list": {
        const filter = rest.find((a) => !a.startsWith("--"));
        if (rest.includes("--json")) {
          await listJson(state, filter);
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
          await writeJson({ command: "retry", reset: true });
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
          command === "organize"
            ? "./getdat/commands/organize"
            : "./fulltags/enrich"
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
        const { adopt } = await import("./getdat/commands/adopt");
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
        const { convertArchive } = await import("./fulltags/convert");
        const report = await convertArchive({
          state,
          musicDir: MUSIC_DIR,
          dryRun: flags.bools.has("dry-run"),
          noArtwork: flags.bools.has("no-artwork"),
          json: flags.bools.has("json"),
        });
        if (flags.bools.has("json")) {
          await writeJson(report);
        } else {
          console.log(
            `convert: ${report.converted}/${report.total} wav→aiff${
              report.artAdded ? `, ${report.artAdded} art embedded` : ""
            }${report.artQueued ? `, ${report.artQueued} art queued` : ""}${
              report.failed.length
                ? `, ${report.failed.length} FAILED (wavs kept)`
                : ""
            }`,
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
        const { dedupeArchive } = await import("./shelf/dedupe-archive");
        const report = await dedupeArchive({
          musicDir: MUSIC_DIR,
          dbPath: DB_PATH,
          apply: flags.bools.has("apply"),
          yes: flags.bools.has("yes"),
          json: flags.bools.has("json"),
        });
        if (flags.bools.has("json")) {
          await writeJson(report);
        } else {
          console.log(
            `dedupe-archive: ${report.groups.length} group(s), ${(report.redundantBytes / 1e9).toFixed(2)} GB redundant${
              report.applied
                ? ` — quarantined ${report.quarantined}, review ${report.skippedForReview}`
                : " (report only — add --apply --yes)"
            }`,
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
        const { ingest } = await import("./getdat/commands/ingest");
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
          ["drop", "target", "max-beat-seconds"],
          ["dry-run", "no-mood", "no-fetch", "ai-fallback", "json"],
        );
        const maxBeatSeconds = nonNegOpt(flags, "max-beat-seconds", "drop");
        if (
          maxBeatSeconds === undefined &&
          flags.strings.get("max-beat-seconds") !== undefined
        )
          break;
        const target =
          firstPositional(rest, "drop") ?? flags.strings.get("target");
        if (!target) {
          console.error(
            "drop: pass a folder or URL — megadj drop <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback]",
          );
          process.exitCode = 1;
          break;
        }
        const { drop } = await import("./shared/drop");
        await drop({
          state,
          musicDir: MUSIC_DIR,
          target,
          dryRun: flags.bools.has("dry-run"),
          noMood: flags.bools.has("no-mood"),
          noFetch: flags.bools.has("no-fetch"),
          aiFallback: flags.bools.has("ai-fallback"),
          maxBeatSeconds,
          json: flags.bools.has("json"),
          cookiesFromBrowser: COOKIES || null,
          cookiesFile: COOKIES_FILE,
        });
        break;
      }
      case "artwork": {
        const flags = parseFlags(rest, ["model", "max"], ["dry-run", "json"]);
        const { artwork } = await import("./fulltags/artwork");
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
          [
            "art",
            "genres",
            "tags",
            "years",
            "all",
            "ai-fallback",
            "dry-run",
            "json",
          ],
        );
        const { fetch } = await import("./fulltags/fetch");
        const jobs = nonNegOpt(flags, "jobs", "fetch");
        if (jobs === undefined && flags.strings.get("jobs") !== undefined) {
          // nonNegOpt already set exitCode 2 + printed the error
          break;
        }
        await fetch({
          all: flags.bools.has("all"),
          only: (["art", "genres", "tags", "years"].find((k) =>
            flags.bools.has(k),
          ) ?? "all") as "art" | "genres" | "tags" | "years" | "all",
          jobs,
          aiFallback: flags.bools.has("ai-fallback"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "audit": {
        const json = rest.includes("--json");
        const { auditArchive } = await import("./fulltags/fetch");
        const { auditRowFlags } = await import("./fulltags/audit-row");
        const report = await auditArchive(MUSIC_DIR);
        const gaps = report.rows.filter((r) => !r.complete);
        const unplayable = gaps.filter((r) => !r.playable);
        const unreadable = gaps.filter((r) => !r.readable);
        if (json) {
          await writeJson({
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
          });
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
      case "tag-check": {
        // Corrupt-ID3 scanner (Sep 11 2026): structure-level tag health —
        // unreadable containers, mojibake, control bytes, no-title/artist
        // voids, fleet-text failures. Complements `audit` (which gates
        // COMPLETENESS); this gates WELL-FORMEDNESS.
        const flags = parseFlags(rest, [], ["json"]);
        const { walkAudioFiles, tagHealth } =
          await import("../fulltags/src/exports");
        const files = walkAudioFiles(MUSIC_DIR);
        const bad: { file: string; reasons: string[] }[] = [];
        for (const f of files) {
          const h = tagHealth(f);
          if (!h.ok) bad.push({ file: f, reasons: h.reasons });
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
          for (const b of bad)
            console.log(`  [${b.reasons.join(", ")}] ${b.file}`);
          console.log(
            `\nwhat these mean: no-title-artist = identity frames empty; mojibake-* = double-encoded text (fix the spelling and re-stamp); control-bytes-* = invisible junk in frame text; booth-text:* = garbles on a CDJ/XDJ display (see \`megadj booth-fix --dry-run\`).`,
          );
        }
        if (bad.length) process.exitCode = 1;
        break;
      }
      case "years": {
        // the fix-years pass, one entry point: verifies every track's year
        // against the SC page / yt-dlp timestamp (never the AI guess)
        const flags = parseFlags(rest, [], ["dry-run", "json"]);
        const { runFixYears } = await import("./fulltags/years");
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
          ["limit", "jobs", "max-seconds"],
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
        const maxBeatSeconds = nonNegOpt(flags, "max-seconds", "beats");
        if (
          maxBeatSeconds === undefined &&
          flags.strings.get("max-seconds") !== undefined
        )
          break;
        const { beats } = await import("./fulltags/beats");
        await beats({
          state,
          musicDir: MUSIC_DIR,
          jobs: numOpt(flags, "jobs"),
          limit: beatsLimit,
          force: flags.bools.has("force"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
          maxSeconds: maxBeatSeconds,
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
        const { mood } = await import("./fulltags/mood");
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
        const { similar } = await import("./fulltags/similar");
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
        const { upgrade } = await import("./getdat/commands/upgrade");
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
        const { cues } = await import("./fulltags/cues");
        await cues({
          state,
          limit: cuesLimit,
          force: flags.bools.has("force"),
          dryRun: flags.bools.has("dry-run"),
          json: flags.bools.has("json"),
        });
        break;
      }
      case "gold-report": {
        // GA-00b: score the ledgers against the gold annotations — the
        // §0.2 metrics table. Read-only; exit 1 when the set is empty.
        const flags = parseFlags(rest, [], ["json"]);
        const { goldReport, printGoldReport } =
          await import("./fulltags/gold-report");
        const r = await goldReport({
          state,
          json: flags.bools.has("json"),
        });
        if (flags.bools.has("json")) {
          await writeJson(r);
        } else {
          printGoldReport(r, console.log);
        }
        if (!r.ok) process.exitCode = 1;
        break;
      }
      case "regate": {
        const flags = parseFlags(rest, ["detector", "gold-dir"], ["json"]);
        const dimension = firstPositional(rest, "regate") ?? "bpm";
        const detector = flags.strings.get("detector") ?? "ledger";
        const { regate } = await import("./fulltags/regate");
        const r = regate(
          state,
          dimension,
          detector,
          flags.strings.get("gold-dir"),
        );
        if (flags.bools.has("json")) await writeJson(r);
        else {
          console.log(
            `${r.detector}: ${r.gate.passPercent.toFixed(1)}% passed ` +
              `(required ${r.gate.requiredPercent.toFixed(1)}%) — ${r.ok ? "PASS" : "FAIL"}`,
          );
          if (r.error) console.error(`error: ${r.error}`);
        }
        if (!r.ok) process.exitCode = 1;
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
await drainStdout();
