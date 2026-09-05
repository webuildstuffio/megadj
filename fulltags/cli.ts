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
import { enrichAll, DEFAULT_QUEUE } from "./src/pipeline";
import { groundTruth } from "./src/readers";
import { isAudioFile } from "./src/writer";

function printHelp(): void {
  console.log(`fulltags — fully enrich any mp3/wav/aiff/flac/m4a with one command

usage:
  fulltags <file-or-folder> [flags]      fill every missing field
  fulltags audit <folder> [--json]       ground-truth completeness gate

stages: --tags --genre --art --year --energy (default: all)
more:   --jobs N · --dry-run · --upgrade-sc-art · --archive-dir DIR
        --artwork-queue PATH | --no-queue · --json

env: OPENROUTER_API_KEY (AI genre/year fallback) · artwork queue appends to
     ~/.local/state/megadj/artwork-queue.jsonl so \`megadj artwork\` can pick up`);
}

interface CliArgs {
  target: string | null;
  stages: Array<"tags" | "genre" | "art" | "year" | "energy"> | null;
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
  const stageKeys = ["tags", "genre", "art", "year", "energy"] as const;
  const stages = new Set<string>();
  // `audit` is a subcommand, not a target — skip it during target pickup.
  const skipFirst = argv[0] === "audit";
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
  if (stages.size)
    args.stages = [...stages] as CliArgs["stages"];
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
    }    const files = collectFiles(dir);
    const rows = files.map((f) => {
      const t = groundTruth(f);
      const missing: string[] = [];
      if (!t.art) missing.push("art");
      if (!t.title) missing.push("title");
      if (!t.artist) missing.push("artist");
      if (!t.album) missing.push("album");
      if (!t.genre || t.genre === "Music") missing.push("genre");
      if (!t.year) missing.push("year");
      return { file: basename(f), missing, complete: missing.length === 0 };
    });
    const complete = rows.filter((r) => r.complete).length;
    if (args.json) {
      console.log(JSON.stringify({ total: rows.length, complete, rows }, null, 2));
    } else {
      console.log(
        `audit: ${complete}/${rows.length} complete (art + title + artist + album + genre + year)`,
      );
      const gaps = rows.filter((r) => !r.complete);
      if (gaps.length) {
        console.log("\nincomplete:");
        for (const r of gaps)
          console.log(`  [${r.missing.join(",")}] ${r.file}`);
        process.exitCode = 1;
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
  const summary = await enrichAll(files, {
    only: args.stages ?? undefined,
    jobs: args.jobs,
    dryRun: args.dryRun,
    upgradeScArt: args.upgradeScArt,
    archiveDir: args.archiveDir ?? undefined,
    artworkQueue: args.artworkQueue,
  });
  console.log(
    `\nDONE — ${summary.complete}/${summary.total} complete · ${summary.notes} file(s) updated`,
  );
}

await main();
