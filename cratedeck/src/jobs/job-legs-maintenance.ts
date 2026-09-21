import type { FixesPayload } from "../../../src/shared/leaf/fixes";
import { fmtBytes } from "../../../src/shared/leaf/fmt";
import { benchmarkDrive, checksumLedger, speedProbe } from "../bench";
import { runCliJob } from "../cli-job-leg";
import { recordGridHealth } from "../grid-health-routes";
import { summarizeGridHealth } from "../grid-health-parse";
import { finiteJobNumber } from "./job-legs-parse";
import { drain, drainText } from "./job-runtime";
import type { LegArgs } from "./job-legs-types";

export async function runBenchmark({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
  tick(0, 1, "reading largest files sequentially…", "bench-seq", true);
  const result = await benchmarkDrive(mountPoint, deps.cfg.benchmarkMb, handle);
  deps.db.addBenchmark(job.drive_id, result.seq_mbps, result.rand4k_mbps);
  deps.db.event(job.drive_id, "benchmark", {
    seq: result.seq_mbps,
    rand4k: result.rand4k_mbps,
  });
  tick(1, 1, `${result.seq_mbps} MB/s sequential`, "done", true);
  return result;
}

export async function runChecksum({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
  const result = await checksumLedger(
    deps.db,
    job.drive_id,
    mountPoint,
    8 * 1024 * 1024 * 1024,
    handle,
    (done, total, bytes) =>
      tick(
        done,
        total,
        `hashing ${done.toLocaleString()}/${total.toLocaleString()} files (${fmtBytes(bytes)})`,
        "checksum",
      ),
  );
  deps.db.event(job.drive_id, "checksum", {
    hashed: result.hashed,
    changed: result.changed.length,
  });
  if (result.changed.length) {
    deps.db.event(job.drive_id, "bitrot-suspect", {
      paths: result.changed.slice(0, 50),
    });
  }
  tick(
    1,
    1,
    result.changed.length
      ? `${result.changed.length} file(s) changed vs ledger`
      : `${result.hashed.toLocaleString()} files clean`,
    "done",
    true,
  );
  return result;
}

export async function runSpeedtest({
  deps,
  job,
  mountPoint,
  handle,
  tick,
}: LegArgs) {
  tick(0, 1, "probing read speed (~10MB)…", "speedtest", true);
  const result = await speedProbe(mountPoint, 10, handle, [
    ...deps.db.ledgerBiggest(job.drive_id, 5),
    ...deps.db.manifestBiggest(job.drive_id, 5),
  ]);
  deps.db.addSpeedProbe(job.drive_id, result.mbps, result.bytes_read);
  deps.db.event(job.drive_id, "speedtest", {
    mbps: result.mbps,
    bytes_read: result.bytes_read,
  });
  tick(1, 1, `read ${result.mbps.toLocaleString()} MB/s`, "done", true);
  return { mbps: result.mbps, bytes_read: result.bytes_read };
}

export async function runGridHealth(args: LegArgs) {
  const summary = await runCliJob(
    cliDeps(args),
    {
      command: "rb-grid-triage",
      label: "megadj rb-grid-triage",
      argv: [args.mountPoint, "--json"],
    },
    false,
    args.handle,
  );
  const drive = args.deps.db.getDrive(args.job.drive_id);
  const payload = summarizeGridHealth(
    summary,
    args.job.drive_id,
    drive?.nickname ?? drive?.name ?? args.job.drive_id,
  );
  recordGridHealth(args.job.drive_id, payload);
  args.deps.db.event(args.job.drive_id, "grid-health", {
    audited: payload.audited,
    offenders:
      payload.buckets.SHIFT +
      payload.buckets.PHASE +
      payload.buckets.TEMPO +
      payload.buckets.DRIFT +
      payload.buckets.CHAOS,
    syncIssues: payload.syncIssues,
  });
  args.tick(
    1,
    1,
    `${payload.audited}/${payload.total} audited · ${payload.offenders.length} flagged`,
    "done",
    true,
  );
  return payload;
}

function cliDeps({ deps, job, handle, tick, log }: LegArgs) {
  return {
    cfg: deps.cfg,
    jobTimeoutMin: deps.cfg.jobTimeoutMin,
    cancelled: (): boolean =>
      handle.cancelled || deps.db.getJob(job.id)?.status !== "running",
    killProc: (proc: Bun.Subprocess): void => proc.kill(),
    log: (line: string): void => log(line),
    tick,
    drain: (
      stream: ReadableStream<Uint8Array>,
      onLine: (line: string) => void,
      runHandle: { cancelled: boolean; proc?: Bun.Subprocess },
      timeoutMs: number,
    ) => drain(stream, onLine, runHandle, timeoutMs),
    drainText: (stream: ReadableStream<Uint8Array> | undefined) =>
      drainText(stream),
  };
}

export async function runHygiene(args: LegArgs, apply: boolean) {
  const jobs = await import("../hygiene/jobs");
  const run = apply ? jobs.runHygieneApply : jobs.runHygieneScan;
  return run(cliDeps(args), args.mountPoint, args.handle);
}

function toPayload(
  summary: Record<string, unknown>,
  scannedPath: string,
): FixesPayload {
  return {
    fleet: (summary.fleet as string[]) ?? [],
    checked: finiteJobNumber(summary.checked),
    fixable: finiteJobNumber(summary.fixable),
    applied: finiteJobNumber(summary.applied),
    rows: (summary.rows as FixesPayload["rows"]) ?? [],
    scannedPath,
  };
}

export async function runFixes(args: LegArgs, apply: boolean) {
  const jobs = await import("../fixes-jobs");
  const run = apply ? jobs.runFixesApply : jobs.runFixesScan;
  const summary = await run(cliDeps(args), args.mountPoint, args.handle);
  const { recordFixes } = await import("../fixes-routes");
  if (apply) {
    const after = await jobs.runFixesScan(
      cliDeps(args),
      args.mountPoint,
      args.handle,
    );
    recordFixes(toPayload(after, args.mountPoint));
  } else {
    recordFixes(toPayload(summary, args.mountPoint));
  }
  return summary;
}
