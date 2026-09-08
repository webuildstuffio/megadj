// PrepTab.tsx — O83 weekly digest, the UI half of surface-parity G2.
//
// The markdown brief (preflight + redundancy + ingest + LOWQ + the D30
// archive-integrity sweep) was CLI (deckctl prep) / MCP (deck_prep) only
// at audit time. This closes it: one tab on the Fleet page fetching the
// same server-rendered digest (GET /api/fleet/prep) and a copy button
// plus download for pasting into notes. Markdown is rendered as a
// monospace block — the digest is the artifact, styling it twice is
// duplication.
import { api, toast } from "./toast";
import { Icon } from "./icons";
import { useFetched } from "./useFetched";
import { errMessage } from "../shared/fmt";

export function PrepTab() {
  const page = useFetched<{ markdown: string }>(
    () => api<{ markdown: string }>("/api/fleet/prep"),
    [],
  );
  const md = page.status === "ok" ? page.data.markdown : null;

  const copy = async () => {
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      toast("Prep digest copied", "ok");
    } catch (e) {
      // clipboard rejects on permission denial / insecure context — a silent
      // no-op Copy button is the slop this tab must not ship
      toast(`copy failed: ${errMessage(e)}`, "err");
    }
  };
  const download = () => {
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prep-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (page.status === "error")
    return (
      <div class="card">
        <div class="empty">
          <Icon name="x" size={16} /> Prep digest failed: {page.message}
        </div>
      </div>
    );
  if (md === null)
    return (
      <div class="card">
        <div class="empty">loading prep digest…</div>
      </div>
    );
  return (
    <div class="card">
      <div class="fleet-head">
        <b>
          <Icon name="doc" size={14} /> Weekly prep
        </b>
        <span class="fleet-sub">
          the gig brief — preflight, redundancy, ingest, LOWQ, archive sweep
        </span>
        <div class="spacer" />
        <button type="button" class="btn" onClick={copy}>
          <Icon name="copy" size={14} /> Copy
        </button>
        <button type="button" class="btn" onClick={download}>
          <Icon name="download" size={14} /> .md
        </button>
      </div>
      <pre class="prep-md">{md}</pre>
    </div>
  );
}
