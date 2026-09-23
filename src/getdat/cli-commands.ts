// cli-commands.ts — the getdat-family verb handlers for the megadj CLI
// (#243: moved from src/cli-commands-core.ts — product command bodies
// live in their domain dirs; src/ root keeps host-kit + census only).
//
// doctor/init ride here too: they are the toolkit's lifecycle commands
// (registry group "cratedeck") with no domain of their own, and their
// arms keep doctor's probes LAZY (dynamic import) so a plain
// `megadj status` never pays the diagnostics module graph at boot.
//
// Flags go through cli-flags.ts (`parseFlags`/`nonNegOpt`/
// `nonNegOptInvalid`/`firstPositional`) — the sanctioned parser; bad
// numeric input = json-safe exit 2, zero work.
import type { OrganizeOptions } from "./commands/organize";
import { sync, type PlaylistSource } from "./commands/sync";
import { SC_SOURCE, isSoundCloudUrl, scSourceKindFor } from "./soundcloud";
import { RateLimiter } from "./ratelimit";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
  positionalArgs,
  repeatedOf,
} from "../cli-flags";
import type { CliCommandHandler } from "../cli-dispatch";
import { isLowq } from "./commands/upgrade";
import { storageReport, printStorageReport } from "../shared/storage";
import type { ArchiveState } from "../core/state";
import type { TrackRow } from "../core/state-types";
import {
  writeJson,
  writeJsonText,
  finishCommandError,
  setExit,
} from "../shared/cli-output";

const doctor: CliCommandHandler = async (rest) => {
  const flags = parseFlags(rest, [], ["json"]);
  const { runDoctor, printDoctor, doctorJson } =
    await import("../shared/doctor");
  // The deck-service check is async (launchctl + an HTTP probe) — run it
  // alongside the sync checks and append so both output formats carry it.
  const { checkDeckService } = await import("../shared/doctor-checks");
  const [results, deckCheck] = await Promise.all([
    Promise.resolve(runDoctor()),
    checkDeckService(),
  ]);
  results.push(deckCheck);
  if (flags.bools.has("json")) {
    await writeJsonText(doctorJson(results));
    // #160 ring 3: setExit is the one mutation point.
    setExit(results.some((check) => !check.ok && check.required) ? 1 : 0);
  } else {
    setExit(printDoctor(results));
  }
};

const init: CliCommandHandler = async () => {
  const { runInit } = await import("../shared/doctor");
  setExit(runInit());
};

const syncCommand: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(
    rest,
    ["limit", "sources", "target-total", "sc-url"],
    ["dry-run", "music-only", "json", "force-rip", "repair-identity"],
  );
  const limiter = new RateLimiter({
    onPace: (ms) =>
      process.stderr.write(`  (pacing ${Math.round(ms / 100) / 10}s)\n`),
    onBackoff: (attempt, ms, reason) =>
      process.stderr.write(
        `  (backoff #${attempt}: ${(ms / 1000).toFixed(1)}s — ${reason.slice(0, 60)})\n`,
      ),
  });
  if (nonNegOptInvalid(flags, "limit", "sync", flags.bools.has("json"))) return;
  const limit = nonNegOpt(flags, "limit", "sync", flags.bools.has("json"));
  if (nonNegOptInvalid(flags, "target-total", "sync", flags.bools.has("json")))
    return;
  const targetTotal = nonNegOpt(
    flags,
    "target-total",
    "sync",
    flags.bools.has("json"),
  );

  // #255/--sc-url: a direct SoundCloud URL (single track or set) becomes
  // the run's only source — user-directed intake through the ledgered,
  // rate-limited path. Validated BEFORE any state write (zero work on
  // bad input): a non-SC URL is an exit-2 usage error.
  let sources = buildSources(flags.strings.get("sources"));
  const scUrl = flags.strings.get("sc-url");
  if (scUrl !== undefined) {
    if (!isSoundCloudUrl(scUrl)) {
      await finishCommandError({
        command: "sync",
        json: flags.bools.has("json"),
        error: `--sc-url wants a soundcloud.com URL, got: ${scUrl}`,
        exitCode: 2,
      });
      return;
    }
    sources = [{ kind: "sc-track", url: scUrl, label: SC_SOURCE }];
  }
  // Repeatable --sc-url (Sep 21): parseFlags is last-wins, so four
  // `--sc-url` playlists synced only the fourth. Each URL is classed by
  // SHAPE — a /sets/<slug> page is a SET (fan-out + per-set provenance),
  // anything else a single track.
  const scUrls = repeatedOf(rest, "sc-url");
  if (scUrls.length > 0) {
    const bad = scUrls.find((u) => !isSoundCloudUrl(u));
    if (bad !== undefined) {
      await finishCommandError({
        command: "sync",
        json: flags.bools.has("json"),
        error: `--sc-url wants a soundcloud.com URL, got: ${bad}`,
        exitCode: 2,
      });
      return;
    }
    sources = scUrls.map((u) => ({
      kind: scSourceKindFor(u),
      url: u,
      label: SC_SOURCE,
    }));
  }
  await sync({
    state: context.state,
    limiter,
    musicDir: context.musicDir,
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
    limit,
    dryRun: flags.bools.has("dry-run"),
    musicOnly: flags.bools.has("music-only"),
    targetTotal,
    sources,
    forceRip: flags.bools.has("force-rip"),
    repairIdentity: flags.bools.has("repair-identity"),
    json: flags.bools.has("json"),
  });
};

