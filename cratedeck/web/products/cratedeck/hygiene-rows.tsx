// hygiene-rows.tsx — HygieneTab's presentational family (#89/#90 diet
// extraction): the work-queue row, the subcategory bucket strip, the
// action bar, and the settled tail. All pure-over-props (state + handlers
// are injected); the data fetch and decision wiring stay in HygieneTab.
import type {
  Finding,
  HygienePayload,
} from "../../../../cratedeck/shared/hygiene";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import { ScanApplyActions } from "../shared";
import { HELP_TERMS } from "../../../shared/help";
import {
  CompareCardPanel,
  baseName,
  type CompareState,
} from "./hygiene-compare";

export const SEV_ORDER: Record<string, number> = {
  review: 0, // human judgment needed — worst first
  confirmed: 0.5, // actually a status; sorted before open below
  likely: 1,
  safe: 2,
  info: 3,
};

/** Work-queue order: confirmed (ready to apply) first, then review,
 *  then likely, then safe batch, then applied/failed/dismissed tails. */
export function rank(f: Finding): number {
  if (f.status === "confirmed") return 0;
  if (f.status === "failed") return 0.25;
  if (f.status === "open") return 1 + (SEV_ORDER[f.severity] ?? 4);
  return 5; // applied / dismissed
}

export const KIND_LABEL: Record<string, string> = {
  "byte-twin": "Duplicate (byte-identical)",
  "acoustic-twin": "Duplicate (same audio, different file)",
  "folder-variant": "Variant artist folder",
  "zero-byte": "Empty file",
  "appledouble-junk": "Junk metadata file",
  "spelling-typo": "Likely spelling variant",
  "truncated-name": "Truncated name",
  "stale-pointer": "Broken library pointer",
  "orphan-audio": "Audio outside the library",
  "re-download": "Better source available",
};

/** Acoustic-twin subcategory buckets (src/hygiene/subcategory.ts). The
 *  two safe-batch buckets share one boring action (keep the bigger file);
 *  ear-check buckets genuinely need listening — their button only
 *  pre-filters the queue, it does not batch-confirm. */
export const SUB_BUCKET_META: Record<
  string,
  { label: string; hint: string; canBatch: boolean }
> = {
  "metadata-diff": {
    label: "metadata-only",
    hint: "Same rip — tiny (<0.5%) tag/art size diffs. Safe to batch: keep the bigger file.",
    canBatch: true,
  },
  "re-encode": {
    label: "re-encode",
    hint: "Transcoded once at a similar bitrate (0.5–3% size delta). Audibly identical — safe to batch.",
    canBatch: true,
  },
  "quality-diff": {
    label: "quality diff",
    hint: "Genuinely different encodes (>3% size delta) — listen side-by-side before deciding.",
    canBatch: false,
  },
  oddball: {
    label: "same size, diff bytes",
    hint: "Same size but different bytes — possibly a different master. Ear-check before deciding.",
    canBatch: false,
  },
  unclassified: {
    label: "unclassified",
    hint: "Found before the subcategory classifier shipped — re-run the scan to classify.",
    canBatch: false,
  },
};

/** Which subcategory bucket a finding belongs to (for queue filtering). */
export function subOf(f: Finding): string {
  const sub = (f.evidence as Record<string, unknown>).subcategory;
  return typeof sub === "string" ? sub : "unclassified";
}

function actionLine(f: Finding): string {
  const a = f.proposedAction;
  switch (a.type) {
    case "quarantine-loser":
      return "Move the extra copy to quarantine (nothing is deleted)";
    case "merge-folders":
      return `Merge into "${a.into}" and rename the moved files`;
    case "rename":
      return `Rename to "${a.to}"`;
    case "delete-corrupt":
      return "Quarantine the corrupt file";
    case "clean-junk":
      return "Move to quarantine (junk metadata)";
    case "re-download":
      return `Re-download: ${a.query}`;
    default:
      return "Informational";
  }
}

/** The one-line agent command for this finding's decision — the tooltip
 *  hands the exact fix to an agent (two-thirds UX law). */
function fixCommand(
  f: Finding,
  decide: "confirm" | "dismiss" = "confirm",
): string {
  return `deckctl hygiene ${decide} ${f.id}`;
}

/** Work-queue banner: one line a human reads first (two-thirds UX law).
 *  Pure over the counts — no state, no handlers. */
