/** Job-kind execution legs. JobEngine owns queueing and lifecycle only.
 *  This module is the kind→leg DISPATCH; the leg bodies + summary
 *  parsers live in job_legs.ts (#89 diet extraction) — the dependency
 *  arrow runs one way (execution → legs). */
import type { LegArgs } from "./job-legs-types";
import { runScan, runVerify, runMirror } from "./job-legs-drive";
import { runIngest } from "./job-legs-intake";
import { runFetchJob } from "./job-legs-fetch";
import {
  runBenchmark,
  runChecksum,
  runSpeedtest,
  runHygiene,
  runFixes,
  runGridHealth,
} from "./job-legs-maintenance";

export async function executeJob(args: LegArgs): Promise<unknown> {
  switch (args.job.kind) {
    case "scan":
      return runScan(args);
    case "verify":
      return runVerify(args);
    case "mirror":
      return runMirror(args);
    case "ingest":
      return runIngest(args);
    case "fetch":
      return runFetchJob(args);
    case "benchmark":
      return runBenchmark(args);
    case "checksum":
      return runChecksum(args);
    case "speedtest":
      return runSpeedtest(args);
    case "hygiene-scan":
      return runHygiene(args, false);
    case "hygiene-apply":
      return runHygiene(args, true);
    case "fixes-scan":
      return runFixes(args, false);
    case "fixes-apply":
      return runFixes(args, true);
    case "grid-health":
      return runGridHealth(args);
    default:
      return null;
  }
}
