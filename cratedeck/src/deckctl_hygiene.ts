// deckctl_hygiene.ts — `deckctl hygiene [scan|apply|confirm <id>|dismiss
// <id>]` (file-length guard: deckctl.ts is near the cap). The agent/human
// CLI surface of the shelf-hygiene queue: same routes the web uses, same
// findings ledger underneath (§4.4: no second source of truth).
import { apiGet, apiPost, pollJob, jobTerminal, type Job } from "./deckapi";
import type { HygienePayload } from "../shared/hygiene";

export interface HygieneHooks {
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (c: number) => void;
}

/** Wait for a hygiene job to finish (shared by scan/apply legs). */
async function followJob(
  jobId: string,
  h: HygieneHooks,
): Promise<Record<string, unknown> | null> {
  const res = await pollJob(jobId);
  const job = res as Job;
  if (jobTerminal(job.status)) {
    if (job.status === "done")
      return JSON.parse(job.result_json ?? "{}") as Record<string, unknown>;
    h.errOut(`hygiene job ${job.status}: ${job.error ?? "no error given"}`);
    h.exit(1);
  }
  return null;
}

export async function cmdHygiene(
  h: HygieneHooks,
  sub: string | undefined,
  id: string | undefined,
): Promise<void> {
  switch (sub) {
    case undefined: {
      // census: the verdict banner's numbers, for agents
      const res = await apiGet("/api/hygiene");
      const p = (await res.json()) as HygienePayload;
      if (h.jsonMode) {
        console.log(JSON.stringify(p.counts, null, 2));
        return;
      }
      h.log(
        `shelf hygiene: ${p.counts.open} open · ${p.counts.safe} auto-safe · ${p.counts.review} need review · ${p.counts.confirmed} confirmed`,
      );
      for (const [kind, n] of Object.entries(p.counts.byKind))
        h.log(`  ${kind}: ${n}`);
      return;
    }
    case "scan":
    case "apply": {
      const res = await apiPost(`/api/hygiene/${sub}`, {});
      const job = (await res.json()) as Job & { error?: string };
      if (!res.ok) {
        h.errOut(`enqueue failed: ${job.error ?? res.status}`);
        h.exit(1);
      }
      h.log(`hygiene ${sub} enqueued: ${job.id}`);
      const result = await followJob(job.id, h);
      if (h.jsonMode && result) console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "confirm":
    case "dismiss": {
      if (!id) {
        h.errOut(`usage: deckctl hygiene ${sub} <finding-id>`);
        h.exit(2);
      }
      const res = await apiPost("/api/hygiene/decide", {
        id,
        confirm: sub === "confirm",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        h.errOut(`decide failed: ${body.error ?? res.status}`);
        h.exit(1);
      }
      if (!h.jsonMode) h.log(`${sub}d ${id}`);
      return;
    }
    default:
      h.errOut(
        "usage: deckctl hygiene [scan | apply | confirm <id> | dismiss <id>]",
      );
      h.exit(2);
  }
}
