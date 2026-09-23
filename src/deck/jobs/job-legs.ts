/** Compatibility facade for job execution legs. JobEngine owns queueing and
 * lifecycle; cohesive leaves own subprocess and in-process execution. */
export type { LegArgs } from "./job-legs-types";
export { runScan, runVerify, runMirror } from "./job-legs-drive";
export { runIngest } from "./job-legs-intake";
export { runFetchJob } from "./job-legs-fetch";
export {
  fetchArgs,
  parseFetchStart,
  parseFetchTask,
} from "./job-legs-fetch-protocol";
export {
  runBenchmark,
  runChecksum,
  runSpeedtest,
  runGridHealth,
  runHygiene,
  runFixes,
} from "./job-legs-maintenance";
export {
  finiteJobNumber,
  parseIngestSummary,
  parseAuditSummary,
  lastFinalLine,
  requireSuccessfulExit,
} from "./job-legs-parse";
