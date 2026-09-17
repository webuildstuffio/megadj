// HygieneTab.tsx — the shelf drive's Hygiene tab (docs/getdat/shelf-hygiene-2026-09-09.md §5 Phase 3). Two-thirds UX law: a plain-language VERDICT
// banner first, then the fix-first work queue (worst first, each row
// carries its `megadj`/`deckctl` fix command with a copy button), then
// raw detail + the quarantine explainer. The tab is a remote control:
// scan/apply enqueue jobs over /api/hygiene, decisions are one-row CLI
// writes — the engine stays the single implementation (§4.4).
//
// (#89/#90 page-monolith split): the A/B compare cluster lives in
// hygiene-compare.tsx; the presentational rows (queue row, bucket strip,
// action bar, settled tail) live in hygiene-rows.tsx. This file owns the
// state, the decision wiring, and the layout.
import { useState } from "preact/hooks";
import type {
  Finding,
  HygienePayload,
} from "../../../../cratedeck/shared/hygiene";
import { apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { Verdict, useScanApply, ScanApplyGate } from "../shared";
import { fetchSideStats, type CompareState } from "./hygiene-compare";
import {
  BucketStrip,
  FindingRow,
  SettledSection,
  ActionBar,
  hygieneBanner,
  rank,
  subOf,
} from "./hygiene-rows";

type Decided = Set<string>;
export function HygieneTab(_props: { driveId: string; driveName: string }) {
  const { payload, loadErr, busy, enqueue, runAction } =
    useScanApply<HygienePayload | null>({
      readPath: "/api/hygiene",
      actionPath: "/api/hygiene",
      label: {
        thing: "hygiene",
        scanDone: "Hygiene scan queued",
        applyDone: "Apply queued — confirmed findings move to quarantine",
      },
    });
  const [selected, setSelected] = useState<Decided>(new Set());
  /** Toggle one finding's checkbox in the selection set. */
  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /** active subcategory filter (null = show all) */
  const [subFilter, setSubFilter] = useState<string | null>(null);
  /** expanded A/B compare cards: finding id → per-side stats */
  const [compares, setCompares] = useState<Record<string, CompareState>>({});
  /** id of the single playing side ("<id>:<side>") — play one at a time */
  const [playing, setPlaying] = useState<string | null>(null);

  const decide = async (ids: string[], confirm: boolean) => {
    if (ids.length === 0) return;
    await runAction(confirm ? "confirm" : "dismiss", async () => {
      const r = await apiPost<{ ok: boolean; decided: number }>(
        "/api/hygiene/decide",
        { ids, confirm },
      );
      toast(
        `${r.decided} finding${r.decided === 1 ? "" : "s"} ${confirm ? "confirmed" : "dismissed"}`,
        "ok",
      );
      setSelected(new Set());
    });
  };

  /** Batch-confirm one bucket through the engine SSOT (CLI) — only the
   *  safe-batch buckets expose this in the UI. */
  const batchConfirm = async (bucket: string) => {
    await runAction(`batch:${bucket}`, async () => {
      await apiPost<{ ok: boolean }>("/api/hygiene/bucket-confirm", {
        bucket,
      });
      toast(`Bucket "${bucket}" confirmed — Apply to execute`, "ok");
      setSubFilter(null);
    });
  };

  /** Expand an A/B compare card: fetch both sides' stats. */
  const openCompare = async (f: Finding) => {
    if (compares[f.id]) {
      setCompares(({ [f.id]: _drop, ...rest }) => rest);
      return;
    }
    setCompares((m) => ({ ...m, [f.id]: { stats: {}, loaded: false } }));
    const stats = await fetchSideStats(f.paths.slice(0, 2));
    setCompares((m) =>
      m[f.id] ? { ...m, [f.id]: { stats, loaded: true } } : m,
    );
  };

  const scanned = payload as HygienePayload | null | undefined;
  const { findings, counts } = scanned ?? {
    findings: [],
    counts: {
      open: 0,
      confirmed: 0,
      safe: 0,
      review: 0,
      byKind: {},
      bySub: {},
    },
  };
  /** The open work queue: not-yet-settled findings, worst first,
   *  narrowed by the active subcategory filter. */
  const openRows = findings
    .filter(
      (f) =>
        (f.status === "open" ||
          f.status === "confirmed" ||
          f.status === "failed") &&
        (subFilter === null || subOf(f) === subFilter),
    )
    .toSorted((a, b) => rank(a) - rank(b));
  const doneRows = findings
    .filter((f) => f.status === "applied" || f.status === "dismissed")
    .toSorted((a, b) =>
      (b.appliedAt ?? b.decidedAt ?? "").localeCompare(
        a.appliedAt ?? a.decidedAt ?? "",
      ),
    );
  const selCount = selected.size;

  const banner = hygieneBanner(counts, findings.length);

  return (
    <ScanApplyGate
      loadErr={loadErr}
      payload={payload}
      unavailable={`Hygiene ledger unavailable: ${loadErr ?? ""} — the archive DB may not have been scanned yet.`}
      loading="Loading the hygiene ledger…"
    >
      <Verdict cls={banner.cls} text={banner.text} />

      <ActionBar
        busy={busy}
        applyDisabled={counts.confirmed === 0}
        selCount={selCount}
        confirmed={counts.confirmed}
        onScan={() => enqueue("scan")}
        onApply={() => enqueue("apply")}
        onDecideSelected={(confirm) => decide([...selected], confirm)}
      />

      {counts.open + counts.confirmed === 0 ? null : (
        <>
          <BucketStrip
            counts={counts}
            subFilter={subFilter}
            busy={busy !== null}
            onFilter={setSubFilter}
            onBatchConfirm={batchConfirm}
          />
          <h3 class="sect">
            <Icon name="warn" /> Work queue — worst first
          </h3>
          <div class="checks">
            {openRows.map((f) => (
              <FindingRow
                key={f.id}
                f={f}
                cmp={compares[f.id]}
                selected={selected.has(f.id)}
                toggleSelected={() => toggleSelected(f.id)}
                playing={playing}
                setPlaying={setPlaying}
                busy={busy !== null}
                onOpenCompare={() => openCompare(f)}
                onDecide={(confirm) => decide([f.id], confirm)}
              />
            ))}
          </div>
        </>
      )}

      {doneRows.length > 0 && <SettledSection rows={doneRows} />}
    </ScanApplyGate>
  );
}
