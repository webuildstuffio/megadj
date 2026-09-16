import type { CliCommandHandler } from "./cli-command";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  numOpt,
  parseFlags,
} from "./cli-flags";
import { isMegasetSearchOverride } from "../cratedeck/shared/types";
import { finishCommandError, setExit, writeJson } from "./shared/cli-output";
import { isSimilarSpace } from "../cratedeck/shared/vector-space";

const beats: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["limit", "jobs", "max-seconds"],
    ["force", "dry-run", "json"],
  );
  if (nonNegOptInvalid(flags, "limit", "beats", flags.bools.has("json")))
    return;
  const limit = nonNegOpt(flags, "limit", "beats", flags.bools.has("json"));
  if (nonNegOptInvalid(flags, "max-seconds", "beats", flags.bools.has("json")))
    return;
  const maxSeconds = nonNegOpt(
    flags,
    "max-seconds",
    "beats",
    flags.bools.has("json"),
  );
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
  if (nonNegOptInvalid(flags, "limit", "mood", flags.bools.has("json"))) return;
  const limit = nonNegOpt(flags, "limit", "mood", flags.bools.has("json"));
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
  const flags = parseFlags(rest, ["similar", "k", "space"], ["json"]);
  const videoId =
    firstPositional(rest, "similar") ?? flags.strings.get("similar");
  if (!videoId) {
    // #160 ring 3: json-mode-safe epilogue (was bare console.error + the
    // only raw process.exit(1) left in a command body — process.exit
    // skips the awaited stdout drain and can truncate piped --json).
    await finishCommandError({
      command: "similar",
      json: flags.bools.has("json"),
      error:
        "pass a video id — `megadj similar <video_id> [--k N] [--space raw|whitened]`",
      exitCode: 2,
    });
    return;
  }
  const spaceRaw = flags.strings.get("space");
  if (spaceRaw !== undefined && !isSimilarSpace(spaceRaw)) {
    await finishCommandError({
      command: "similar",
      error: `unknown --space "${spaceRaw}" — expected raw or whitened`,
      exitCode: 2,
    });
    return;
  }
  const { similar: findSimilar } = await import("./fulltags/similar");
  await findSimilar({
    state,
    videoId,
    k: numOpt(flags, "k"),
    space: spaceRaw,
    json: flags.bools.has("json"),
  });
};

const megaset: CliCommandHandler = async (rest) => {
  const flags = parseFlags(
    rest,
    ["preset", "minutes", "opener", "limit", "search"],
    ["json"],
  );
  if (nonNegOptInvalid(flags, "minutes", "megaset", flags.bools.has("json")))
    return;
  const minutes = nonNegOpt(
    flags,
    "minutes",
    "megaset",
    flags.bools.has("json"),
  );
  if (nonNegOptInvalid(flags, "limit", "megaset", flags.bools.has("json")))
    return;
  const limit = nonNegOpt(flags, "limit", "megaset", flags.bools.has("json"));
  // the A/B hook (E7): same contract as the HTTP ?search= / MCP search
  // param — but a CLI typo must fail loudly (exit 2, zero work), not
  // silently compare the automatic pick against itself
  const searchRaw = flags.strings.get("search");
  if (searchRaw !== undefined && !isMegasetSearchOverride(searchRaw)) {
    await finishCommandError({
      command: "megaset",
      json: flags.bools.has("json"),
      error: `unknown --search "${searchRaw}" — expected greedy or beam`,
      exitCode: 2,
    });
    return;
  }
  const { megaset: buildMegaset } = await import("./fulltags/megaset");
  await buildMegaset({
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
    [
      "apply",
      "eval",
      "no-duration-guard",
      "diagnostics",
      "artist-disjoint",
      "probe",
      "refold",
      "flag",
      "json",
    ],
  );
  if (nonNegOptInvalid(flags, "k", "genre", flags.bools.has("json"))) return;
  const k = nonNegOpt(flags, "k", "genre", flags.bools.has("json"));

  const minAgreementRaw = flags.strings.get("min-agreement");
  let minAgreement: number | undefined;
  if (minAgreementRaw !== undefined) {
    const parsed = Number(minAgreementRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      await finishCommandError({
        command: "genre",
        json: flags.bools.has("json"),
        error: `--min-agreement must be a number in (0, 1], got "${minAgreementRaw}"`,
        exitCode: 2,
      });
      return;
    }
    minAgreement = parsed;
  }
  // the Tier-0 extensions are eval-mode measurements; on an inference run
  // they are a typo — fail loudly (exit 2, zero work), never silently no-op
  const evalOnly = (["diagnostics", "artist-disjoint", "probe"] as const).find(
    (f) => flags.bools.has(f) && !flags.bools.has("eval"),
  );
  if (evalOnly !== undefined) {
    await finishCommandError({
      command: "genre",
      error: `--${evalOnly} requires --eval`,
      exitCode: 2,
    });
    return;
  }
  const { genre: inferGenre } = await import("./fulltags/genre");
  await inferGenre({
    state,
    apply: flags.bools.has("apply"),
    k,
    minAgreement,
    eval: flags.bools.has("eval"),
    durationGuard: !flags.bools.has("no-duration-guard"),
    diagnostics: flags.bools.has("diagnostics"),
    artistDisjoint: flags.bools.has("artist-disjoint"),
    probe: flags.bools.has("probe"),
    refold: flags.bools.has("refold"),
    flag: flags.bools.has("flag"),
    json: flags.bools.has("json"),
  });
};

const cues: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["limit"], ["force", "dry-run", "json"]);
  if (nonNegOptInvalid(flags, "limit", "cues", flags.bools.has("json"))) return;
  const limit = nonNegOpt(flags, "limit", "cues", flags.bools.has("json"));
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
  // #160 ring 3: setExit is the one mutation point.
  if (!report.ok) setExit(1);
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
  // #160 ring 3: setExit is the one mutation point.
  if (!report.ok) setExit(1);
};

export const ANALYSIS_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  beats,
  mood,
  similar,
  megaset,
  genre,
  cues,
  "gold-report": goldReport,
  regate,
};
