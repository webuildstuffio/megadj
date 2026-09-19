// deckctl/queue.ts — shared tail for the queue-style deckctl commands
// (`hygiene`, `fixes`): enqueue on a family route, follow the job, print
// the result. The two modules carried byte-identical followJob + scan/apply
// legs (jscpd-class clone); this is the one implementation (§1: parity is
// cheapest to guarantee when the spokes share seams, not copies).
import { errMessage } from "../../../src/shared/leaf/fmt";
import { apiPost, pollJob, jobTerminal, type Job } from "../deckapi";
import { emitJson } from "./runtime";

/** Output hooks — the same shape deckctl/hygiene and deckctl/fixes already
 *  receive from deckctl.ts's baseHooks(). */
export interface QueueHooks {
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (c: number) => void;
}

/** Enqueue a job on a family route (`/api/hygiene/scan`), report it, and
 *  block until it finishes. Returns the parsed result_json, or null when
 *  JSON output already streamed it. Exits 1 on job failure (hooks.exit). */
export async function enqueueAndFollow(
  h: QueueHooks,
  family: string,
  action: "scan" | "apply",
): Promise<Record<string, unknown> | null> {
  const res = await apiPost(`/api/${family}/${action}`, {});
  const job = (await res.json()) as Job & { error?: string };
  if (!res.ok || !job.id) {
    h.errOut(`${family} ${action} failed: ${job.error ?? res.status}`);
    h.exit(1);
  }
  h.log(`${family} ${action} enqueued: ${job.id}`);
  const polled = (await pollJob(job.id)) as Job;
  if (jobTerminal(polled.status)) {
    if (polled.status === "done") {
      // A "done" job with junk result_json is a server contract breach, not
      // an empty result — `?? "{}"` would stream a zero-shaped success and
      // lie to both the JSON consumer and the human (fallback-slop S1/S10).
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(polled.result_json ?? "{}") as Record<
          string,
          unknown
        >;
      } catch (error) {
        h.errOut(
          `${family} job result was not valid JSON: ${errMessage(error)}`,
        );
        h.exit(1);
        return null;
      }
      if (h.jsonMode) await emitJson(result);
      return result;
    }
    h.errOut(
      `${family} job ${polled.status}: ${polled.error ?? "no error given"}`,
    );
    h.exit(1);
  }
  return null;
}
