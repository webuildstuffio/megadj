import type { CliCommandHandler } from "./cli-command";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  numOpt,
  parseFlags,
} from "./cli-flags";
import { isSetSearchOverride } from "../cratedeck/shared/types";
import { writeJson } from "./shared/cli-output";

const beats: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["limit", "jobs", "max-seconds"],
    ["force", "dry-run", "json"],
  );
  if (nonNegOptInvalid(flags, "limit")) return;
  const limit = nonNegOpt(flags, "limit", "beats");
  if (nonNegOptInvalid(flags, "max-seconds")) return;
  const maxSeconds = nonNegOpt(flags, "max-seconds", "beats");
  const { beats: analyzeBeats } = await import("./fulltags/beats");
  await analyzeBeats({
    state,
    musicDir,
    jobs: numOpt(flags, "jobs"),
    limit,
    force: flags.bools.has("force"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
    maxSeconds,
  });
};

const mood: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["limit", "jobs"],
    ["force", "dry-run", "json", "embeddings"],
  );
  if (nonNegOptInvalid(flags, "limit")) return;
  const limit = nonNegOpt(flags, "limit", "mood");
  const { mood: analyzeMood } = await import("./fulltags/mood");
  await analyzeMood({
    state,
    musicDir,
    jobs: numOpt(flags, "jobs"),
    limit,
    force: flags.bools.has("force"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
    embeddings: flags.bools.has("embeddings"),
  });
};

const similar: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["similar", "k"], ["json"]);
  const videoId =
    firstPositional(rest, "similar") ?? flags.strings.get("similar");
  if (!videoId) {
    console.error(
      "similar: pass a video id — `megadj similar <video_id> [--k N]`",
    );
    process.exit(1);
  }
  const { similar: findSimilar } = await import("./fulltags/similar");
  await findSimilar({
    state,
    videoId,
    k: numOpt(flags, "k"),
    json: flags.bools.has("json"),
  });
};

const setbuild: CliCommandHandler = async (rest) => {
  const flags = parseFlags(
    rest,
    ["preset", "minutes", "opener", "limit", "search"],
    ["json"],
  );
  if (nonNegOptInvalid(flags, "minutes")) return;
  const minutes = nonNegOpt(flags, "minutes", "setbuild");
  if (nonNegOptInvalid(flags, "limit")) return;
  const limit = nonNegOpt(flags, "limit", "setbuild");
  // the A/B hook (E7): same contract as the HTTP ?search= / MCP search
  // param — but a CLI typo must fail loudly (exit 2, zero work), not
  // silently compare the automatic pick against itself
  const searchRaw = flags.strings.get("search");
  if (searchRaw !== undefined && !isSetSearchOverride(searchRaw)) {
    console.error(
      `setbuild: unknown --search "${searchRaw}" — expected greedy or beam`,
    );
    process.exitCode = 2;
    return;
  }
  const { setbuild: buildSet } = await import("./fulltags/setbuild");
  await buildSet({
    preset: flags.strings.get("preset"),
    minutes,
    opener: flags.strings.get("opener"),
    limit,
    search: searchRaw,
    json: flags.bools.has("json"),
  });
};

const genre: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(
    rest,
    ["k", "min-agreement"],
    ["apply", "eval", "no-duration-guard", "json"],
  );
  if (nonNegOptInvalid(flags, "k")) return;
  const k = nonNegOpt(flags, "k", "genre");

  const minAgreementRaw = flags.strings.get("min-agreement");
  let minAgreement: number | undefined;
  if (minAgreementRaw !== undefined) {
    const parsed = Number(minAgreementRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      console.error(
        `genre: --min-agreement must be a number in (0, 1], got "${minAgreementRaw}"`,
      );
      process.exitCode = 2;
      return;
    }
    minAgreement = parsed;
  }
  const { genre: inferGenre } = await import("./fulltags/genre");
  await inferGenre({
    state,
    apply: flags.bools.has("apply"),
    k,
    minAgreement,
    eval: flags.bools.has("eval"),
    durationGuard: !flags.bools.has("no-duration-guard"),
    json: flags.bools.has("json"),
  });
};

const cues: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["limit"], ["force", "dry-run", "json"]);
  if (nonNegOptInvalid(flags, "limit")) return;
  const limit = nonNegOpt(flags, "limit", "cues");
  const { cues: generateCues } = await import("./fulltags/cues");
  await generateCues({
    state,
    limit,
    force: flags.bools.has("force"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const goldReport: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { goldReport: buildReport, printGoldReport } =
    await import("./fulltags/gold-report");
  const report = await buildReport({
    state,
    json: flags.bools.has("json"),
  });
  if (flags.bools.has("json")) await writeJson(report);
  else printGoldReport(report, console.log);
  if (!report.ok) process.exitCode = 1;
};

const regate: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["detector", "gold-dir"], ["json"]);
  const dimension = firstPositional(rest, "regate") ?? "bpm";
  const detector = flags.strings.get("detector") ?? "ledger";
  const { regate: runRegate } = await import("./fulltags/regate");
  const report = runRegate(
    state,
    dimension,
    detector,
    flags.strings.get("gold-dir"),
  );
  if (flags.bools.has("json")) await writeJson(report);
  else {
    console.log(
      `${report.detector}: ${report.gate.passPercent.toFixed(1)}% passed ` +
        `(required ${report.gate.requiredPercent.toFixed(1)}%) — ${report.ok ? "PASS" : "FAIL"}`,
    );
    if (report.error) console.error(`error: ${report.error}`);
  }
  if (!report.ok) process.exitCode = 1;
};

export const ANALYSIS_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  beats,
  mood,
  similar,
  setbuild,
  genre,
  cues,
  "gold-report": goldReport,
  regate,
};
