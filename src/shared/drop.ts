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

import { ingest } from "../getdat/commands/ingest";
import { beats } from "../fulltags/beats";
import { mood } from "../fulltags/mood";
import { cues } from "../fulltags/cues";
import { organize } from "../getdat/commands/organize";
import type { ArchiveState } from "../archive/state";
import { commandLog } from "../progress";

export interface DropOptions {
  state: ArchiveState;
  musicDir: string;
  /** Folder path (relative ok) OR a URL to download first. */
  target: string;
  dryRun?: boolean;
  /** Skip the ONNX mood stage even when models are present. */
  noMood?: boolean;
  /** Skip the fast (no-key/bpm) stages of the fetch pass. Off by default —
   *  the whole point of drop is "point at a folder, get finished tracks". */
  noFetch?: boolean;
  /** Opt-in AI genre/year fallback inside the fetch stage (SC + Beatport
   *  stay primary; AI covers only what both miss). Off by default. */
  aiFallback?: boolean;
  /** Beat-analysis length cap in seconds (default 900 = 15min; 0 disables) —
   *  longer tracks skip the beats stage (grid cost scales with runtime). */
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

/** Download a URL straight into the music dir via yt-dlp (best-audio,
 *  no playlist expansion, same cookie plumbing as sync). */
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
  ];
  if (opts.cookiesFile) args.push("--cookies", opts.cookiesFile);
  else if (opts.cookiesFromBrowser)
    args.push("--cookies-from-browser", opts.cookiesFromBrowser);
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
    const detail = e instanceof Error ? e.message : String(e);
    stages.push({ stage: name, status: "failed", detail });
    log(`${name} failed: ${detail}`);
    return false;
  }
}