export function hygieneBanner(
  counts: HygienePayload["counts"],
  findingsCount: number,
): { cls: "ok" | "warn"; text: string } {
  if (counts.open === 0 && counts.confirmed === 0) {
    return {
      cls: "ok",
      text:
        counts.review + counts.safe === 0 && findingsCount === 0
          ? "No hygiene findings yet — run a scan to audit the shelf."
          : "All clear — nothing waiting for a decision.",
    };
  }
  if (counts.confirmed > 0) {
    return {
      cls: "warn",
      text: `${counts.confirmed} confirmed finding${counts.confirmed === 1 ? "" : "s"} ready to apply — Apply moves copies to quarantine, never deletes.`,
    };
  }
  return {
    cls: counts.review > 0 ? "warn" : "ok",
    text: `${counts.open} open finding${counts.open === 1 ? "" : "s"}: ${counts.review} need${counts.review === 1 ? "s" : ""} your call, ${counts.safe} safe to batch-apply.`,
  };
}

/** One work-queue row: select checkbox, pills, body, actions, and the
 *  expanded A/B compare when open. */
export function FindingRow(props: {
  f: Finding;
  cmp: CompareState | undefined;
  selected: boolean;
  toggleSelected: () => void;
  playing: string | null;
  setPlaying: (
    next: string | null | ((cur: string | null) => string | null),
  ) => void;
  busy: boolean;
  onOpenCompare: () => void;
  onDecide: (confirm: boolean) => void;
}) {
  const { f, cmp, selected, busy } = props;
  const isTwin = f.kind === "acoustic-twin" || f.kind === "byte-twin";
  return (
    <div class="check">
      <input
        type="checkbox"
        checked={selected}
        onChange={props.toggleSelected}
        aria-label={`Select ${f.id}`}
      />
      <span
        class={`pill ${f.status === "confirmed" ? "ok" : f.severity === "review" ? "warn" : ""}`}
      >
        {f.status === "confirmed" ? "confirmed" : f.severity}
      </span>
      {f.kind === "acoustic-twin" && f.status !== "confirmed" && (
        <span
          class="pill subpill"
          title={
            (f.evidence as Record<string, unknown>).subcategory === undefined
              ? "No subcategory — re-run the scan"
              : (SUB_BUCKET_META[subOf(f)]?.hint ?? subOf(f))
          }
        >
          {SUB_BUCKET_META[subOf(f)]?.label ?? subOf(f)}
        </span>
      )}
      <span class="check-body">
        <b>{KIND_LABEL[f.kind] ?? f.kind}</b>
        <span class="check-detail" title={f.paths.join("\n")}>
          {baseName(f.keeperPath ?? f.paths[0] ?? "")}
          {f.paths.length > 1 && ` vs ${baseName(f.paths[1] ?? "")}`}
          {" — "}
          {actionLine(f)}
        </span>
        <code class="hyg-cmd">{fixCommand(f)}</code>
      </span>
      <span class="hyg-row-actions">
        {isTwin && f.paths.length >= 2 && (
          <button
            type="button"
            class={`btn sm ${cmp ? "ghostbtn" : ""}`}
            disabled={busy}
            onClick={props.onOpenCompare}
            title="Open the A/B compare: play both copies, see lengths + bitrates, keep either side"
          >
            {cmp ? "Close" : "A/B compare"}
          </button>
        )}
        <button
          type="button"
          class="btn sm"
          disabled={busy}
          onClick={() => props.onDecide(true)}
          title={`deckctl hygiene confirm ${f.id}`}
        >
          Confirm
        </button>
        <button
          type="button"
          class="btn sm ghostbtn"
          disabled={busy}
          onClick={() => props.onDecide(false)}
        >
          Dismiss
        </button>
      </span>
      {cmp && (
        <CompareCardPanel
          f={f}
          cmp={cmp}
          playing={props.playing}
          setPlaying={props.setPlaying}
          busy={busy}
          onKeepOther={(id) => props.onDecide(id === f.id)}
        />
      )}
    </div>
  );
}

