// cli-commands.ts — the fulltags-family verb handlers for the megadj CLI
// (#243: moved from src/cli-commands-tags.ts + src/cli-commands-analysis.ts
// — product command bodies live in their domain dirs; src/ root keeps
// host-kit + census only). FullTags owns tagging AND analysis: the
// tag-enrichment arms (drop/artwork/fetch/audit/tag-check/years/booth-fix)
// and the analysis arms (beats/mood/similar/megaset/genre/cues/regate)
// share one domain, one vote-ladder engine, one ledger family.
import type { CliCommandHandler } from "../cli-dispatch";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
} from "../cli-flags";
import { isMegasetSearchOverride } from "../../cratedeck/shared/types";
import { finishCommandError, setExit, writeJson } from "../shared/cli-output";
import { isSimilarSpace } from "../shared/leaf/vector-space";
import { FETCH_TARGETS, type FetchTarget } from "./fetch/fetch";

const boothFix: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["booth-fix"],
    ["apply", "yes", "dry-run", "json"],
  );
  const { boothFix: fix } = await import("./booth/booth-fix");
  const report = await fix({
    state,
    musicDir,
    dryRun: flags.bools.has("dry-run"),
    apply: flags.bools.has("apply") && flags.bools.has("yes"),
    json: flags.bools.has("json"),
    log: (message) => void console.log(message),
  });
  if (flags.bools.has("json")) {
    await writeJson(report);
    return;
  }

  console.log(
    `booth-fix: ${report.checked} checked, ${report.fixable} fixable, ${report.applied} applied (fleet: ${report.fleet.join(", ")})`,
  );
  for (const row of report.rows) {
    console.log(`  [${row.gate}: ${row.reasons.join(",")}] ${row.plan}`);
    console.log(`    ${row.file}`);
  }
  // #160 ring 3: setExit is the one mutation point.
  if (report.rows.some((row) => row.action === "none")) setExit(1);
};

const drop: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(
    rest,
    ["drop", "target", "max-beat-seconds"],
    ["dry-run", "no-mood", "no-fetch", "ai-fallback", "force-rip", "json"],
  );
  if (
    nonNegOptInvalid(flags, "max-beat-seconds", "drop", flags.bools.has("json"))
  )
    return;
  const maxBeatSeconds = nonNegOpt(
    flags,
    "max-beat-seconds",
    "drop",
    flags.bools.has("json"),
  );
  const target =
    firstPositional(rest, "drop", ["drop", "target", "max-beat-seconds"]) ??
    flags.strings.get("target");
  if (!target) {
    // Usage error → exit 2 class (P1/AGENTS: bad input = exit 2, zero
    // work); json-safe epilogue (#160 ring 3). The drop.test.ts pin
    // asserted exit 1 — usage and command failure are different classes.
    await finishCommandError({
      command: "drop",
      json: flags.bools.has("json"),
      error:
        "pass a folder or URL — megadj drop <folder-or-url> [--dry-run] [--no-mood] [--no-fetch] [--ai-fallback]",
      exitCode: 2,
    });
    return;
  }
  const { drop: dropTarget } = await import("../shared/drop");
  await dropTarget({
    state: context.state,
    musicDir: context.musicDir,
    target,
    dryRun: flags.bools.has("dry-run"),
    noMood: flags.bools.has("no-mood"),
    noFetch: flags.bools.has("no-fetch"),
    aiFallback: flags.bools.has("ai-fallback"),
    forceRip: flags.bools.has("force-rip"),
    maxBeatSeconds,
    json: flags.bools.has("json"),
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
  });
};

