// deckctl_hygiene.ts — `deckctl hygiene [scan|apply|confirm <id>|dismiss
// <id>]` (file-length guard: deckctl.ts is near the cap). The agent/human
// CLI surface of the shelf-hygiene queue: same routes the web uses, same
// findings ledger underneath (§4.4: no second source of truth). The
// scan/apply enqueue+follow leg lives in deckctl_queue.ts (shared with
// `fixes` — was a byte-identical clone).
import { apiGet, apiPost } from "./deckapi";
import { enqueueAndFollow, type QueueHooks } from "./deckctl_queue";
import type { HygienePayload } from "../shared/hygiene";

export type HygieneHooks = QueueHooks;

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
      const bySub = p.counts.bySub ?? {};
      if (Object.keys(bySub).length > 0) {
        h.log("  acoustic buckets:");
        for (const [bucketName, n] of Object.entries(bySub).toSorted(
          (a, b) => b[1] - a[1],
        ))
          h.log(`    ${bucketName}: ${n}`);
      }
      return;
    }
    case "scan":
    case "apply": {
      await enqueueAndFollow(h, "hygiene", sub);
      return;
    }
    case "bucket": {
      // `deckctl hygiene bucket <name>` — batch-confirm one acoustic
      // subcategory bucket through the engine SSOT (same megadj CLI the
      // web button uses). Accepts a composite bucket (safe-batch,
      // ear-check) but ear-check exists for FILTERING only — the engine
      // refuses batch-confirming the listen-first buckets.
      if (!id) {
        h.errOut(
          "usage: deckctl hygiene bucket <metadata-diff|re-encode|safe-batch>",
        );
        h.exit(2);
      }
      const LISTEN_FIRST = new Set(["quality-diff", "oddball", "ear-check"]);
      if (LISTEN_FIRST.has(id as string)) {
        h.errOut(
          `"${id}" needs your ears — no batch confirm. Filter the queue in the web UI or confirm ids individually.`,
        );
        h.exit(2);
      }
      const res = await apiPost("/api/hygiene/bucket-confirm", { bucket: id });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        raw?: string;
      };
      if (!res.ok || !body.ok) {
        h.errOut(`bucket confirm failed: ${body.error ?? res.status}`);
        h.exit(1);
      }
      if (!h.jsonMode) h.log(`bucket ${id}: confirmed — Apply to execute`);
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
        "usage: deckctl hygiene [scan | apply | bucket <name> | confirm <id> | dismiss <id>]",
      );
      h.exit(2);
  }
}
