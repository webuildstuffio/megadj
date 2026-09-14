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
  cmdRedundancy,
} from "./deckctl_fleet";
import { cmdPrep } from "./deckctl_prep";
import { cmdExplain } from "./deckctl_explain";
import { KIND_DOCS } from "./deckctl_docs";
import { baseHooks, errOut, flushStdout, log } from "./deckctl_runtime";

const PRE_SERVER_VERBS = ["help"] as const;

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
  switch (cmd) {
    case "status":
      return cmdStatus();
    case "drives":
      return cmdDrives();
    case "preflight":
      return cmdPreflight();
    case "prep":
      return cmdPrep(
        process.argv.includes("--out")
          ? process.argv[process.argv.indexOf("--out") + 1]
          : undefined,
      );
    case "note":
      return cmdNote(baseHooks(), arg(1), (args[2] ?? "").trim() || usage());
    case "notes":
      return cmdNotes(baseHooks(), args[1]);
    case "search":
      return cmdSearch(baseHooks(), arg(1));
    case "report":
      return cmdReport(baseHooks(), arg(1), process.argv);
    case "rename":
      return cmdRename(baseHooks(), arg(1), args.slice(2).join(" ") || null);
    case "players":
      return cmdPlayers(args[1]);
    case "booth":
      return cmdBoothFleet(
        args[1] === "set" ? "set" : undefined,
        args[1] === "set" ? args.slice(2) : undefined,
      );
    case "run":
      return cmdRun(arg(1), arg(2), !process.argv.includes("--no-wait"));
    case "jobs":
      return cmdJobs();
    case "coverage":
      return cmdCoverage(args[1]);
    case "redundancy":
      return cmdRedundancy(args[1]);
    case "diff":
      return cmdDiff(args[1], args[2]);
    case "explain":
      return cmdExplain(args[1], Object.keys(KIND_DOCS).join(", "));
    case "hygiene":
      return cmdHygiene(baseHooks(), args[1], args[2]);
    case "fixes":
      return cmdFixes(baseHooks(), args[1]);
    case "dismiss":
      return cmdDismiss(baseHooks(), arg(1), arg(2));
    case "cancel":
      return cmdCancel(arg(1));
    case "stop":
      log("stopping server…");
      await apiPost("/api/stop").catch((error: unknown) => {
        console.error(
          "stop request failed (server may already be down):",
          error instanceof Error ? error.message : error,
        );
      });
      return;
    default:
      usage();
  }
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