/** The subcategory bucket strip: filter buttons + safe-batch confirm. */
export function BucketStrip(props: {
  counts: HygienePayload["counts"];
  subFilter: string | null;
  busy: boolean;
  onFilter: (sub: string | null) => void;
  onBatchConfirm: (bucket: string) => void;
}) {
  const { counts, subFilter, busy } = props;
  if (Object.keys(counts.bySub).length === 0) return null;
  return (
    <div class="bucketstrip">
      {Object.entries(counts.bySub)
        .toSorted((a, b) => b[1] - a[1])
        .map(([sub, n]) => {
          const meta = SUB_BUCKET_META[sub] ?? {
            label: sub,
            hint: sub,
            canBatch: false,
          };
          const active = subFilter === sub;
          return (
            <div
              class={`bucket${active ? " active" : ""}${meta.canBatch ? "" : " manual"}`}
              key={sub}
            >
              <button
                type="button"
                class="bucket-filter"
                disabled={busy}
                onClick={() => props.onFilter(active ? null : sub)}
                title={meta.hint}
              >
                <b>{n}</b> {meta.label}
              </button>
              {meta.canBatch && !active && (
                <button
                  type="button"
                  class="btn sm"
                  disabled={busy}
                  onClick={() => props.onBatchConfirm(sub)}
                  title={`${meta.hint}\n\nConfirms all ${n} — then Apply executes them (quarantine, never delete).`}
                >
                  Confirm all
                </button>
              )}
            </div>
          );
        })}
      {subFilter !== null && (
        <button
          type="button"
          class="btn sm ghostbtn"
          onClick={() => props.onFilter(null)}
        >
          Show all
        </button>
      )}
      <InfoTip
        title="Duplicate buckets"
        body="Duplicates are grouped by WHY the files differ: metadata-only diffs and re-encodes are safe to batch-confirm (the bigger file wins). Quality diffs and same-size oddballs need your ears first — those buttons only filter the queue."
        why="Same fingerprint ≠ same decision: a 0.2% tag difference and a 30% bitrate difference demand different levels of trust."
      />
    </div>
  );
}

/** The toolbar above the work queue: scan/apply remote, bulk decisions,
 *  and the quarantine explainer. */
export function ActionBar(props: {
  busy: string | null;
  applyDisabled: boolean;
  selCount: number;
  confirmed: number;
  onScan: () => void;
  onApply: () => void;
  onDecideSelected: (confirm: boolean) => void;
}) {
  const { busy, applyDisabled, selCount, confirmed } = props;
  const quarTerm = HELP_TERMS.find((t) => t.term === "Quarantine");
  const quarWhy = HELP_TERMS.find((t) => t.term === "Quarantine")?.why;
  return (
    <div class="actions" style={{ marginTop: 10 }}>
      <ScanApplyActions
        busy={busy}
        applyDisabled={applyDisabled}
        scanTitle="Re-walk the shelf and refresh every finding (job)"
        applyTitle="Execute confirmed findings — copies move to quarantine, the keepers stay untouched"
        applyLabel={() => `Apply ${confirmed} confirmed`}
        onScan={props.onScan}
        onApply={props.onApply}
      />
      {selCount > 0 && (
        <>
          <button
            type="button"
            class="btn"
            disabled={busy !== null}
            onClick={() => props.onDecideSelected(true)}
          >
            <Icon name="check" size={14} /> Confirm {selCount}
          </button>
          <button
            type="button"
            class="btn ghostbtn"
            disabled={busy !== null}
            onClick={() => props.onDecideSelected(false)}
          >
            Dismiss {selCount}
          </button>
        </>
      )}
      <InfoTip
        title="Quarantine"
        body={
          quarTerm?.def ??
          "Findings are never deleted — apply moves extra copies into a dated quarantine folder on the shelf."
        }
        why={
          quarWhy ??
          "Deletion is never automated. Quarantine is reversible by hand; emptying it is a human ritual."
        }
      />
    </div>
  );
}

/** One settled row: status pill, body, validation receipt flag. */
function DoneRow({ f }: { f: Finding }) {
  return (
    <div class="check muted">
      <span class={`pill ${f.status === "applied" ? "ok" : ""}`}>
        {f.status}
      </span>
      <span class="check-body">
        <b>{KIND_LABEL[f.kind] ?? f.kind}</b>
        <span class="check-detail">
          {f.paths[0]}
          {f.validation
            ? ` — validated ${f.validation.keepersPresent} keeper${f.validation.keepersPresent === 1 ? "" : "s"} present${f.validation.ok ? "" : " (MISMATCH — review the receipt)"}`
            : ""}
        </span>
      </span>
      {f.validation && !f.validation.ok && (
        <span class="pill warn">receipt</span>
      )}
    </div>
  );
}

/** The settled tail: recently applied & dismissed findings (capped). */
export function SettledSection({ rows }: { rows: Finding[] }) {
  return (
    <>
      <h3 class="sect">
        <Icon name="history" /> Settled — applied & dismissed
      </h3>
      <div class="checks">
        {rows.slice(0, 30).map((f) => (
          <DoneRow key={f.id} f={f} />
        ))}
      </div>
    </>
  );
}
