/**
 * intake_run.ts — the server half of the GetDat Intake tab: run megadj's
 * ingest pipeline as a job, streaming its step-by-step progress live.
 *
 * The runner SPAWNS `bun <repo>/src/cli.ts ingest <folder> --json` (the
 * CLI is the SSOT for the pipeline — the web surface must not re-implement
 * tagging/dedupe/art logic or the two WILL drift). We parse its human log
 * lines into phases:
 *
 *   "N audio file(s)"        → probe         (phase 0, active from spawn)
 *   "[dupe]"/"[fp]" lines    → dedupe        (phase 1)
 *   "already in archive"     → archive-check (phase 2)
 *   per-file "  = ok"/"  ~"  → enrich        (phase 3, nudge per row)
 *   "done: ..."              → finishing     (phase 4)
 *   (audit leg is set by the runner post-exit — phase 5)
 *
 * The human log arrives on STDERR in --json mode (progress.ts commandLog:
 * stdout stays one summary object; a silent log once made the run look
 * frozen at 0%), so the runner drains both streams.
 *
 * After ingest exits 0, the runner legs a post-audit (`megadj audit
 * --json`) so the UI's verify step reflects the whole archive, not just
 * the batch. Both commands get a wall-clock bound via the job engine's
 * budget (job_timeout_min) — this module only needs honest phases.
 *
 * megadj's CLI is resolved relative to the repo root (cfg.root/..) so the
 * dashboard always drives the same code the user runs by hand.
 */
import { join } from "node:path";
import { readdirSync } from "node:fs";

export interface IntakePhase {
  /** 0..1 absolute progress this phase STARTS at */
  at: number;
  /** phase label shown in the UI */
  phase: string;
}

/** Ordered phases. Index i = the phase that becomes ACTIVE at `at`
 * (absolute 0..1 progress). This array is the SSOT for both the phase
 * name a job row carries and the progress each marker reports — jobs.ts
 * derives both from it, so the two can't drift (they did once: the OF
 * map said "probe" where the array said "dedupe").
 *
 * Real ingest log anatomy (src/commands/ingest.ts): the walk logs
 * "N audio file(s) under X" → Phase A ffprobes (silent per file) →
 * Phase B dedupe logs "[dupe]"/"[fp]" → Phase C logs "[dupe] already in
 * archive"/"[upgrade]" → Phase D per-file rows "  = ok:" / "  ~ f: …" /
 * "  ⇄ wav→aiff:" / "  ⛔ …" / "  ⚠ …" → "done: …". The audit leg is
 * set by the runner after the CLI exits, never via a log line. */
export const INTAKE_PHASES = [
  { at: 0.02, phase: "probe" },
  { at: 0.15, phase: "dedupe" },
  { at: 0.3, phase: "archive-check" },
  { at: 0.4, phase: "enrich" },
  { at: 0.9, phase: "finishing" },
  { at: 0.97, phase: "audit" },
] as const;

/** One Phase-D per-file row (raw line, TWO-space indent — the trim-first
 * version of this regex never matched anything). Shared with jobs.ts so
 * its in-enrich progress nudges use the exact same line class. */
export const INTAKE_FILE_LINE = /^  (⇄|⛔|⚠|= ok:|~)/;

/** Map one ingest log line → (absolute progress, phase) when it advances
 * the phase order. Phases only move FORWARD (repeated markers can't rewind
 * the bar). Lines are matched RAW where indentation matters — Phase-C's
 * "[dupe] already in archive" is checked BEFORE the dedupe "[dupe]" so an
 * archive-only-dupe batch lands in archive-check, not dedupe. */
