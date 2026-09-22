/** Compatibility facade for job execution legs. JobEngine owns queueing and
 * lifecycle; cohesive leaves own subprocess and in-process execution. */
export type { LegArgs } from "./jobs/job-legs-types";
export { runScan, runVerify, runMirror } from "./jobs/job-legs-drive";
export { runIngest } from "./jobs/job-legs-intake";
export { runFetchJob } from "./jobs/job-legs-fetch";
export {
  fetchArgs,
  parseFetchStart,
  parseFetchTask,
} from "./jobs/job-legs-fetch-protocol";
export {
  runBenchmark,
  runChecksum,
  runSpeedtest,
  runGridHealth,
  runHygiene,
  runFixes,
} from "./jobs/job-legs-maintenance";
export {
  finiteJobNumber,
  parseIngestSummary,
  parseAuditSummary,
  lastFinalLine,
  requireSuccessfulExit,
} from "./jobs/job-legs-parse";