export async function drop(opts: DropOptions): Promise<void> {
  const log = commandLog(opts);
  const stages: DropStage[] = [];
  let ok = true;

  // Stage 0 — URL → download into the music dir; folder → use as-is.
  let folder = opts.target;
  if (isUrl(opts.target)) {
    log(`downloading ${opts.target}…`);
    if (opts.dryRun) {
      stages.push({
        stage: "download",
        status: "skipped",
        detail: "dry-run",
      });
      folder = opts.musicDir;
    } else {
      const r = await downloadUrl(opts.target, opts.musicDir, opts);
      if (r.error) {
        stages.push({
          stage: "download",
          status: "failed",
          detail: r.error,
        });
        ok = false;
      } else {
        stages.push({ stage: "download", status: "ok" });
        folder = opts.musicDir;
      }
    }
  }

  // Stage 1 — ingest: clean names, tags, artwork, dedupe, WAV→AIFF.
  if (ok) {
    ok = await runStage(
      "ingest",
      () =>
        ingest({
          state: opts.state,
          musicDir: opts.musicDir,
          folder,
          dryRun: opts.dryRun,
          json: true, // human logs suppressed; summary comes from drop
        }),
      stages,
      log,
    );
  } else {
    stages.push({
      stage: "ingest",
      status: "skipped",
      detail: "download failed",
    });
  }

  // Stage 1b — enrichment (fetch-all: tags/genre/art/year + energy,
  // fingerprint, key stamps) and year verification against the real SC
  // page dates. These are the stages the artist/comment/tag gaps of the
  // early passes lived in — a drop that skips them re-creates those bugs.
  // fetch runs the pipeline in-process via runFetch (it owns its own
  // progress bar + AI batching); years is the in-process verify pass.
  if (ok) {
    if (opts.noFetch) {
      stages.push({
        stage: "fetch",
        status: "skipped",
        detail: "no-fetch flag",
      });
    } else {
      ok = await runStage(
        "fetch",
        async () => {
          const { fetch } = await import("../fulltags/fetch");
          await fetch({
            all: false,
            only: "all",
            aiFallback: opts.aiFallback,
            dryRun: opts.dryRun,
            json: true,
          });
        },
        stages,
        log,
      );
    }
  } else stages.push({ stage: "fetch", status: "skipped" });

  if (ok) {
    if (opts.noFetch) {
      stages.push({
        stage: "years",
        status: "skipped",
        detail: "no-fetch flag",
      });
    } else {
      ok = await runStage(
        "years",
        async () => {
          const { runFixYears } = await import("../fulltags/years");
          await runFixYears({ dryRun: opts.dryRun ?? false, json: true });
        },
        stages,
        log,
      );
    }
  } else stages.push({ stage: "years", status: "skipped" });

  // Stage 2 — beats ledger (beat_this → DB; no tag writes). Tracks over
  // maxBeatSeconds (default 15min) skip the grid — cost scales with runtime.
  if (ok)
    ok = await runStage(
      "beats",
      () =>
        beats({
          state: opts.state,
          musicDir: opts.musicDir,
          dryRun: opts.dryRun,
          json: true,
          maxSeconds: opts.maxBeatSeconds,
        }),
      stages,
      log,
    );
  else stages.push({ stage: "beats", status: "skipped" });

  // Stage 3 — mood ledger, gated on models present (320 MB one-time
  // download is NOT something a drop should silently trigger).
  if (!ok) {
    stages.push({ stage: "mood", status: "skipped" });
  } else if (opts.noMood) {
    stages.push({ stage: "mood", status: "skipped", detail: "no-mood flag" });
  } else {
    const { moodModelsPresent } = await import("../../fulltags/src/models");
    if (moodModelsPresent()) {
      ok = await runStage(
        "mood",
        () =>
          mood({
            state: opts.state,
            musicDir: opts.musicDir,
            dryRun: opts.dryRun,
            json: true,
          }),
        stages,
        log,
      );
    } else {
      stages.push({
        stage: "mood",
        status: "skipped",
        detail: "models absent (bun run fulltags/cli.ts ensure-models)",
      });
    }
  }

  // Stage 4 — phrase cues from the beats ledger (DB-side).
  if (ok)
    ok = await runStage(
      "cues",
      () =>
        cues({
          state: opts.state,
          dryRun: opts.dryRun,
          json: true,
        }),
      stages,
      log,
    );
  else stages.push({ stage: "cues", status: "skipped" });

  // Stage 5 — organize into genre folders (never deletes; moves only).
  if (ok)
    ok = await runStage(
      "organize",
      () =>
        organize({
          state: opts.state,
          musicDir: opts.musicDir,
          dryRun: opts.dryRun,
          json: true,
        }),
      stages,
      log,
    );
  else stages.push({ stage: "organize", status: "skipped" });

  // Stage 6 — tag-check gate (well-formedness: unreadable containers,
  // mojibake, control bytes, no-title/artist voids — the "Unknown Artist
  // in the booth" trap). Report-only here: drop reports, the operator
  // fixes via booth-fix; a failed gate fails the run.
  if (ok)
    ok = await runStage(
      "tag-check",
      async () => {
        const { walkAudioFiles, tagHealth } =
          await import("../../fulltags/src/exports");
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
      stages,
      log,
    );
  else stages.push({ stage: "tag-check", status: "skipped" });

  // Stage 7 — final completeness gate (audit: art+tags+genre+year+mood+
  // energy+player-compat+booth-text). Exits 1 on any gap; the summary's
  // detail carries the gap count so --json consumers see it in one line.
  if (ok)
    ok = await runStage(
      "audit",
      async () => {
        const { auditArchive } = await import("../fulltags/fetch");
        const report = await auditArchive(opts.musicDir);
        const gaps = report.rows.filter((r) => !r.complete);
        if (gaps.length)
          throw new Error(
            `${gaps.length}/${report.total} incomplete — megadj audit for the per-file list`,
          );
      },
      stages,
      log,
    );
  else stages.push({ stage: "audit", status: "skipped" });

  const summary: DropSummary = {
    command: "drop",
    target: opts.target,
    ok,
    stages,
  };
  if (opts.json) {
    // P1: one summary object as the LAST stdout line — compact, so the
    // rollup parses as a single line even with per-stage objects above it.
    console.log(JSON.stringify(summary));
  } else {
    log("");
    log(ok ? "✓ drop complete" : "✗ drop incomplete — see stages above");
    for (const s of stages)
      log(
        `  ${s.status === "ok" ? "✓" : s.status === "skipped" ? "-" : "✗"} ${s.stage}${s.detail ? ` — ${s.detail}` : ""}`,
      );
  }
  if (!ok) process.exitCode = 1;
}
