// HygieneTab.tsx — the shelf drive's Hygiene tab (docs/shelf-hygiene-
// 2026-09-09.md §5 Phase 3). Two-thirds UX law: a plain-language VERDICT
// banner first, then the fix-first work queue (worst first, each row
// carries its `megadj`/`deckctl` fix command with a copy button), then
// raw detail + the quarantine explainer. The tab is a remote control:
// scan/apply enqueue jobs over /api/hygiene, decisions are one-row CLI
// writes — the engine stays the single implementation (§4.4).
import { useCallback, useEffect, useState } from "preact/hooks";
import type {
  Finding,
  HygienePayload,
} from "../../../../cratedeck/shared/hygiene";
import { errMessage } from "../../../shared/fmt";
import { api, apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import { Verdict } from "../shared";
import { HELP_TERMS } from "../../../shared/help";

type Decided = Set<string>;
const SEV_ORDER: Record<string, number> = {
  review: 0, // human judgment needed — worst first
  confirmed: 0.5, // actually a status; sorted before open below
  likely: 1,
  safe: 2,
  info: 3,
};

/** Work-queue order: confirmed (ready to apply) first, then review,
 *  then likely, then safe batch, then applied/failed/dismissed tails. */
function rank(f: Finding): number {
  if (f.status === "confirmed") return 0;
  if (f.status === "failed") return 0.25;
  if (f.status === "open") return 1 + (SEV_ORDER[f.severity] ?? 4);
  return 5; // applied / dismissed
}

const KIND_LABEL: Record<string, string> = {
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

export function HygieneTab(_props: { driveId: string; driveName: string }) {
  const [payload, setPayload] = useState<HygienePayload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Decided>(new Set());

  const load = useCallback(async () => {
    try {
      setPayload(await api<HygienePayload>("/api/hygiene", { quiet: true }));
      setLoadErr(null);
    } catch (e) {
      const m = errMessage(e);
      console.error("hygiene load failed", e);
      setLoadErr(m);
    }
  }, []);

  useEffect(() => {
    load().catch((e: unknown) =>
      console.error("hygiene initial load failed", e),
    );
    const onJob = () => {
      load().catch((e: unknown) =>
        console.error("hygiene job-event reload failed", e),
      );
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => window.removeEventListener("cratedeck:job", onJob);
  }, [load]);

  const enqueue = async (kind: "scan" | "apply") => {
    setBusy(kind);
    try {
      await apiPost(`/api/hygiene/${kind}`, {});
      toast(
        kind === "scan"
          ? "Hygiene scan queued"
          : "Apply queued — confirmed findings move to quarantine",
        "ok",
      );
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  const decide = async (ids: string[], confirm: boolean) => {
    if (ids.length === 0) return;
    setBusy(confirm ? "confirm" : "dismiss");
    try {
      const r = await apiPost<{ ok: boolean; decided: number }>(
        "/api/hygiene/decide",
        { ids, confirm },
      );
      toast(
        `${r.decided} finding${r.decided === 1 ? "" : "s"} ${confirm ? "confirmed" : "dismissed"}`,
        "ok",
      );
      setSelected(new Set());
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
      load().catch((e: unknown) =>
        console.error("post-decide reload failed", e),
      );
    }
  };

  if (loadErr && !payload) {
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> Hygiene ledger unavailable: {loadErr} —
        the archive DB may not have been scanned yet.
      </div>
    );
  }
  if (!payload) {
    return (
      <div class="note">
        <Icon name="clock" size={14} /> Loading the hygiene ledger…
      </div>
    );
  }

  const { findings, counts } = payload;
  const openRows = findings
    .filter(
      (f) =>
        f.status === "open" ||
        f.status === "confirmed" ||
        f.status === "failed",
    )
    .sort((a, b) => rank(a) - rank(b));
  const doneRows = findings
    .filter((f) => f.status === "applied" || f.status === "dismissed")
    .sort((a, b) =>
      (b.appliedAt ?? b.decidedAt ?? "").localeCompare(
        a.appliedAt ?? a.decidedAt ?? "",
      ),
    );
  const selCount = selected.size;
  const quarTerm = HELP_TERMS.find((t) => t.term === "Quarantine");
  const quarWhy = HELP_TERMS.find((t) => t.term === "Quarantine")?.why;

  const banner =
    counts.open === 0 && counts.confirmed === 0
      ? {
          cls: "ok" as const,
          text:
            counts.review + counts.safe === 0 && findings.length === 0
              ? "No hygiene findings yet — run a scan to audit the shelf."
              : "All clear — nothing waiting for a decision.",
        }
      : counts.confirmed > 0
        ? {
            cls: "warn" as const,
            text: `${counts.confirmed} confirmed finding${counts.confirmed === 1 ? "" : "s"} ready to apply — Apply moves copies to quarantine, never deletes.`,
          }
        : {
            cls: counts.review > 0 ? ("warn" as const) : ("ok" as const),
            text: `${counts.open} open finding${counts.open === 1 ? "" : "s"}: ${counts.review} need${counts.review === 1 ? "s" : ""} your call, ${counts.safe} safe to batch-apply.`,
          };

  return (
    <>
      <Verdict cls={banner.cls} text={banner.text} />

      <div class="actions" style={{ marginTop: 10 }}>
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => enqueue("scan")}
          title="Re-walk the shelf and refresh every finding (job)"
        >
          <Icon name="scan" size={14} />
          {busy === "scan" ? "Scanning…" : "Scan shelf"}
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={busy !== null || counts.confirmed === 0}
          onClick={() => enqueue("apply")}
          title="Execute confirmed findings — copies move to quarantine, the keepers stay untouched"
        >
          <Icon name="check" size={14} />
          {busy === "apply"
            ? "Applying…"
            : `Apply ${counts.confirmed} confirmed`}
        </button>
        {selCount > 0 && (
          <>
            <button
              type="button"
              class="btn"
              disabled={busy !== null}
              onClick={() => decide([...selected], true)}
            >
              <Icon name="check" size={14} /> Confirm {selCount}
            </button>
            <button
              type="button"
              class="btn ghostbtn"
              disabled={busy !== null}
              onClick={() => decide([...selected], false)}
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

      {counts.open + counts.confirmed === 0 ? null : (
        <>
          <h3 class="sect">
            <Icon name="warn" /> Work queue — worst first
          </h3>
          <div class="checks">
            {openRows.map((f) => (
              <div class="check" key={f.id}>
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if ((e.target as HTMLInputElement).checked) next.add(f.id);
                    else next.delete(f.id);
                    setSelected(next);
                  }}
                  aria-label={`Select ${f.id}`}
                />
                <span
                  class={`pill ${f.status === "confirmed" ? "ok" : f.severity === "review" ? "warn" : ""}`}
                >
                  {f.status === "confirmed" ? "confirmed" : f.severity}
                </span>
                <span class="check-body">
                  <b>{KIND_LABEL[f.kind] ?? f.kind}</b>
                  <span class="check-detail" title={f.paths.join("\n")}>
                    {f.keeperPath ?? f.paths[0]}
                    {f.paths.length > 1 &&
                      ` + ${f.paths.length - 1} more file${f.paths.length > 2 ? "s" : ""}`}
                    {" — "}
                    {actionLine(f)}
                  </span>
                  <code class="hyg-cmd">{fixCommand(f)}</code>
                </span>
                <span class="hyg-row-actions">
                  <button
                    type="button"
                    class="btn sm"
                    disabled={busy !== null}
                    onClick={() => decide([f.id], true)}
                    title={`deckctl hygiene confirm ${f.id}`}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    class="btn sm ghostbtn"
                    disabled={busy !== null}
                    onClick={() => decide([f.id], false)}
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {doneRows.length > 0 && (
        <>
          <h3 class="sect">
            <Icon name="history" /> Settled — applied & dismissed
          </h3>
          <div class="checks">
            {doneRows.slice(0, 30).map((f) => (
              <div class="check muted" key={f.id}>
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
            ))}
          </div>
        </>
      )}
    </>
  );
}
