// deckctl.ts — CLI dispatcher for CrateDeck (agents + humans).
// Exit codes: 0 ok · 1 job failed · 2 usage · 3 interlock · 4 unreachable.

import { apiPost, ensureServer } from "./deckapi";
import { DRIVE_JOB_KINDS } from "../shared/types";
import { cmdNote, cmdNotes, cmdRename } from "./deckctl_notes";
import { cmdReport } from "./deckctl_report";
import { cmdSearch } from "./deckctl_search";
import { cmdHelp, cmdDismiss } from "./deckctl_help";
import { cmdHygiene } from "./deckctl_hygiene";
import { cmdFixes } from "./deckctl_fixes";
import { cmdRun } from "./deckctl_run";
import {
  cmdCancel,
  cmdDrives,
  cmdJobs,
  cmdPlayers,
  cmdPreflight,
  cmdStatus,
} from "./deckctl_status";
import {
  cmdBoothFleet,
  cmdCoverage,
  cmdDiff,
  cmdRadar,
  cmdRedundancy,
} from "./deckctl_fleet";
import { cmdPrep } from "./deckctl_prep";
import { cmdExplain } from "./deckctl_explain";
import { KIND_DOCS } from "./deckctl_docs";
import { baseHooks, errOut, flushStdout, log } from "./deckctl_runtime";

const PRE_SERVER_VERBS = ["help"] as const;

/** One deckctl verb: args already `--json`-filtered, `arg()` dies with
 *  usage on a missing positional. Table entries stay one-line closures. */
interface DeckArgs {
  args: string[];
  arg: (index: number) => string;
}

/** The verb table — the dispatch SSOT (#89: the old 22-arm switch was the
 *  package's top CCN). A verb without an entry here falls to `usage()` in
 *  main(); help-census derives from these keys. */
const DECK_COMMANDS: Record<string, (a: DeckArgs) => Promise<void>> = {
  status: () => cmdStatus(),
  drives: () => cmdDrives(),
  preflight: () => cmdPreflight(),
  prep: () =>
    cmdPrep(
      process.argv.includes("--out")
        ? process.argv[process.argv.indexOf("--out") + 1]
        : undefined,
    ),
  note: ({ arg }) => cmdNote(baseHooks(), arg(1), arg(2)),
  notes: ({ args }) => cmdNotes(baseHooks(), args[1]),
  search: ({ arg }) => cmdSearch(baseHooks(), arg(1)),
  report: ({ arg }) => cmdReport(baseHooks(), arg(1), process.argv),
  rename: ({ args, arg }) =>
    cmdRename(baseHooks(), arg(1), args.slice(2).join(" ") || null),
  players: ({ args }) => cmdPlayers(args[1]),
  booth: ({ args }) =>
    cmdBoothFleet(
      args[1] === "set" ? "set" : undefined,
      args[1] === "set" ? args.slice(2) : undefined,
    ),
  run: ({ arg }) => cmdRun(arg(1), arg(2), !process.argv.includes("--no-wait")),
  jobs: () => cmdJobs(),
  coverage: ({ args }) => cmdCoverage(args[1]),
  redundancy: ({ args }) => cmdRedundancy(args[1]),
  radar: ({ args }) => cmdRadar(args[1]),
  diff: ({ args }) => cmdDiff(args[1], args[2]),
  explain: ({ args }) => cmdExplain(args[1], Object.keys(KIND_DOCS).join(", ")),
  hygiene: ({ args }) => cmdHygiene(baseHooks(), args[1], args[2]),
  fixes: ({ args }) => cmdFixes(baseHooks(), args[1]),
  dismiss: ({ arg }) => cmdDismiss(baseHooks(), arg(1), arg(2)),
  cancel: ({ arg }) => cmdCancel(arg(1)),
  stop: async () => {
    log("stopping server…");
    await apiPost("/api/stop").catch((error: unknown) => {
      console.error(
        "stop request failed (server may already be down):",
        error instanceof Error ? error.message : error,
      );
    });
  },
};

function usageText(): string {
  return [
    "usage: deckctl <command> [args] [--json]",
    "",
    "  status                        rekordbox lock + all drives + active jobs",
    "  drives                        list drives with badge verdicts",
    "  report <drive>                health-check dossier (drive = name, nickname, or UUID; --dossier = full export bundle, --out FILE writes it)",
    "  rename <drive> [nickname]     set/clear the display nickname (omit = clear)",
    `  run <drive> <kind>            enqueue + follow a job (${DRIVE_JOB_KINDS.join("|")})`,
    "  coverage [min-copies]         which tracks live on which drives + at-risk list",
    "  redundancy [min-copies]       per-playlist audit: every track on ≥N drives?",
    "  radar [drive]                 new-music radar: archived tracks not on each drive yet",
    "  preflight                     gig-night pass/fail across all mounted drives (exit 1 if not ready)",
    "  players [drive]               which CDJs/XDJs can read each stick (measured dual-DB state)",
    "  booth [set ID ...]            the players compat checks enforce (no args = show; set persists)",
    "  prep [--out FILE]             weekly digest: fleet + redundancy + archive markdown",
    "  note <drive> <text>           post a finding to the drive timeline (--severity info|warn|critical)",
    "  notes [drive]                 active findings feed (omit drive = every drive)",
    "  search <query>                global search: playlists + folders across all drive snapshots",
    "  diff <driveA> <driveB>        added / removed / changed between two drives",
    "  explain [kind]                what each job checks, typical duration, safety",
    "  hygiene [scan|apply|bucket NAME|confirm ID|dismiss ID]  shelf hygiene queue: census + jobs + batch-confirm + decisions",
    "  fixes [scan|apply]            booth-fix queue: census + job enqueues (fleet from `deckctl booth`)",
    "  help [term|kind]              glossary + job/surface tour (the UI's help cards, for agents)",
    "  dismiss <drive> <noteId>      retire a note from the active feed (history kept)",
    "  jobs                          recent jobs",
    "  cancel <jobId>                cancel an active job",
    "  stop                          stop the CrateDeck server",
    "",
    "--json  machine-readable output (single object, or one line per poll with run --wait)",
    "--help  print this text and exit 0 (works with the server down)",
  ].join("\n");
}

// ---- main -------------------------------------------------------------------

function usage(): never {
  void errOut(usageText());
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--json");
  const arg = (index: number): string => args[index] ?? usage();
  const cmd = args[0];
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    await Bun.write(Bun.stdout, `${usageText()}\n`);
    await flushStdout();
    process.exit(0);
  }
  if (cmd && (PRE_SERVER_VERBS as readonly string[]).includes(cmd)) {
    await cmdHelp(baseHooks(), args[1]);
    await flushStdout();
    return;
  }
  if (!(await ensureServer())) {
    await errOut("cratedeck server unreachable and could not be started");
    process.exit(4);
  }
  const handler = cmd === undefined ? undefined : DECK_COMMANDS[cmd];
  if (handler === undefined) usage();
  await handler({ args, arg });
}

try {
  await main();
  await flushStdout();
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  await flushStdout();
  process.exit(1);
}
