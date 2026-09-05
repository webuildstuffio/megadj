#!/usr/bin/env bun
/**
 * fulltags — fully enrich any audio file/folder with one command.
 *
 * usage:
 *   bun run fulltags/cli.ts <file-or-folder>          [flags]
 *   fulltags audit <folder>                           completeness gate
 *   fulltags single <file> --title T --artist A ...   one file with hints
 *
 * flags:
 *   --tags --genre --art --year --energy   run only these stages (repeatable)
 *   --fingerprint --bpm --key              analysis stages (offline, idempotent)
 *   --jobs N                               parallel workers (default 4)
 *   --dry-run                              report, don't write
 *   --upgrade-sc-art                       re-embed SC art at original res
 *   --archive-dir DIR                      mp3-twin art search dir
 *   --artwork-queue PATH                   append misses as JSONL (default: the
 *                                          megadj queue; --no-queue disables)
 *   --json                                 machine-readable audit output
 */
import { existsSync, statSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { enrichAll, DEFAULT_QUEUE, readAiStamps } from "./src/pipeline";
import { groundTruth } from "./src/readers";
import { isAudioFile } from "./src/writer";

function printHelp(): void {
  console.log(`fulltags — fully enrich any mp3/wav/aiff/flac/m4a with one command

usage:
  fulltags <file-or-folder> [flags]      fill every missing field
  fulltags audit <folder> [--json]       ground-truth completeness gate

stages: --tags --genre --art --year --energy --fingerprint --bpm --key
        (default: all; analysis stages need fpcalc / beat-this / the
        openkeyscan-analyzer clone — missing envs are skipped with a note)
more:   --jobs N · --dry-run · --upgrade-sc-art · --archive-dir DIR
        --artwork-queue PATH | --no-queue · --json

env: OPENROUTER_API_KEY (AI genre/year fallback) · artwork queue appends to
     ~/.local/state/megadj/artwork-queue.jsonl so \`megadj artwork\` can pick up`);
}

interface CliArgs {
  target: string | null;
  stages: Array<
    | "tags"
    | "genre"
    | "art"
    | "year"
    | "energy"
    | "fingerprint"
    | "bpm"
    | "key"
  > | null;
  jobs: number;
  dryRun: boolean;
  upgradeScArt: boolean;
  archiveDir: string | null;
  artworkQueue: string | null;
  json: boolean;
  hints: { title?: string; artist?: string; album?: string };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: null,
    stages: null,
    jobs: 4,
    dryRun: false,
    upgradeScArt: false,
    archiveDir: null,
    artworkQueue: DEFAULT_QUEUE,
    json: false,
    hints: {},
  };
  const stageKeys = [
    "tags",
    "genre",
    "art",
    "year",
    "energy",
    "fingerprint",
    "bpm",
    "key",
  ] as const;
  const stages = new Set<string>();
  // `audit` and `single` are subcommands, not targets — skip them during
  // target pickup (`single` is the documented per-file hint entrypoint).
  const skipFirst = argv[0] === "audit" || argv[0] === "single";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (i === 0 && skipFirst) continue;
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--upgrade-sc-art") args.upgradeScArt = true;
    else if (a === "--json") args.json = true;
    else if (a === "--no-queue") args.artworkQueue = null;
    else if (a === "--jobs") args.jobs = Number(argv[++i]) || 4;
    else if (a === "--archive-dir") args.archiveDir = argv[++i] ?? null;
    else if (a === "--artwork-queue") args.artworkQueue = argv[++i] ?? null;
    else if (stageKeys.includes(a.slice(2) as any)) stages.add(a.slice(2));
    else if (a === "--title") args.hints.title = argv[++i];
    else if (a === "--artist") args.hints.artist = argv[++i];
    else if (a === "--album") args.hints.album = argv[++i];
    else if (!a.startsWith("--") && !args.target) args.target = a;
  }
  if (stages.size) args.stages = [...stages] as CliArgs["stages"];
  return args;
}

