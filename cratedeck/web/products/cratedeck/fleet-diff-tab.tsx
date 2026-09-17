// fleet-diff-tab.tsx — the fleet B8 drive-vs-drive diff tab (#89/#90
// diet extraction from fleet-tabs.tsx): pick two drives, diff their
// inventories, browse added/removed/changed rows.
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { FleetDiff, DriveRef } from "../../../shared/types";
import { errMessage, fmtBytes } from "../../../shared/fmt";
import { api, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { DataTable, ListHead } from "../../ui/data";
import { FixNote } from "../../ui/ListHead";
import { fuzzyFilter } from "../../ui/fuzzy";
import { TabIntro } from "../../ui/InfoTip";
import { Verdict } from "../shared";

export function DiffTab() {
  const [drives, setDrives] = useState<DriveRef[]>([]);
  const [aId, setA] = useState("");
  const [bId, setB] = useState("");
  const [result, setResult] = useState<FleetDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api<{ id: string; nickname: string | null; name: string }[]>("/api/drives")
      .then((ds) => {
        const refs = ds.map((d) => ({
          id: d.id,
          name: d.nickname ?? d.name,
        }));
        setDrives(refs);
        if (refs.length >= 2 && !aId && !bId) {
          setA(refs[0]!.id);
          setB(refs[1]!.id);
        }
      })
      .catch((e: unknown) => {
        console.error("fleet drive list failed", e);
        toast(`drive list unavailable: ${errMessage(e)}`, "err");
      });
  }, [aId, bId]);

  const run = useCallback(async () => {
    if (!aId || !bId || aId === bId) {
      toast("Pick two different drives", "info");
      return;
    }
    setBusy(true);
    setDiffErr(null);
    try {
      setResult(
        await api<FleetDiff>(
          `/api/fleet/diff?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`,
        ),
      );
    } catch (e) {
      // keep the previous result visible but mark it stale — a diff that
      // failed must never read as current
      setDiffErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, [aId, bId]);

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!result) return null;
    const f = (rows: FleetDiff["added"]) =>
      q ? fuzzyFilter(rows, q, ["path", "title", "artist"]) : rows;
    return {
      added: f(result.added),
      removed: f(result.removed),
      changed: f(result.changed),
    };
  }, [result, q]);

  return (
    <div>
      <TabIntro
        what="Two drives, side by side, track by track."
        how="Pick a source and a target: 'added' = tracks the target has that the source lacks, 'missing' = the reverse, 'changed' = same path, different bytes (only visible when a file manifest exists). Filter box narrows all three lists live."
        next="A healthy master→mirror diff reads: added on mirror ≈ your recent imports, missing on mirror = 0, changed = 0."
      />
      <div class="pl-tools">
        <select
          value={aId}
          onInput={(e) => setA((e.target as HTMLSelectElement).value)}
        >
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span class="diff-arrow">→</span>
        <select
          value={bId}
          onInput={(e) => setB((e.target as HTMLSelectElement).value)}
        >
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn primary"
          disabled={busy}
          onClick={run}
          title="Compare the two selected drives track-by-track"
        >
          <Icon name="sort" size={14} /> {busy ? "Diffing…" : "Diff"}
        </button>
      </div>

      {diffErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Diff failed: {diffErr}
          {result && (
            <span> — the tables below are the PREVIOUS run, not current.</span>
          )}
        </div>
      )}

      {!result && !diffErr && (
        <div class="note-card">
          <Icon name="sort" size={20} />
          Pick two drives and diff their inventories — added / removed / changed
          (byte-level when a file manifest exists).
        </div>
      )}

      {result && filtered && (
        <>
          {(() => {
            // ---- the verdict: interpret the three numbers -----------------
            // A healthy master→mirror diff reads: removed=0, changed=0;
            // added ≈ recent imports. Anything else gets a plain sentence.
            const missing = result.removed.length;
            const changed = result.changed.length;
            const added = result.added.length;
            const { a } = result;
            const { b } = result;
            const aIsMaster = /master/i.test(a);
            const healthyDirection =
              aIsMaster || (added > 0 && missing === 0 && changed === 0);
            const verdict =
              missing === 0 && changed === 0
                ? {
                    cls: "ok",
                    text:
                      added === 0
                        ? `${b} matches ${a} exactly — perfect parity.`
                        : `${b} is ahead of ${a} by ${added} track${added === 1 ? "" : "s"}${healthyDirection ? "" : " — check which side should be ahead"}, nothing missing, nothing changed.`,
                  }
                : {
                    cls: "warn",
                    text: `${b} is missing ${missing} track${missing === 1 ? "" : "s"}${changed > 0 ? ` and ${changed} differ in bytes` : ""} — run Mirror to converge.`,
                  };
            return (
              <Verdict
                cls={verdict.cls === "ok" ? "ok" : "warn"}
                text={verdict.text}
                meta={`${added} added · ${missing} missing · ${changed} changed`}
              />
            );
          })()}
          <div class="pl-tools">
            <input
              placeholder="Filter results…"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
          </div>
          <DiffSection
            title={`only on ${result.b}`}
            rows={filtered.added}
            empty="none — b has nothing a lacks"
          />
          <DiffSection
            title={`missing on ${result.b}`}
            rows={filtered.removed}
            empty="none — nothing dropped"
            fix={
              <>
                these are on <code>{result.a}</code> but not{" "}
                <code>{result.b}</code> — <code>Mirror</code> closes the gap
              </>
            }
          />
          <DiffSection
            title="different bytes"
            rows={filtered.changed}
            empty="none — every shared file byte-identical"
            extraHead="bytes"
            fix={
              <>
                same path, different size — re-copy the file, or investigate
                which copy is the good one before overwriting
              </>
            }
            renderExtra={(r) =>
              r.bytes_a !== undefined && r.bytes_b !== undefined
                ? `${fmtBytes(r.bytes_a)} → ${fmtBytes(r.bytes_b)}`
                : ""
            }
          />
        </>
      )}
    </div>
  );
}

