#!/usr/bin/env bun
/**
 * fulltags — fully enrich any audio file/folder with one command.
 *
 * usage:
 *   bun run fulltags/cli.ts <file-or-folder>          [flags]
 *   fulltags audit <folder>                           completeness gate
 *   fulltags single <file> --title T --artist A ...   one file with hints
 *   fulltags verify-key <folder> [--limit N] [--refs m.json] [--json]
 *                                                     key gauntlet gate
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
 *
 * Structure (#42 item 2 split): the flag grammar lives in cli-args.ts,
 * the verb arms in cli-verbs.ts; this file is help text + the verb
 * table + main().
 */
import { parseArgs, type CliCtx } from "./cli-args";
import { setExit } from "../shared/cli-output";
import {
  cmdAudit,
  cmdEnrich,
  cmdEnsureModels,
  cmdVerifyKey,
} from "./cli-verbs";

function printHelp(): void {
  console.log(`fulltags — fully enrich any mp3/wav/aiff/flac/m4a with one command

usage:
  fulltags <file-or-folder> [flags]      fill every missing field
  fulltags audit <folder> [--json]       ground-truth completeness gate
  fulltags verify-key <folder> [--limit N] [--refs m.json] [--json]
                                         key gauntlet gate (≥80% required)
  fulltags ensure-models                 pre-download the ONNX mood models
  fulltags single <file> [flags]         one file with --title/--artist/--album hints

stages: --tags --genre --art --year --energy --fingerprint --bpm --key --mood
        (default: all; analysis stages need fpcalc / beat-this / the
        openkeyscan-analyzer clone / the ONNX mood models (~320 MB,
        auto-downloaded on first --mood use) — missing envs skip with a note)
more:   --jobs N · --dry-run · --upgrade-sc-art · --archive-dir DIR
        --artwork-queue PATH | --no-queue · --json

verify-key: compares OpenKeyScan keys against existing tags (or a --refs
        JSON map {basename: "Ebm"} — e.g. rekordbox master.db ScaleName via
        pyrekordbox) and FAILS (exit 1) below 80% exact agreement — run it
        BEFORE any batch key write (roadmap #3 gauntlet).

env: OPENROUTER_API_KEY (AI genre/year fallback) · artwork queue appends to
     ~/.local/state/megadj/artwork-queue.jsonl so \`megadj artwork\` can pick up`);
}

/** The verb table — the dispatch SSOT (#90): `main()` is a thin runner
 *  over it. The default (no verb) arm is cmdEnrich. */
const FULLTAGS_COMMANDS: Record<string, (ctx: CliCtx) => Promise<void>> = {
  "ensure-models": () => cmdEnsureModels(),
  "verify-key": (ctx) => cmdVerifyKey(ctx),
  audit: (ctx) => cmdAudit(ctx),
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("help") || argv.includes("--help")) {
    printHelp();
    return;
  }
  const args = parseArgs(argv);
  if (!args.valid) {
    setExit(2);
    return;
  }
  const verb = argv[0];
  const ctx: CliCtx = { argv, args };
  const handler = verb === undefined ? undefined : FULLTAGS_COMMANDS[verb];
  if (handler) {
    await handler(ctx);
    return;
  }
  await cmdEnrich(ctx);
}

await main();
