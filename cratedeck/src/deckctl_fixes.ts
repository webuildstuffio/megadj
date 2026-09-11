// deckctl_fixes.ts — `deckctl fixes [scan|apply]` (file-length guard:
// deckctl.ts is near the cap). CLI surface of the booth-fixes queue: same
// routes the web uses, same booth-fix engine underneath (no second SSOT).
// The scan/apply enqueue+follow leg lives in deckctl_queue.ts (shared with
// `hygiene` — was a byte-identical clone).
import { apiGet } from "./deckapi";
import { enqueueAndFollow, type QueueHooks } from "./deckctl_queue";
import type { FixesPayload } from "../shared/fixes";

export type FixesHooks = QueueHooks;

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
      await enqueueAndFollow(h, "fixes", sub);
      return;
    }
    default:
      h.errOut(`unknown fixes subcommand: ${sub} (scan | apply)`);
      h.exit(2);
  }
}
