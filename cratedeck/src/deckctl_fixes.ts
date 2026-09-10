// deckctl_fixes.ts — `deckctl fixes [scan|apply]` (file-length guard:
// deckctl.ts is near the cap). CLI surface of the booth-fixes queue: same
// routes the web uses, same booth-fix engine underneath (no second SSOT).
import { apiGet, apiPost, pollJob, jobTerminal, type Job } from "./deckapi";
import type { FixesPayload } from "../shared/fixes";

export interface FixesHooks {
  jsonMode: boolean;
  log: (s: string) => void;
  errOut: (s: string) => void;
  exit: (c: number) => void;
}

/** Wait for a fixes job to finish (shared by scan/apply). */
async function followJob(
  jobId: string,
  h: FixesHooks,
): Promise<Record<string, unknown> | null> {
  const res = await pollJob(jobId);
  const job = res as Job;
  if (jobTerminal(job.status)) {
    if (job.status === "done")
      return JSON.parse(job.result_json ?? "{}") as Record<string, unknown>;
    h.errOut(`fixes job ${job.status}: ${job.error ?? "no error given"}`);
    h.exit(1);
  }
  return null;
}

export async function cmdFixes(
  h: FixesHooks,
  sub: string | undefined,
): Promise<void> {
  switch (sub) {
    case undefined: {
      // census: the verdict banner's numbers, for agents
      const res = await apiGet("/api/fixes");
      const p = (await res.json()) as FixesPayload | null;
      if (!p || !p.scannedPath) {
        if (h.jsonMode) {
          console.log(JSON.stringify({ scanned: false, fixable: 0 }, null, 2));
        } else {
          h.log("no fixes scan yet — run: deckctl fixes scan");
        }
        return;
      }
      if (h.jsonMode) {
        console.log(JSON.stringify(p, null, 2));
        return;
      }
      h.log(
        `fixes: ${p.checked} checked · ${p.fixable} fixable · fleet: ${p.fleet.join(", ")}`,
      );
      for (const r of p.rows) {
        h.log(`  [${r.action}] ${r.file} — ${r.reasons.join(",")}`);
      }
      return;
    }
    case "scan":
    case "apply": {
      const enq = await apiPost(`/api/fixes/${sub}`, {});
      const { id } = (await enq.json()) as { id: string };
      h.log(`${sub} queued (${id}) — waiting…`);
      const result = await followJob(id, h);
      if (result && h.jsonMode) console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      h.errOut(`unknown fixes subcommand: ${sub} (scan | apply)`);
      h.exit(2);
  }
}