export function intakePhaseFor(
  line: string,
  phaseIdx: number,
): { progress: number; message: string; nextIdx: number } | null {
  const t = line.trim();
  const at = (i: number): IntakePhase => INTAKE_PHASES[i]!;
  // probe: walk done, ffprobe starting. Phase 0 is already active from the
  // spawn tick — this is a message+progress nudge, not an advance (guard
  // < 1 so it can't re-fire once dedupe began).
  if (phaseIdx < 1 && t.includes("audio file(s) under")) {
    return { progress: at(0).at, message: "probing files", nextIdx: 0 };
  }
  if (
    phaseIdx < 3 &&
    (t.includes("already in archive") || t.includes("[upgrade]"))
  ) {
    const p = at(2);
    return {
      progress: p.at,
      message: "checking against the archive",
      nextIdx: 2,
    };
  }
  if (phaseIdx < 2 && (t.includes("[dupe]") || t.includes("[fp]"))) {
    const p = at(1);
    return { progress: p.at, message: "deduplicating", nextIdx: 1 };
  }
  if (phaseIdx < 3 && INTAKE_FILE_LINE.test(line)) {
    const p = at(3);
    return {
      progress: p.at,
      message: "tagging + artwork + analysis",
      nextIdx: 3,
    };
  }
  if (phaseIdx < 4 && t.startsWith("done: ")) {
    const p = at(4);
    return { progress: p.at, message: "wrapping up batch", nextIdx: 4 };
  }
  return null;
}

/** The megadj CLI command for one intake run. argv[0..1] is the repo's
 * cli.ts; the folder is the user-chosen dump. `--json` keeps stdout as
 * one summary object; the human log still lands on stdout BEFORE it (the
 * JSON object is printed last — the runner splits on the final `{`). */
export function intakeArgs(folder: string): string[] {
  return ["ingest", folder, "--json"];
}

/** Split megadj's mixed stdout into (human log lines, trailing JSON). */
export function splitIntakeStdout(out: string): {
  log: string;
  summary: Record<string, unknown> | null;
} {
  const idx = out.lastIndexOf("\n{");
  if (idx < 0) return { log: out, summary: null };
  try {
    const summary = JSON.parse(out.slice(idx + 1)) as Record<string, unknown>;
    return { log: out.slice(0, idx + 1), summary };
  } catch {
    return { log: out, summary: null };
  }
}

/** Where the megadj repo's cli.ts lives (cfg.root = cratedeck/). */
export function megadjCliPath(root: string): string {
  return join(root, "..", "src", "cli.ts");
}

/** Intake watch folder: config override `intake.watch_dir` when set, else
 *  ~/Downloads (the natural dump landing zone). Config comes in as a plain
 *  record — CrateConfig doesn't carry an intake section. */
export function intakeWatchDir(cfg: { musicDir: string }): string {
  const configured = process.env.MEGADJ_INTAKE_WATCH;
  return configured || join(cfg.musicDir, "..", "Downloads");
}

export interface IntakeCandidate {
  path: string;
  exists: boolean;
  /** file count visible at the top level (cheap readdir, not a walk) */
  files: number;
  label: string;
}

/** Folders the Intake tab offers as one-click sources: the watch folder
 *  (when it's not the archive itself) + every NOT-yet-ingested dated batch
 *  folder already inside the archive. Absolute-path allowlist: the start
 *  route refuses anything else, so a crafted request can't point ingest at
 *  an arbitrary directory. */
export function intakeCandidateDirs(cfg: {
  musicDir: string;
}): IntakeCandidate[] {
  const out: IntakeCandidate[] = [];
  const seen = new Set<string>();
  const add = (path: string, label: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    let exists = false;
    let files = 0;
    try {
      const entries = readdirSync(path, { withFileTypes: true });
      exists = true;
      files = entries.filter((e) => e.isFile()).length;
    } catch {
      exists = false; // readdirSync throws on missing/permission-denied
    }
    out.push({ path, exists, files, label });
  };
  const watch = intakeWatchDir(cfg);
  if (watch !== cfg.musicDir) add(watch, "watch folder");
  // batch folders already in the archive (re-ingest after a fix, mostly)
  try {
    for (const e of readdirSync(cfg.musicDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || e.name.startsWith("ingest-duplicates"))
        continue;
      add(join(cfg.musicDir, e.name), e.name);
    }
  } catch {
    // unreadable archive dir — the watch candidate still answers
  }
  return out;
}