const artwork: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["model", "max"], ["dry-run", "json"]);
  if (nonNegOptInvalid(flags, "max", "artwork", flags.bools.has("json")))
    return;
  const { artwork: addArtwork } = await import("./write/artwork");
  await addArtwork({
    state,
    model: flags.strings.get("model"),
    maxImages: nonNegOpt(flags, "max", "artwork", flags.bools.has("json")),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const fetchCommand: CliCommandHandler = async (rest) => {
  const flags = parseFlags(
    rest,
    ["jobs"],
    ["art", "genres", "tags", "years", "all", "ai-fallback", "dry-run", "json"],
  );
  if (nonNegOptInvalid(flags, "jobs", "fetch", flags.bools.has("json"))) return;
  const jobs = nonNegOpt(flags, "jobs", "fetch", flags.bools.has("json"));
  const { fetch } = await import("./fetch/fetch");
  const only: FetchTarget =
    FETCH_TARGETS.find(
      (target) => target !== "all" && flags.bools.has(target),
    ) ?? "all";
  await fetch({
    all: flags.bools.has("all"),
    only,
    jobs,
    aiFallback: flags.bools.has("ai-fallback"),
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const audit: CliCommandHandler = async (rest, { musicDir }) => {
  const { auditArchive } = await import("./fetch/fetch");
  const { auditRowFlags } = await import("./audit-row");
  const report = await auditArchive(musicDir);
  const gaps = report.rows.filter((row) => !row.complete);
  const unplayable = gaps.filter((row) => !row.playable);
  const unreadable = gaps.filter((row) => !row.readable);
  if (rest.includes("--json")) {
    await writeJson({
      ok: gaps.length === 0,
      total: report.total,
      complete: report.complete,
      unplayable: unplayable.map((row) => row.file),
      unreadable: unreadable.map((row) => ({
        file: row.file,
        reasons: row.unreadableReasons,
      })),
      incomplete: gaps.map((row) => ({
        file: row.file,
        missing: auditRowFlags(row),
      })),
    });
    // #160 ring 3: setExit is the one mutation point.
    if (gaps.length) setExit(1);
    return;
  }

  const dimensions =
    "art + title + artist + album + genre + year + mood + energy + player-compat + booth-text";
  console.log(
    `audit: ${report.complete}/${report.total} complete (${dimensions})`,
  );
  if (gaps.length) {
    console.log("\nincomplete:");
    for (const row of gaps)
      console.log(`  [${auditRowFlags(row)}] ${row.file}`);
    setExit(1);
  } else {
    console.log("✅ all tracks fully tagged + booth-playable");
  }
};

const tagCheck: CliCommandHandler = async (rest, { musicDir }) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { walkAudioFiles } = await import("./write/writer");
  const { tagHealth } = await import("./write/tag-health");
  const files = walkAudioFiles(musicDir);
  const bad: { file: string; reasons: string[] }[] = [];
  for (const file of files) {
    const health = tagHealth(file);
    if (!health.ok) bad.push({ file, reasons: health.reasons });
  }
  if (flags.bools.has("json")) {
    // P1 seam (#159): awaited stdout write, one parseable object.
    await writeJson({ ok: bad.length === 0, checked: files.length, bad });
  } else if (bad.length === 0) {
    console.log(
      `✅ tag-check: all ${files.length} files' tags parse clean (structure, text, booth display)`,
    );
  } else {
    console.log(
      `tag-check: ${bad.length} of ${files.length} files have broken/suspect tags:`,
    );
    for (const row of bad)
      console.log(`  [${row.reasons.join(", ")}] ${row.file}`);
    console.log(
      "\nwhat these mean: no-title-artist = identity frames empty; mojibake-* = double-encoded text (fix the spelling and re-stamp); control-bytes-* = invisible junk in frame text; booth-text:* = garbles on a CDJ/XDJ display (see `megadj booth-fix --dry-run`).",
    );
  }
  // #160 ring 3: setExit is the one mutation point.
  if (bad.length) setExit(1);
};

const years: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, [], ["dry-run", "json"]);
  const { runFixYears } = await import("./years");
  await runFixYears({
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

const beats: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["limit", "jobs", "max-seconds"],
    ["force", "dry-run", "json"],
  );
  const json = flags.bools.has("json");
  if (nonNegOptInvalid(flags, "limit", "beats", json)) return;
  const limit = nonNegOpt(flags, "limit", "beats", json);
  if (nonNegOptInvalid(flags, "max-seconds", "beats", json)) return;
  const maxSeconds = nonNegOpt(flags, "max-seconds", "beats", json);
  if (nonNegOptInvalid(flags, "jobs", "beats", json)) return;
  const jobs = nonNegOpt(flags, "jobs", "beats", json);
  const { beats: analyzeBeats } = await import("./analysis/beats");
  await analyzeBeats({
    state,
    musicDir,
    jobs,
    limit,
    force: flags.bools.has("force"),
    dryRun: flags.bools.has("dry-run"),
    json,
    maxSeconds,
  });
};

const mood: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["limit", "jobs"],
    ["force", "dry-run", "json", "embeddings"],
  );
  const json = flags.bools.has("json");
  if (nonNegOptInvalid(flags, "limit", "mood", json)) return;
  const limit = nonNegOpt(flags, "limit", "mood", json);
  if (nonNegOptInvalid(flags, "jobs", "mood", json)) return;
  const jobs = nonNegOpt(flags, "jobs", "mood", json);
  const { mood: analyzeMood } = await import("./analysis/mood");
  await analyzeMood({
    state,
    musicDir,
    jobs,
    limit,
    force: flags.bools.has("force"),
    dryRun: flags.bools.has("dry-run"),
    json,
    embeddings: flags.bools.has("embeddings"),
  });
};

const similar: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["similar", "k", "space"], ["json"]);
  const videoId =
    firstPositional(rest, "similar", ["similar", "k", "space"]) ??
    flags.strings.get("similar");
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
  if (nonNegOptInvalid(flags, "k", "similar", flags.bools.has("json"))) return;
  const k = nonNegOpt(flags, "k", "similar", flags.bools.has("json"));
  const spaceRaw = flags.strings.get("space");
  if (spaceRaw !== undefined && !isSimilarSpace(spaceRaw)) {
    await finishCommandError({
      command: "similar",
      json: flags.bools.has("json"),
      error: `unknown --space "${spaceRaw}" — expected raw or whitened`,
      exitCode: 2,
    });
    return;
  }
  const { similar: findSimilar } = await import("./similar");
  await findSimilar({
    state,
    videoId,
    k,
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
  const { megaset: buildMegaset } = await import("./megaset");
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
    ["k", "min-agreement", "agree", "keep", "note"],
    [
      "apply",
      "eval",
      "no-duration-guard",
      "diagnostics",
      "artist-disjoint",
      "probe",
      "refold",
      "flag",
      "disputes",
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
  // the dispute surface is its own pass — mixing it with the other
  // genre passes is a typo, not a union (same discipline as the
  // eval-only guard above): fail loudly, exit 2, zero work
  const disputeMode =
    flags.bools.has("disputes") ||
    flags.strings.has("agree") ||
    flags.strings.has("keep");
  if (disputeMode) {
    const stray = (
      [
        "eval",
        "refold",
        "flag",
        "diagnostics",
        "artist-disjoint",
        "probe",
      ] as const
    ).find((f) => flags.bools.has(f));
    if (stray !== undefined) {
      await finishCommandError({
        command: "genre",
        json: flags.bools.has("json"),
        error: `--${stray} is a separate pass — dispute review/resolution runs alone`,
        exitCode: 2,
      });
      return;
    }
  }
  const { genre: inferGenre } = await import("./genre/genre");
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
    disputes: flags.bools.has("disputes"),
    agree: flags.strings.get("agree"),
    keep: flags.strings.get("keep"),
    note: flags.strings.get("note"),
    json: flags.bools.has("json"),
  });
};

