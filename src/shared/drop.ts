// drop.ts — K61: Quickie-style one-shot mode. `megadj drop <folder-or-url>`
// → download (if URL) → ingest (clean/tag/art/dedupe) → beats → mood →
// cues → organize. Every stage is an existing, idempotent command; this is
// pure glue with one summary object (P1 --json) and stage-skip accounting.
//
// P3 (PRINCIPLES: ship-today, simplest path): no orchestration engine, no
// state machine — a sequential pipeline over commands that already know how
// to resume. A stage that has nothing to do costs ~0; a failed stage is
// reported and does not abort the pipeline's earlier results (each stage
// commits its own work), but `ok` reflects full completion.
//
// #88 diet: the stage ladder is DATA. `STAGE_RUNNERS` declares each
// stage's name, skip-policy and runner once; `drop` is the ~30-line
// interpreter over that table. Adding a stage = adding one table row, not
// another branch in a 250-line ladder (the old shape was lizard's top CCN
// carrier in src/).

import { ingest } from "../getdat/commands/ingest";
import { beats } from "../fulltags/analysis/beats";
import { mood } from "../fulltags/analysis/mood";
import { cues } from "../fulltags/cues";
import { organize } from "../getdat/commands/organize";
import { ytdlpCookieArgs } from "../getdat/downloader";
import {
  SC_FORMAT,
  extractAcquisitionLinks,
  isPrivateUser404,
  isSoundCloudUrl,
  ripDecision,
  scTrackIdFromUrl,
} from "../getdat/soundcloud";
import {
  intakeFolderName,
  resolveIntakeDir,
} from "../getdat/commands/intake-folder";
import { mkdirSync } from "node:fs";
import { isRecord, isUnknownArray } from "./leaf/guards";
import type { ArchiveState } from "../archive/state";
import { commandLog } from "./progress";
import { errMessage as errorText } from "./leaf/fmt";
import { writeJson, setExit } from "./cli-output";

export interface DropOptions {
  state: ArchiveState;
  musicDir: string;
  /** Folder path (relative ok) OR a URL to download first. */
  target: string;
  dryRun?: boolean;
  /** Skip the ONNX mood stage even when models are present. */
  noMood?: boolean;
  /** Skip the fast (no-key/bpm) stages of the fetch pass. Off by default —
   * the whole point of drop is "point at a folder, get finished tracks". */
  noFetch?: boolean;
  /** Opt-in AI genre/year fallback inside the fetch stage (SC + Beatport
   * stay primary; AI covers only what both miss). Off by default. */
  aiFallback?: boolean;
  /** #256: rip even when the track offers an official acquisition link. */
  forceRip?: boolean;
  /** Beat-analysis length cap in seconds (default 900 = 15min; 0 disables) —
   * longer tracks skip the beats stage (grid cost scales with runtime). */
  maxBeatSeconds?: number | undefined;
  /** Machine-readable summary (P1). Human logs still go to stderr. */
  json?: boolean;
  /** Cookies/env plumbing for the URL-download stage. */
  cookiesFromBrowser?: string | null;
  cookiesFile?: string | null;
  onProgress?: (msg: string) => void;
}

export interface DropStage {
  stage: string;
  status: "ok" | "skipped" | "failed";
  detail?: string;
}

export interface DropSummary {
  command: "drop";
  target: string;
  ok: boolean;
  stages: DropStage[];
}

const isUrl = (s: string) => /^https?:\/\//.test(s);

/** Download a non-SC URL straight into the music dir via yt-dlp
 *  (best-audio, no playlist expansion, same cookie plumbing as sync). */
