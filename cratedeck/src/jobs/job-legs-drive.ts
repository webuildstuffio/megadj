import { basename } from "node:path";
import { lastFinalLine, requireSuccessfulExit } from "./job-legs-parse";
import { drain, drainText, verifyPhase } from "./job-runtime";
import { rbSnapshot, spawnMirror, spawnVerify } from "../rb";
import { scanVolume } from "../scan";
import { lastLines } from "../verify/report";
import { parseVerifyReport } from "../verify/parse";
import type { LegArgs } from "./job-legs-types";

export async function runScan({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
  tick(0, 1, "walking filesystem…", "light-scan", true);
  const light = await scanVolume(mountPoint);
  deps.db.setSnapshot(job.drive_id, light);
  deps.db.event(job.drive_id, "scan", {
    kind: "light",
    files: light.file_count,
  });
  if (handle.cancelled) throw new Error("cancelled");

  let full = false;
  try {
    tick(0.5, 1, "reading rekordbox database…", "full-scan", true);
    const fullSnap = await rbSnapshot(deps.cfg, deps.guard, mountPoint);
    deps.db.setSnapshot(job.drive_id, {
      ...fullSnap,
      file_count: light.file_count,
      folders: light.folders,
      junk: light.junk,
      total_bytes: light.total_bytes,
      free_bytes: light.free_bytes,
      capacity_bytes: light.capacity_bytes ?? fullSnap.capacity_bytes,
      by_ext: light.by_ext,
      largest: light.largest,
      age: light.age,
      manifest: light.manifest,
    });
    full = true;
    deps.db.event(job.drive_id, "scan", {
      kind: "full",
      tracks: fullSnap.track_count,
    });
  } catch (error) {
    if ((error as Error).message.startsWith("REKORDBOX_RUNNING")) throw error;
  }
  tick(1, 1, full ? "scan complete" : "light scan complete", "done", true);
  return { light: true, full };
}

export async function runVerify({
  deps,
  job,
  mountPoint,
  handle,
  tick,
  log,
}: LegArgs) {
  const name = basename(mountPoint);
  const startedAt = Date.now();
  tick(0, 1, `verifying ${name} — opening rekordbox DB…`, "1-databases", true);
  const proc = spawnVerify(deps.cfg, [name]);
  handle.proc = proc;
  let phaseIdx = 0;
  const rawLine = (line: string): void => {
    const match = verifyPhase(line, phaseIdx);
    if (!match) return;
    phaseIdx = match.nextIdx;
    tick(match.progress, 1, match.message, `phase-${phaseIdx}`, true);
  };
  const [verdict, errText] = await Promise.all([
    drain(
      proc,
      (line) => {
        log(line);
        rawLine(line);
      },
      handle,
      deps.cfg.verifyTimeoutMin * 60_000,
    ),
    drainText(proc.stderr),
  ]);
  const out = verdict.out + (errText ? `\n[stderr]\n${errText}` : "");
  const finalLine = lastFinalLine(verdict.out);
  const pass =
    finalLine !== undefined &&
    /FINAL: ALL PASS/.test(finalLine) &&
    proc.exitCode === 0;
  tick(
    1,
    1,
    pass
      ? "verify passed"
      : `verify FAILED — ${finalLine ?? "no FINAL line (crashed?)"}`.slice(
          0,
          200,
        ),
    "done",
    true,
  );
  const report = parseVerifyReport(
    out,
    pass,
    finalLine ?? null,
    Math.round((Date.now() - startedAt) / 1000),
    deps.db.getDrive(job.drive_id)?.role,
  );
  return { verdict: pass ? "pass" : "fail", ...report };
}

export async function runMirror({ deps, handle, tick, log }: LegArgs) {
  tick(0, 1, "mirroring to mirror drive…", "mirror", true);
  const proc = spawnMirror(deps.cfg, []);
  handle.proc = proc;
  const [result, errText] = await Promise.all([
    drain(
      proc,
      (line) => log(line),
      handle,
      deps.cfg.mirrorTimeoutMin * 60_000,
    ),
    drainText(proc.stderr),
  ]);
  const out = result.out + (errText ? `\n[stderr]\n${errText}` : "");
  if (handle.cancelled) throw new Error("cancelled");
  requireSuccessfulExit("mirror", proc.exitCode, errText);
  tick(1, 1, "mirror finished", "done", true);
  return { summary: lastLines(out, 20) };
}
