// PrepTab.tsx — O83 weekly digest, the UI half of surface-parity G2.
//
// The markdown brief (preflight + redundancy + ingest + LOWQ + the D30
// archive-integrity sweep) was CLI (deckctl prep) / MCP (deck_prep) only
// at audit time. This closes it: one tab on the Fleet page fetching the
// same server-rendered digest (GET /api/fleet/prep) and a copy button
// plus download for pasting into notes. Markdown is rendered as a
// monospace block — the digest is the artifact, styling it twice is
// duplication.

import { useEffect, useState } from "preact/hooks";
import { api } from "./toast";
import { Icon } from "./icons";

export function PrepTab() {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ markdown: string }>("/api/fleet/prep")
      .then((r) => alive && setMd(r.markdown))
      .catch((e: Error) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const copy = () => {
    if (md) navigator.clipboard.writeText(md);
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

  if (err)
    return (
      <div class="card">
        <div class="empty">
          <Icon name="x" size={16} /> Prep digest failed: {err}
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
