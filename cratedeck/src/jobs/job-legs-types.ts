import type { Job } from "../../shared/types";
import type { CrateConfig } from "../config";
import type { DB } from "../db";
import type { Guard } from "../guard";
import type { JobLog, JobTick, RunHandle } from "./job-runtime";

/** Dependencies shared by every execution leg. Kept independent from the
 * dispatcher so the dependency arrow remains execution -> legs. */
export interface LegDeps {
  cfg: CrateConfig;
  db: DB;
  guard: Guard;
}

export interface LegArgs {
  deps: LegDeps;
  job: Job;
  mountPoint: string;
  handle: RunHandle;
  tick: JobTick;
  log: JobLog;
}