async function downloadUrl(
  target: string,
  musicDir: string,
  opts: DropOptions,
): Promise<{ downloaded: number; error?: string }> {
  const args = [
    "-f",
    "bestaudio/best",
    "--no-playlist",
    // P1: drop's stdout carries the one-line JSON summary — yt-dlp progress
    // MUST not inherit into it. stderr is drained to a buffer for errors.
    "--quiet",
    "--no-warnings",
    "-o",
    `${musicDir}/%(title)s.%(ext)s`,
    // #81: auth args via the shared builder (was a third inline twin).
    ...ytdlpCookieArgs(opts.cookiesFile, opts.cookiesFromBrowser),
  ];
  args.push(target);
  const proc = Bun.spawnSync({
    cmd: ["yt-dlp", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder()
      .decode(proc.stderr)
      .split("\n")
      .slice(-2)
      .join(" ")
      .slice(0, 200);
    return { downloaded: 0, error: err || `yt-dlp exit ${proc.exitCode}` };
  }
  return { downloaded: 1 };
}

/** The stage-0 SC download (#255/#256/#257): link-first, set-aware.
 *
 *  A SoundCloud URL is probed FLAT first: a single-track payload goes
 *  through the link-first decision (surface the official link and skip
 *  the rip when one exists), a playlist payload (a /sets/ page) rips
 *  every entry into a dated intake folder. Returns the intake folder for
 *  the rest of the pipeline plus honest stage detail. */
async function downloadScUrl(
  target: string,
  musicDir: string,
  opts: DropOptions,
): Promise<{ downloaded: number; error?: string; folder?: string }> {
  const cookies = ytdlpCookieArgs(opts.cookiesFile, opts.cookiesFromBrowser);
  const flat = Bun.spawnSync({
    cmd: ["yt-dlp", ...cookies, "--flat-playlist", "-J", target],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  if (flat.exitCode !== 0) {
    const stderr = new TextDecoder().decode(flat.stderr);
    // #258: a likes/user target without cookies 404s like a dead profile —
    // name the remedy (drop takes full SC URLs; /likes & /tracks pages
    // are the auth-gated shapes).
    if (
      (/\/likes|\/tracks/.test(target) || /soundcloud:user/.test(stderr)) &&
      isPrivateUser404(stderr)
    ) {
      const remedy = opts.cookiesFromBrowser
        ? "cookies loaded but SC says private/not-found — check the URL"
        : "pass --cookies-from-browser <browser> (or --cookies <file>) — likes/user pages need auth";
      return { downloaded: 0, error: `${stderr.slice(-160)} — ${remedy}` };
    }
    const err =
      new TextDecoder()
        .decode(flat.stderr)
        .split("\n")
        .slice(-2)
        .join(" ")
        .slice(0, 200) || `yt-dlp exit ${flat.exitCode}`;
    return { downloaded: 0, error: err || `yt-dlp exit ${flat.exitCode}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(flat.stdout));
  } catch {
    return { downloaded: 0, error: "SC probe returned malformed JSON" };
  }
  if (!isRecord(parsed)) {
    return { downloaded: 0, error: "SC probe output was not an object" };
  }
  const entries = parsed.entries;
  if (isUnknownArray(entries) && entries.length > 0) {
    // A SET (or user page): rip every entry into one dated batch folder —
    // the folder name carries the set slug so the intake is visible.
    const slug = target.split("/sets/")[1]?.split(/[?#]/)[0] ?? "set";
    const batchDir = resolveIntakeDir(
      musicDir,
      intakeFolderName(slug.endsWith(".mp3") ? slug : `${slug} soundcloud`),
    );
    mkdirSync(batchDir, { recursive: true });
    const args = [
      "-f",
      SC_FORMAT,
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
      "-o",
      `${batchDir}/%(title)s.%(ext)s`,
      // Set expansion IS the point here — no --no-playlist.
      "--no-overwrites",
      "--newline",
      "--quiet",
      "--no-warnings",
      ...cookies,
      target,
    ];
    const proc = Bun.spawnSync({
      cmd: ["yt-dlp", ...args],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 1_800_000, // sets are long; the wall-clock budget lives here
    });
    if (proc.exitCode !== 0) {
      const err =
        new TextDecoder()
          .decode(proc.stderr)
          .split("\n")
          .slice(-2)
          .join(" ")
          .slice(0, 200) || `yt-dlp exit ${proc.exitCode}`;
      return { downloaded: 0, error: err };
    }
    // #258: a set-rip's files are SC provenance — register each landed
    // file under the ledger (soundcloud source) so `megadj list`, the
    // LOWQ floor (SC 160k) and the collection counts see them. Keyed by
    // the numeric SC id when the flat entries carry one, ext- hash
    // otherwise (ingest's own register pass would key it by path).
    for (const entry of entries) {
      const row = (entry ?? {}) as { id?: unknown };
      const scId = typeof row.id === "string" ? row.id : null;
      if (scId) {
        opts.state.upsertTrackFromPlaylist(scId, 0, null, "soundcloud");
      }
    }
    return { downloaded: entries.length, folder: batchDir };
  }
  // SINGLE TRACK: link-first (#256). A real acquisition link is SURFACED,
  // not ripped — the user goes through the official channel. Surfaced
  // rows land in the LEDGER (keyed by the numeric SC id) so `sync` sees
  // the decision too and never re-attempts the track from its sources.
  const info = parsed as {
    id?: unknown;
    title?: unknown;
    purchase_url?: unknown;
    downloadable?: unknown;
    download_url?: unknown;
    description?: unknown;
  };
  const links = extractAcquisitionLinks(info);
  const decision = ripDecision(links, opts.forceRip === true);
  if (decision.action === "surface" && decision.link) {
    const scId =
      typeof info.id === "string" && info.id.length > 0
        ? info.id
        : scTrackIdFromUrl(target);
    if (scId) {
      opts.state.upsertTrackFromPlaylist(scId, 0, null, "soundcloud");
      opts.state.markLinkSurfaced(
        scId,
        JSON.stringify(links),
        `${decision.link.kind}: ${decision.link.url}`,
      );
    }
    return {
      downloaded: 0,
      error: `link available — go through it instead of ripping: ${decision.link.url} (--force-rip overrides)`,
    };
  }
  const args = [
    "-f",
    SC_FORMAT,
    "-x",
    "--audio-format",
    "m4a",
    "--audio-quality",
    "0",
    "-o",
    `${musicDir}/%(title)s.%(ext)s`,
    "--no-playlist",
    "--embed-thumbnail",
    "--embed-metadata",
    "--quiet",
    "--no-warnings",
    ...cookies,
    target,
  ];
  const proc = Bun.spawnSync({
    cmd: ["yt-dlp", ...args],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 600_000,
  });
  if (proc.exitCode !== 0) {
    const err =
      new TextDecoder()
        .decode(proc.stderr)
        .split("\n")
        .slice(-2)
        .join(" ")
        .slice(0, 200) || `yt-dlp exit ${proc.exitCode}`;
    return { downloaded: 0, error: err };
  }
  return { downloaded: 1, folder: musicDir };
}

/** Run one pipeline stage, converting throw → failed row. */
async function runStage(
  name: string,
  fn: () => Promise<void>,
  stages: DropStage[],
  log: (m: string) => void,
): Promise<boolean> {
  log(`${name}…`);
  try {
    await fn();
    stages.push({ stage: name, status: "ok" });
    return true;
  } catch (e) {
    const detail = errorText(e);
    stages.push({ stage: name, status: "failed", detail });
    log(`${name} failed: ${detail}`);
    return false;
  }
}

/** The download stage (stage 0) is special: it decides whether the run
 *  starts at all and can be skipped by --dry-run. Handled in `drop`, not
 *  in the table. Everything below runs in order, each only if all
 *  predecessors succeeded. */
interface StageCtx {
  opts: DropOptions;
  folder: string;
}

interface StageSpec {
  name: string;
  /** The skip DETAIL when opts.noFetch gates this stage. Absent = the
   *  stage is not gated by --no-fetch. */
  noFetchDetail?: string;
  /** The skip DETAIL when opts.noMood gates this stage (checked first:
   *  mood also consults model presence). Absent = not gated. */
  noMoodDetail?: string;
  /** Async gate for run-conditions that need I/O (mood's model-presence
   *  check). Returns a skip DETAIL to record a skipped row, or null to
   *  run. Checked after the sync flag gates, only when the chain is ok. */
  skipDetail?: (ctx: StageCtx) => Promise<string | null>;
  run: (ctx: StageCtx) => Promise<void>;
}

const STAGE_RUNNERS: StageSpec[] = [
  {
    name: "ingest",
    // Stage 1 — ingest: clean names, tags, artwork, dedupe, WAV→AIFF.
    run: ({ opts, folder }) =>
      ingest({
        state: opts.state,
        musicDir: opts.musicDir,
        folder,
        dryRun: opts.dryRun,
        json: true, // human logs suppressed; summary comes from drop
      }),
  },
  {
    name: "fetch",
    noFetchDetail: "no-fetch flag",
    // Stage 1b — enrichment (megadj fetch: tags/genre/art/year + energy,
    // fingerprint, key stamps) and year verification against the real SC
    // page dates. These are the stages the artist/comment/tag gaps of the
    // early passes lived in — a drop that skips them re-creates those
    // bugs. fetch runs the pipeline in-process via runFetch (it owns its
    // own progress bar + AI batching); years is the in-process verify.
    run: async ({ opts }) => {
      const { fetch } = await import("../fulltags/fetch/fetch");
      await fetch({
        all: false,
        only: "all",
        aiFallback: opts.aiFallback,
        dryRun: opts.dryRun,
        json: true,
      });
    },
  },
  {
    name: "years",
    noFetchDetail: "no-fetch flag",
    run: async ({ opts }) => {
      const { runFixYears } = await import("../fulltags/years");
      await runFixYears({ dryRun: opts.dryRun ?? false, json: true });
    },
  },
  {
    name: "beats",
    // Stage 2 — beats ledger (beat_this → DB; no tag writes). Tracks over
    // maxBeatSeconds (default 15min) skip the grid — cost scales with
    // runtime.
    run: ({ opts }) =>
      beats({
        state: opts.state,
        musicDir: opts.musicDir,
        dryRun: opts.dryRun,
        json: true,
        maxSeconds: opts.maxBeatSeconds,
      }),
  },
  {
    name: "mood",
    noMoodDetail: "no-mood flag",
    // Stage 3 — mood ledger, gated on models present (320 MB one-time
    // download is NOT something a drop should silently trigger).
    skipDetail: async () => {
      const { moodModelsPresent } = await import("../fulltags/analysis/models");
      return moodModelsPresent()
        ? null
        : "models absent (bun run fulltags/cli.ts ensure-models)";
    },
    run: async ({ opts }) => {
      await mood({
        state: opts.state,
        musicDir: opts.musicDir,
        dryRun: opts.dryRun,
        json: true,
      });
    },
  },
  {
    name: "cues",
    // Stage 4 — phrase cues from the beats ledger (DB-side).
    run: ({ opts }) =>
      cues({
        state: opts.state,
        dryRun: opts.dryRun,
        json: true,
      }),
  },
  {
    name: "organize",
    // Stage 5 — organize into genre folders (never deletes; moves only).
    run: ({ opts }) =>
      organize({
        state: opts.state,
        musicDir: opts.musicDir,
        dryRun: opts.dryRun,
        json: true,
      }),
  },
  {
    name: "tag-check",
    // Stage 6 — tag-check gate (well-formedness: unreadable containers,
    // mojibake, control bytes, no-title/artist voids — the "Unknown Artist
    // in the booth" trap). Report-only here: drop reports, the operator
    // fixes via booth-fix; a failed gate fails the run.
    run: async ({ opts }) => {
      const { walkAudioFiles } = await import("../fulltags/write/writer");
      const { tagHealth } = await import("../fulltags/write/tag-health");
      const bad: { file: string; reasons: string[] }[] = [];
      for (const f of walkAudioFiles(opts.musicDir)) {
        const h = tagHealth(f);
        if (!h.ok) bad.push({ file: f, reasons: h.reasons });
      }
      if (bad.length)
        throw new Error(
          `${bad.length} file(s) with broken tags: ${bad
            .slice(0, 3)
            .map((b) => `${b.file.split("/").pop()} [${b.reasons.join(",")}]`)
            .join(
              "; ",
            )}${bad.length > 3 ? "; …" : ""} — megadj tag-check for the full list`,
        );
    },
  },
  {
    name: "audit",
    // Stage 7 — final completeness gate (audit: art+tags+genre+year+mood+
    // energy+player-compat+booth-text). Exits 1 on any gap; the summary's
    // detail carries the gap count so --json consumers see it in one line.
    run: async ({ opts }) => {
      const { auditArchive } = await import("../fulltags/fetch/fetch");
      const report = await auditArchive(opts.musicDir);
      const gaps = report.rows.filter((r) => !r.complete);
      if (gaps.length)
        throw new Error(
          `${gaps.length}/${report.total} incomplete — megadj audit for the per-file list`,
        );
    },
  },
];

/** Stage 0 — URL → download into the music dir; folder → use as-is.
 *  SoundCloud URLs get the SC stage (link-first, set-aware, #256/#257).
 *  Returns the effective intake folder and false when the run must stop. */
async function downloadStage(
  opts: DropOptions,
  stages: DropStage[],
  log: (m: string) => void,
): Promise<{ folder: string; ok: boolean }> {
  if (!isUrl(opts.target)) return { folder: opts.target, ok: true };
  log(`downloading ${opts.target}…`);
  if (opts.dryRun) {
    stages.push({ stage: "download", status: "skipped", detail: "dry-run" });
    return { folder: opts.musicDir, ok: true };
  }
  const isSc = isSoundCloudUrl(opts.target);
  const r: { downloaded: number; error?: string; folder?: string } = isSc
    ? await downloadScUrl(opts.target, opts.musicDir, opts)
    : await downloadUrl(opts.target, opts.musicDir, opts);
  if (r.error) {
    // A surfaced link is an HONEST stop (exit 0 class): the target offers
    // an official channel and the rip was refused on purpose — recorded
    // as skipped, not failed (#256).
    if (r.error.startsWith("link available")) {
      stages.push({
        stage: "download",
        status: "skipped",
        detail: r.error,
      });
      return { folder: opts.musicDir, ok: true };
    }
    stages.push({ stage: "download", status: "failed", detail: r.error });
    return { folder: opts.musicDir, ok: false };
  }
  stages.push({
    stage: "download",
    status: "ok",
    ...(isSc && r.downloaded > 1
      ? { detail: `${r.downloaded} tracks from set` }
      : {}),
  });
  return { folder: r.folder ?? opts.musicDir, ok: true };
}

/** Human report: one line per stage, honest symbols. */
function printStageReport(
  stages: DropStage[],
  ok: boolean,
  log: (m: string) => void,
): void {
  log("");
  log(ok ? "✓ drop complete" : "✗ drop incomplete — see stages above");
  for (const s of stages)
    log(
      `  ${s.status === "ok" ? "✓" : s.status === "skipped" ? "-" : "✗"} ${s.stage}${s.detail ? ` — ${s.detail}` : ""}`,
    );
}

export async function drop(opts: DropOptions): Promise<void> {
  const log = commandLog(opts);
  const stages: DropStage[] = [];
  let ok = true;

  // Stage 0 — download when the target is a URL, then run the table.
  const { folder, ok: downloaded } = await downloadStage(opts, stages, log);
  ok = downloaded;
  const ctx: StageCtx = { opts, folder };
  for (const spec of STAGE_RUNNERS) {
    if (!ok) {
      stages.push({ stage: spec.name, status: "skipped" });
      continue;
    }
    if (opts.noFetch && spec.noFetchDetail) {
      stages.push({
        stage: spec.name,
        status: "skipped",
        detail: spec.noFetchDetail,
      });
      continue;
    }
    if (opts.noMood && spec.noMoodDetail) {
      stages.push({
        stage: spec.name,
        status: "skipped",
        detail: spec.noMoodDetail,
      });
      continue;
    }
    if (spec.skipDetail) {
      const detail = await spec.skipDetail(ctx);
      if (detail !== null) {
        stages.push({ stage: spec.name, status: "skipped", detail });
        continue;
      }
    }
    ok = await runStage(spec.name, () => spec.run(ctx), stages, log);
  }

  const summary: DropSummary = {
    command: "drop",
    target: opts.target,
    ok,
    stages,
  };
  if (opts.json) {
    // P1: one summary object as the LAST stdout line — compact, so the
    // rollup parses as a single line even with per-stage objects above it.
    await writeJson(summary);
  } else printStageReport(stages, ok, log);
  // #160 ring 3: setExit is the one mutation point.
  if (!ok) setExit(1);
}