/** "--sources LM,LL,sc-user:jones" → the tagged union (#255/#257). YT
 *  playlist ids stay first-class; the sc-user:/sc-likes: forms carry the
 *  channel name (public pages; likes additionally need cookies). */
function buildSources(raw: string | undefined): PlaylistSource[] {
  return (raw ?? "LM")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean)
    .map((id): PlaylistSource => {
      if (id === "LM") return { kind: "ytm-playlist", id, label: "liked" };
      if (id === "LL")
        return { kind: "ytm-playlist", id, label: "liked-videos" };
      if (id.startsWith("sc-user:")) {
        const name = id.slice("sc-user:".length).replace(/^@/, "").trim();
        return {
          kind: "sc-user",
          url: `https://soundcloud.com/${name}/tracks`,
          label: SC_SOURCE,
        };
      }
      if (id.startsWith("sc-likes:")) {
        const name = id.slice("sc-likes:".length).replace(/^@/, "").trim();
        return {
          kind: "sc-likes",
          url: `https://soundcloud.com/${name}/likes`,
          label: SC_SOURCE,
        };
      }
      return { kind: "ytm-playlist", id, label: id };
    });
}

const statusCommand: CliCommandHandler = async (rest, { state }) => {
  if (rest.includes("--json")) await statusJson(state);
  else status(state);
};

const list: CliCommandHandler = async (rest, { state }) => {
  const filter = rest.find((arg) => !arg.startsWith("--"));
  if (rest.includes("--json")) await listJson(state, filter);
  else listTracks(state, filter);
};

const retry: CliCommandHandler = async (rest, { state }) => {
  state.resetFailures();
  if (rest.includes("--json")) {
    await writeJson({ command: "retry", reset: true });
  } else {
    console.log("failure counters reset — run `megadj sync` to retry");
  }
};

// `megadj skip <id|permalink…>` (Sep 19): user-mark rows as not-YouTube-
// music so sync's download queue never picks them. Terminal, sticky
// across playlist refreshes; reversible only by hand (unskip = the
// retry family does not resurrect a deliberate skip).
const skip: CliCommandHandler = async (rest, { state }) => {
  const json = rest.includes("--json");
  const positional = positionalArgs(
    rest.filter((a) => a !== "--json"),
    [],
  );
  if (positional.length === 0) {
    await finishCommandError({
      command: "skip",
      json,
      error: "usage: megadj skip <video_id|permalink> […] [--json]",
      exitCode: 2,
    });
    return;
  }
  const marked: string[] = [];
  const unknown: string[] = [];
  for (const id of positional) {
    if (state.markNotMusicByUser(id)) marked.push(id);
    else unknown.push(id);
  }
  if (json) {
    await writeJson({ command: "skip", marked, unknown, count: marked.length });
  } else {
    for (const id of marked) console.log(`  ✓ skipped (not music): ${id}`);
    for (const id of unknown) console.log(`  ✗ unknown id: ${id}`);
    const unknownNote = unknown.length > 0 ? `, ${unknown.length} unknown` : "";
    console.log(`skipped ${marked.length} row(s)${unknownNote}`);
  }
  if (unknown.length > 0 && marked.length === 0) setExit(1);
};

