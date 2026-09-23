// analysis/catch-up.ts — ONE command for the recurring "new imports are
// waiting on analysis" chore (#289): run the beats gap pass, then the mood
// gap pass, report found/analyzed/skipped in one summary. It is a thin
// sequencer over the two existing analysis commands — no second queue
// implementation, no new analysis code. The #278/#279 rule rides through
// the existing passes: a ledgered track is analyzed, never re-queued,
// unless --force.
import type { ArchiveState } from "../../core/state";
import { beats } from "./beats";
import { mood, type MoodOptions } from "./mood";

export interface CatchUpOptions {
  state: ArchiveState;
  musicDir: string;
  /** Parallel workers INSIDE each analysis pass (sync stays serial by
   *  design; parallelism belongs here). Default 4 per the issue sketch. */
  jobs?: number | undefined;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Length cap forwarded to both passes (default 10 min; 0 disables —
   *  the intentional duration cap, made explicit here too). */
  maxSeconds?: number | undefined;
}

export async function catchUp(opts: CatchUpOptions): Promise<void> {
  const pass = {
    state: opts.state,
    musicDir: opts.musicDir,
    jobs: opts.jobs ?? 4,
    limit: opts.limit,
    force: opts.force,
    dryRun: opts.dryRun,
    json: opts.json,
    maxSeconds: opts.maxSeconds,
  };
  // exactOptionalPropertyTypes: mood's onProgress is optional-without-
  // undefined, so spread it conditionally (beats' accepts undefined).
  const moodPass: typeof pass & Pick<MoodOptions, "onProgress"> =
    opts.onProgress ? { ...pass, onProgress: opts.onProgress } : { ...pass };

  opts.onProgress?.("catch-up: beats pass (gap-first, ledgered == analyzed)");
  await beats({ ...pass, onProgress: opts.onProgress });

  opts.onProgress?.("catch-up: mood pass");
  await mood(moodPass);

  // One rollup over the whole run. The per-pass JSON objects already
  // emitted in json mode carry the per-stage detail (found/analyzed/
  // skipped each); this names the run shape.
  if (opts.json) {
    const { writeJson } = await import("../../shared/cli-output");
    await writeJson({
      command: "catch-up",
      stages: ["beats", "mood"],
      force: opts.force === true,
      dryRun: opts.dryRun === true,
    });
  }
}
