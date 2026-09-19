// IntakeDumps.tsx — the GetDat dumps strip (#20, wire 3/3 of the tab's
// flow): every ingest batch as ONE unit with its process state (done |
// partial + what's pending). Reads /api/intake/dumps — the ledger ingest
// itself writes (src/archive/dump-ledger.ts), so the strip can never
// disagree with the CLI's --json summary. Loads once per mount (the tab
// remounts on run completion, so the strip refreshes with it).
import type { IntakeDumpsResponse } from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";

export function IntakeDumps() {
  const dumps = useFetched<IntakeDumpsResponse>(
    () => api<IntakeDumpsResponse>("/api/intake/dumps"),
    [],
  );
  if (dumps.status !== "ok")
    return <FetchedGate page={dumps} loading="loading dumps…" />;
  const { dumps: rows, counts } = dumps.data;
  if (counts.total === 0) return null;
  return (
    <div class="card">
      <h3 class="sect">
        <Icon name="history" /> Dumps — {counts.total} total
        {counts.partial > 0 && (
          <span class="pill warn">{counts.partial} partial</span>
        )}
        {counts.pending > 0 && (
          <span class="pill">{counts.pending} file(s) pending</span>
        )}
      </h3>
      <div class="checks">
        {rows.slice(0, 8).map((d) => (
          <div class="check" key={d.folder}>
            <span class={`pill ${d.status === "done" ? "ok" : "warn"}`}>
              {d.status}
            </span>
            <span class="check-body">
              <b>{d.folder}</b>
              <span class="check-detail">
                {d.ingested} ingested · {d.duplicates} duplicates
                {d.pending > 0
                  ? ` · ${d.pending} pending (re-run resumes)`
                  : ""}
                {d.lastError ? ` — ${d.lastError}` : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