const surfacedNote: CliCommandHandler = async (rest, { state }) => {
  const json = rest.includes("--json");
  const done = !rest.includes("--undone");
  const positional = positionalArgs(
    rest.filter((a) => a !== "--json" && a !== "--undone"),
    [],
  );
  if (positional.length === 0) {
    await finishCommandError({
      command: "surfaced-note",
      json,
      error:
        "usage: megadj surfaced-note <video_id> […] [--undone] [--json] — check the surfaced link off once its file is saved in the downloads folder",
      exitCode: 2,
    });
    return;
  }
  const marked: string[] = [];
  const unknown: string[] = [];
  for (const id of positional) {
    if (state.markSurfacedDoneExists(id)) {
      state.markSurfacedDone(id, done);
      marked.push(id);
    } else unknown.push(id);
  }
  if (json) {
    await writeJson({
      command: "surfaced-note",
      done,
      marked,
      unknown,
      count: marked.length,
    });
  } else {
    for (const id of marked)
      console.log(`  ${done ? "✓" : "○"} ${done ? "done" : "reopened"}: ${id}`);
    for (const id of unknown) console.log(`  ✗ unknown/not-surfaced id: ${id}`);
  }
  if (unknown.length > 0 && marked.length === 0) setExit(1);
};

const organizeOrEnrich =
  (command: "organize" | "enrich"): CliCommandHandler =>
  async (rest, { state, musicDir }) => {
    const flags = parseFlags(rest, [], ["dry-run", "json"]);
    const mod: Record<
      "organize" | "enrich",
      (options: OrganizeOptions) => Promise<void>
    > = await import(
      command === "organize"
        ? "./commands/organize"
        : "../fulltags/fetch/enrich"
    );
    await mod[command]({
      state,
      musicDir,
      dryRun: flags.bools.has("dry-run"),
      json: flags.bools.has("json"),
    });
  };

const adopt: CliCommandHandler = async (rest, { state, musicDir }) => {
  const { adopt: adoptLocal, adoptFromShelf } =
    await import("./commands/adopt");
  const json = rest.includes("--json");
  if (rest.includes("--shelf")) {
    await adoptFromShelf({
      state,
      musicDir,
      json,
      shelf: true,
      dryRun: !rest.includes("--apply"),
    });
    return;
  }
  await adoptLocal({ state, musicDir, json });
};

const ingest: CliCommandHandler = async (rest, { state, musicDir }) => {
  const flags = parseFlags(
    rest,
    ["ingest", "folder", "min-duration"],
    ["dry-run", "no-artwork", "json"],
  );
  const folder =
    firstPositional(rest, "ingest", ["ingest", "folder", "min-duration"]) ??
    flags.strings.get("folder");
  if (!folder) {
    await finishCommandError({
      command: "ingest",
      json: flags.bools.has("json"),
      error: "pass a folder — megadj ingest <folder> [--dry-run]",
      exitCode: 2,
    });
    return;
  }
  // nonNegOpt is the sanctioned numeric seam: negative/empty/non-numeric
  // input = json-safe exit-2 epilogue, zero work. The hand-rolled
  // Number()+isFinite pair let "-30" and "" slip through as 0 (and a
  // bare Number("-30") is finite, so the old guard never fired).
  if (
    nonNegOptInvalid(flags, "min-duration", "ingest", flags.bools.has("json"))
  )
    return;
  const minDuration = nonNegOpt(
    flags,
    "min-duration",
    "ingest",
    flags.bools.has("json"),
  );
  const { ingest: ingestFolder } = await import("./commands/ingest");
  await ingestFolder({
    state,
    musicDir,
    folder,
    dryRun: flags.bools.has("dry-run"),
    noArtwork: flags.bools.has("no-artwork"),
    minDuration,
    json: flags.bools.has("json"),
  });
};

const upgrade: CliCommandHandler = async (rest, context) => {
  const flags = parseFlags(rest, ["limit"], ["dry-run", "json"]);
  if (nonNegOptInvalid(flags, "limit", "upgrade", flags.bools.has("json")))
    return;
  const limit = nonNegOpt(flags, "limit", "upgrade", flags.bools.has("json"));
  const { upgrade: upgradeTracks } = await import("./commands/upgrade");
  await upgradeTracks({
    state: context.state,
    musicDir: context.musicDir,
    cookiesFromBrowser: context.cookies || null,
    cookiesFile: context.cookiesFile,
    limit,
    dryRun: flags.bools.has("dry-run"),
    json: flags.bools.has("json"),
  });
};

export const GETDAT_COMMANDS: Readonly<Record<string, CliCommandHandler>> = {
  doctor,
  init,
  sync: syncCommand,
  status: statusCommand,
  list,
  retry,
  skip,
  "surfaced-note": surfacedNote,
  organize: organizeOrEnrich("organize"),
  enrich: organizeOrEnrich("enrich"),
  adopt,
  ingest,
  upgrade,
};