function DiffSection(props: {
  title: string;
  rows: FleetDiff["added"];
  empty: string;
  /** optional header for the trailing detail column (e.g. "bytes") */
  extraHead?: string;
  renderExtra?: (r: FleetDiff["added"][number]) => string;
  fix?: ComponentChildren;
}) {
  const icon = props.rows.length ? "disc" : "check";
  return (
    <div>
      <ListHead
        icon={icon}
        title={props.title}
        n={props.rows.length}
        hint="Track-level diff between the two drives. Copy hands the list to an agent — e.g. 'copy these to the other stick' or 'check why these differ'."
        lines={
          props.rows.length > 0
            ? props.rows.map(
                (r) =>
                  `${r.title ?? r.path}${r.artist ? ` — ${r.artist}` : ""}${props.renderExtra ? ` (${props.renderExtra(r)})` : ""}`,
              )
            : undefined
        }
      />
      {!props.rows.length ? (
        <div class="fleet-note">{props.empty}</div>
      ) : (
        <DataTable
          columns={[
            {
              key: "track",
              head: "track",
              grow: 1.6,
              cell: (r) => (
                <>
                  <b>{r.title ?? r.path}</b>
                  {r.artist && <span class="covartist"> — {r.artist}</span>}
                </>
              ),
              sortValue: (r) => (r.title ?? r.path).toLowerCase(),
            },
            {
              key: "extra",
              head: props.extraHead ?? "",
              grow: 1,
              cell: (r) => (
                <span class="dt-sub">{props.renderExtra?.(r) ?? ""}</span>
              ),
              sortValue: (r) => props.renderExtra?.(r) ?? "",
            },
          ]}
          rows={props.rows}
          cap={300}
          ariaLabel={props.title}
          copyName={props.title}
          copyLines={(rows) =>
            rows.map(
              (r) =>
                `${r.title ?? r.path}${r.artist ? ` — ${r.artist}` : ""}${props.renderExtra ? ` (${props.renderExtra(r)})` : ""}`,
            )
          }
        />
      )}
      {props.fix && props.rows.length > 0 && <FixNote>{props.fix}</FixNote>}
    </div>
  );
}
