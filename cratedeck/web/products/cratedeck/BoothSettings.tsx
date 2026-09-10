/**
 * BoothSettings — the fleet selection canvas (#/fleet/booth). Choose the
 * players your checks must satisfy; the compat floor (audio + text) is
 * derived server-side from the same FLEET_PROFILES data and every
 * profile carries its triple citations, rendered inline as proof.
 *
 * The selection persists to config.toml [booth].fleet via
 * POST /api/booth/fleet — the same data `megadj audit` reads, so the CLI
 * and the dashboard always enforce the same booth.
 */
import { useCallback, useState } from "preact/hooks";
import type { BoothFleetPayload } from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import { useFetched, FetchedGate, type Fetched } from "../../ui/useFetched";
import { Verdict } from "../shared";

function FleetRow(props: {
  id: string;
  name: string;
  checked: boolean;
  flac: boolean;
  maxSampleRate: number;
  maxBitDepth: number;
  unicodeText: boolean;
  citations: BoothFleetPayload["profiles"][number]["citations"];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div class="booth-row">
      <label class="booth-row-main">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={() => props.onToggle(props.id)}
        />
        <span class="booth-row-name">{props.name}</span>
        <span class="booth-row-specs">
          {props.flac ? "FLAC · " : "no FLAC · "}
          {props.maxBitDepth}-bit · {props.maxSampleRate / 1000} kHz ·{" "}
          {props.unicodeText ? "Unicode" : "language-table"} display
        </span>
        <button
          type="button"
          class="booth-cite-toggle"
          onClick={() => setOpen(!open)}
        >
          {open ? "hide proof" : `proof (${props.citations.length})`}
        </button>
      </label>
      {open && (
        <ul class="booth-citations">
          {props.citations.map((c) => (
            <li key={c.url + c.section}>
              <span class="booth-cite-claim">{c.claim}</span>{" "}
              <span class="booth-cite-src">
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.publisher}
                </a>{" "}
                — {c.section}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BoothSettings() {
  const page = useFetched<BoothFleetPayload>(
    () => api<BoothFleetPayload>("/api/booth/fleet"),
    [],
  );
  const [sel, setSel] = useState<BoothFleetPayload | null>(null);
  const d = sel ?? (page.status === "ok" ? page.data : null);
  if (page.status !== "ok" || !d)
    return (
      <FetchedGate page={page as Fetched<unknown>} loading="Loading fleet…" />
    );

  const trio = d.profiles.filter((p) => p.defaultOn).map((p) => p.id);
  const missingDefaults = trio.filter((id) => !d.selected.includes(id));

  const toggle = useCallback(
    (id: string) => {
      const current = sel ?? d;
      const next = current.selected.includes(id)
        ? current.selected.filter((x) => x !== id)
        : [...current.selected, id];
      void apiPost<BoothFleetPayload>("/api/booth/fleet", { selected: next })
        .then((res) => {
          setSel(res);
          toast(`Booth fleet saved: ${res.selected.join(", ")}`);
        })
        .catch((e) => toast(`Save failed: ${String(e)}`));
    },
    [sel, d],
  );

  return (
    <div class="canvas-1240">
      <Verdict
        cls={missingDefaults.length === 0 ? "ok" : "warn"}
        text={
          missingDefaults.length === 0
            ? `Booth floor: ${d.selected.length} players — every track is checked against all of them`
            : `Default players NOT selected: ${d.profiles
                .filter((p) => missingDefaults.includes(p.id))
                .map((p) => p.name)
                .join(", ")} — audits will miss what they'd catch`
        }
        meta={
          <span>
            {d.floor.flac ? "FLAC ok · " : "no FLAC · "}
            {d.floor.maxBitDepth}-bit · {d.floor.maxSampleRate / 1000} kHz ·{" "}
            {d.floor.unicodeText ? "Unicode" : "ASCII-only"} text
          </span>
        }
      />
      <p class="booth-lede">
        Every <code>megadj audit</code>, <code>megadj booth-fix</code> and the
        ingest gate enforces the <em>intersection</em> of these players: a track
        passes only when all selected units play it <em>and</em> can show its
        text. The selection persists to <code>config.toml [booth]</code> and
        applies to the CLI on its next run.
      </p>
      <div class="booth-list">
        {d.profiles.map((p) => (
          <FleetRow
            key={p.id}
            id={p.id}
            name={p.name}
            checked={d.selected.includes(p.id)}
            flac={p.flac}
            maxSampleRate={p.maxSampleRate}
            maxBitDepth={p.maxBitDepth}
            unicodeText={p.unicodeText}
            citations={p.citations}
            onToggle={toggle}
          />
        ))}
      </div>
      <p class="booth-note">
        The plain CDJ-2000 is off by default (no FLAC, 48 kHz ceiling,
        language-table display) — enable it when the booth includes
        2000-generation hardware, then re-run <code>megadj audit --json</code>.
      </p>
    </div>
  );
}