function collectFiles(target: string): string[] {
  const st = statSync(target);
  if (st.isFile()) return isAudioFile(target) ? [target] : [];
  return readdirSync(target, { withFileTypes: true }).flatMap((ent) => {
    if (ent.name.startsWith(".")) return [];
    const full = join(target, ent.name);
    if (ent.isDirectory()) return collectFiles(full);
    return isAudioFile(full) ? [full] : [];
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("help") || argv.includes("--help")) {
    printHelp();
    return;
  }
  const args = parseArgs(argv);

  if (argv[0] === "audit") {
    const dir = args.target;
    if (!dir || !existsSync(dir)) {
      console.error("audit: pass an existing folder — fulltags audit <folder>");
      process.exitCode = 1;
      return;
    }
    const files = collectFiles(dir);
    const rows = files.map((f) => {
      const t = groundTruth(f);
      const ai = readAiStamps(f);
      const missing: string[] = [];
      if (!t.art) missing.push("art");
      if (!t.title) missing.push("title");
      if (!t.artist) missing.push("artist");
      if (!t.album) missing.push("album");
      if (!t.genre || t.genre === "Music") missing.push("genre");
      if (!t.year) missing.push("year");
      const aiFilled = [
        ai.aiGenre ? `genre←AI(${ai.aiGenre.split("|")[1] ?? "?"})` : null,
        ai.aiYear ? `year←AI(${ai.aiYear.split("|")[1] ?? "?"})` : null,
      ].filter((x): x is string => x !== null);
      return {
        file: basename(f),
        missing,
        aiFilled,
        complete: missing.length === 0,
      };
    });
    const complete = rows.filter((r) => r.complete).length;
    const aiCount = rows.filter((r) => r.aiFilled.length).length;
    const gaps = rows.filter((r) => !r.complete);
    // Gate semantics (megadj audit parity): gaps → exit 1, in BOTH output
    // modes. Agents/CI consume --json and rely on the exit code as the gate.
    if (gaps.length) process.exitCode = 1;
    if (args.json) {
      console.log(
        JSON.stringify({ ok: gaps.length === 0, total: rows.length, complete, rows }, null, 2),
      );
    } else {
      console.log(
        `audit: ${complete}/${rows.length} complete (art + title + artist + album + genre + year)`,
      );
      if (aiCount)
        console.log(
          `  ${aiCount} track(s) carry AI-filled fields (genre←AI/year←AI with confidence)`,
        );
      if (gaps.length) {
        console.log("\nincomplete:");
        for (const r of gaps)
          console.log(`  [${r.missing.join(",")}] ${r.file}`);
      } else {
        console.log("✅ all tracks fully tagged");
      }
    }
    return;
  }

  if (!args.target || !existsSync(args.target)) {
    console.error("fulltags: pass an existing file or folder");
    printHelp();
    process.exitCode = 1;
    return;
  }

  const files = collectFiles(args.target);
  if (!files.length) {
    console.log(`fulltags: no audio files in ${args.target}`);
    return;
  }
  console.log(
    `fulltags: ${files.length} file(s)${args.stages ? ` · stages: ${args.stages.join("+")}` : " · all stages"}${args.dryRun ? " · DRY RUN" : ""}`,
  );
  // Hints (--title/--artist/--album) only make sense for a single file —
  // they pre-seed the MB lookup / SC search when the filename is garbage.
  const hintFiles =
    (args.hints.title ?? args.hints.artist ?? args.hints.album)
      ? files.slice(0, 1)
      : files;
  if (hintFiles.length < files.length) {
    console.log(
      "fulltags: note — hints apply to the first file only; run `fulltags single <file>` per file for the rest",
    );
  }
  const summary = await enrichAll(hintFiles, {
    only: args.stages ?? undefined,
    jobs: args.jobs,
    dryRun: args.dryRun,
    upgradeScArt: args.upgradeScArt,
    archiveDir: args.archiveDir ?? undefined,
    artworkQueue: args.artworkQueue,
    hints: args.hints,
  });
  console.log(
    `\nDONE — ${summary.complete}/${summary.total} complete · ${summary.notes} file(s) changed${args.dryRun ? " (dry run — nothing written)" : ""}`,
  );
}

await main();