/** One archive summary — both the human and --json renderers read this,
 * so the two surfaces can never drift apart. */
function summary(state: ArchiveState) {
  const counts = state.statusCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const all = state.allTracks();
  const downloaded = all.filter((t) => t.status === "downloaded");
  const bytes = downloaded.reduce((a, t) => a + (t.file_size_bytes ?? 0), 0);
  // The HIGHQ bar IS isLowq (SSOT: upgrade.ts's floor, mirrored by
  // CrateDeck's lowqQueue SQL) — never hand-roll a second bar here.
  // Unprobed rows (null bitrate) count as high-Q, honest gap.
  const highQ = downloaded.filter((t) => t.bitrate_kbps === null || !isLowq(t));
  // #256: the "go get these properly" queue — links surfaced instead of
  // rips. Its own cohort, never folded into downloaded counts.
  const surfaced = all.filter((t) => t.status === "link_surfaced");
  return {
    total,
    counts,
    downloadedCount: downloaded.length,
    bytes,
    highQ: highQ.length,
    surfacedLinks: surfaced.length,
    runs: state.lastRuns(5),
  };
}

export function status(state: ArchiveState): void {
  const s = summary(state);
  const storage = storageReport(state);
  console.log("megadj archive status");
  console.log("=====================");
  console.log(`total tracks tracked: ${s.total}`);
  for (const [st, n] of Object.entries(s.counts)) {
    console.log(`  ${st.padEnd(20)} ${n}`);
  }
  console.log(`\narchive size: ${(s.bytes / 1e9).toFixed(2)} GB`);
  console.log(
    `high-quality tracks (isLowq floor — SC 160k/128k, YT 256k/320k — or unprobed): ${s.highQ}/${s.downloadedCount}`,
  );
  if (s.surfacedLinks > 0) {
    console.log(
      `links surfaced (go through them instead of ripping): ${s.surfacedLinks} — megadj list --status link_surfaced`,
    );
  }
  if (s.runs.length > 0) {
    console.log("\nrecent runs:");
    for (const run of s.runs) {
      const when = run.started_at.slice(0, 16).replace("T", " ");
      console.log(
        `  ${when}  attempted=${run.attempted} downloaded=${run.downloaded} gone=${run.gone} failed=${run.failed} ${(run.bytes_downloaded / 1e6).toFixed(0)}MB`,
      );
    }
  }
  printStorageReport(storage, console.log);
}

export async function statusJson(state: ArchiveState): Promise<void> {
  const s = summary(state);
  const report = storageReport(state);
  await writeJson({
    total_tracks: s.total,
    by_status: s.counts,
    archive_bytes: s.bytes,
    high_quality: { count: s.highQ, of: s.downloadedCount },
    links_surfaced: s.surfacedLinks,
    recent_runs: s.runs,
    storage: report.storage,
    ledger_freshness: report.ledgerFreshness,
  });
}

function filterTracks(state: ArchiveState, filter?: string) {
  const tracks = state.allTracks();
  return filter
    ? tracks.filter(
        (t) =>
          t.status === filter ||
          (t.title ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          (t.artist ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : tracks;
}

function flagOf(t: TrackRow): string {
  // The LOWQ flag IS isLowq (SSOT — same floor as highQ above and
  // CrateDeck's lowqQueue); unprobed rows never flag (honest gap).
  return t.status === "downloaded"
    ? t.bitrate_kbps !== null && isLowq(t)
      ? "LOWQ"
      : "ok  "
    : t.status === "link_surfaced"
      ? "LINK" // #256: rip skipped on purpose — an official link exists
      : t.status === "gone"
        ? "GONE"
        : t.status === "failed"
          ? "FAIL"
          : "wait";
}

export function listTracks(state: ArchiveState, filter?: string): void {
  const tracks = filterTracks(state, filter);
  for (const t of tracks) {
    console.log(
      `${flagOf(t)}  ${(t.title ?? t.video_id).slice(0, 50).padEnd(52)} ${t.status === "downloaded" && t.format_id ? `f${t.format_id}` : ""}`,
    );
    // #256: a surfaced row carries its acquisition link on the next line —
    // the whole point is the user goes through it.
    if (t.status === "link_surfaced") {
      const detail = t.last_error ?? "";
      if (detail) console.log(`      ↳ ${detail.slice(0, 100)}`);
    }
  }
  console.log(`\n${tracks.length} track(s)`);
}

export async function listJson(
  state: ArchiveState,
  filter?: string,
): Promise<void> {
  const tracks = filterTracks(state, filter);
  await writeJson({ count: tracks.length, tracks });
}
