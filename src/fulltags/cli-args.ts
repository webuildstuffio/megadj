// cli-args.ts — the fulltags flag-grammar types + parser (#42 item 2
// split, out of cli.ts): CliArgs/CliCtx shapes, parseArgs, and the
// BOOL/VALUE opt tables. cli.ts keeps help text + the verb table.
import { nonNegOpt, parseFlags } from "../cli-flags";
import { setExit } from "../shared/cli-output";
import { DEFAULT_QUEUE, STAGES, type Stage } from "./pipeline";

/** Narrow a CLI word to a Stage (undefined = not a stage name). */
function isStage(word: string): word is Stage {
  return (STAGES as readonly string[]).includes(word);
}

export interface CliArgs {
  target: string | null;
  stages: Stage[] | null;
  jobs: number;
  valid: boolean;
  dryRun: boolean;
  upgradeScArt: boolean;
  archiveDir: string | null;
  artworkQueue: string | null;
  json: boolean;
  hints: {
    title?: string | undefined;
    artist?: string | undefined;
    album?: string | undefined;
  };
}

/** Shared arm context: the parsed args plus raw argv (some verbs own
 *  their flag grammar, e.g. verify-key). */
export interface CliCtx {
  argv: string[];
  args: CliArgs;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: null,
    stages: null,
    jobs: 4,
    valid: true,
    dryRun: false,
    upgradeScArt: false,
    archiveDir: null,
    artworkQueue: DEFAULT_QUEUE,
    json: false,
    hints: {},
  };
  const stages = new Set<Stage>();
  // `audit`, `single`, and `verify-key` are subcommands, not targets —
  // skip them during target pickup (`single` is the documented per-file
  // hint entrypoint; verify-key consumes its own argv via parseVerifyKeyArgs).
  const skipFirst =
    argv[0] === "audit" || argv[0] === "single" || argv[0] === "verify-key";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (i === 0 && skipFirst) continue;
    i = parseOneArg(args, argv, i, a, stages);
  }
  if (stages.size) args.stages = [...stages];
  return args;
}

/** Boolean flags: `--flag` → set the args field. True when consumed. */
const BOOL_OPTS: Record<string, (args: CliArgs) => void> = {
  "--dry-run": (args) => {
    args.dryRun = true;
  },
  "--upgrade-sc-art": (args) => {
    args.upgradeScArt = true;
  },
  "--json": (args) => {
    args.json = true;
  },
  "--no-queue": (args) => {
    args.artworkQueue = null;
  },
};

function parseFlagOpt(args: CliArgs, a: string): boolean {
  const set = BOOL_OPTS[a];
  if (set === undefined) return false;
  set(args);
  return true;
}

/** Options with a separate value: `--flag` → args field to set from the
 *  next argv slot (hint fields go under `hints`). */
const VALUE_OPTS: Record<
  string,
  "archiveDir" | "artworkQueue" | "title" | "artist" | "album"
> = {
  "--archive-dir": "archiveDir",
  "--artwork-queue": "artworkQueue",
  "--title": "title",
  "--artist": "artist",
  "--album": "album",
};

/** Apply a value-opt: route null-coalesced path fields vs raw hints. */
function applyValueOpt(
  args: CliArgs,
  field: "title" | "artist" | "album" | "archiveDir" | "artworkQueue",
  value: string | undefined,
): void {
  if (field === "archiveDir") args.archiveDir = value ?? null;
  else if (field === "artworkQueue") args.artworkQueue = value ?? null;
  else args.hints[field] = value;
}

/** Parse `argv[i]` into `args` and return the index to continue from
 *  (value-taking flags consume the next slot). Unknown `--flags` are
 *  ignored; the first bare word becomes the target. */
function parseOneArg(
  args: CliArgs,
  argv: string[],
  i: number,
  a: string,
  stages: Set<Stage>,
): number {
  if (parseFlagOpt(args, a)) return i;
  if (a === "--jobs" || a.startsWith("--jobs=")) {
    return parseJobsArg(args, argv, i, a);
  }
  const valueOpt = VALUE_OPTS[a];
  if (valueOpt !== undefined) {
    applyValueOpt(args, valueOpt, argv[i + 1]);
    return i + 1;
  }
  if (isStage(a.slice(2))) {
    stages.add(a.slice(2) as Stage);
    return i;
  }
  if (!a.startsWith("--") && !args.target) args.target = a;
  return i;
}

/** `--jobs N` / `--jobs=N` — validated via nonNegOpt; bad input flags the
 *  run invalid (exit 2), zero is rejected with usage guidance. */
function parseJobsArg(
  args: CliArgs,
  argv: string[],
  i: number,
  a: string,
): number {
  const raw = a === "--jobs" ? argv[i + 1] : a.slice("--jobs=".length);
  const consumed = a === "--jobs" ? i + 1 : i;
  const flags = parseFlags([`--jobs=${raw ?? ""}`], ["jobs"], []);
  const jobs = nonNegOpt(flags, "jobs", "fulltags");
  if (jobs === undefined) args.valid = false;
  else if (jobs === 0) {
    console.error('fulltags: --jobs must be at least 1 (got "0")');
    setExit(2);
    args.valid = false;
  } else args.jobs = jobs;
  return consumed;
}