const cues: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["limit"], ["force", "dry-run", "json"]);
  if (nonNegOptInvalid(flags, "limit", "cues", flags.bools.has("json"))) return;
  const limit = nonNegOpt(flags, "limit", "cues", flags.bools.has("json"));
  const { cues: generateCues } = await import("./cues");
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
    await import("./gold-report");
  const report = await buildReport({
    state,
    json: flags.bools.has("json"),
  });
  if (flags.bools.has("json")) await writeJson(report);
  else printGoldReport(report, console.log);
  // #160 ring 3: setExit is the one mutation point.
  if (!report.ok) setExit(1);
};

const genreWhy: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, [], ["json"]);
  const videoId = firstPositional(rest, "genre-why", []);
  if (!videoId) {
    await finishCommandError({
      command: "genre-why",
      json: flags.bools.has("json"),
      error: "pass a video id — `megadj genre-why <video_id>`",
      exitCode: 2,
    });
    return;
  }
  const { genreWhy: explainGenre } = await import("./genre/genre-why");
  await explainGenre({
    state,
    videoId,
    json: flags.bools.has("json"),
  });
};

const regate: CliCommandHandler = async (rest, { state }) => {
  const flags = parseFlags(rest, ["detector", "gold-dir"], ["json"]);
  const dimension =
    firstPositional(rest, "regate", ["detector", "gold-dir"]) ?? "bpm";
  const detector = flags.strings.get("detector") ?? "ledger";
  const { regate: runRegate } = await import("./regate/regate");
  const report = runRegate(
    state,
    dimension,
    detector,
    flags.strings.get("gold-dir"),
  );
  if (flags.bools.has("json")) await writeJson(report);
  else if (report.unavailable === true) {
    // honest gap (#169): the ledger isn't populated — say so on stdout
    // with the reason and exit 0. Never a manufactured FAIL/PASS.
    console.log(
      `${report.dimension ?? dimension}: unavailable — ${report.error ?? "reference ledger not populated"}`,
    );
  } else {
    console.log(
      `${report.detector}: ${report.gate.passPercent.toFixed(1)}% passed ` +
        `(required ${report.gate.requiredPercent.toFixed(1)}%) — ${report.ok ? "PASS" : "FAIL"}`,
    );
    if (report.error) console.error(`error: ${report.error}`);
  }
  // #160 ring 3: setExit is the one mutation point.
  if (!report.ok) setExit(1);
};

export const FULLTAGS_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  "booth-fix": boothFix,
  drop,
  artwork,
  fetch: fetchCommand,
  audit,
  "tag-check": tagCheck,
  years,
  beats,
  mood,
  similar,
  megaset,
  genre,
  "genre-why": genreWhy,
  cues,
  "gold-report": goldReport,
  regate,
};
