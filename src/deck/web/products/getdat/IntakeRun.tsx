// IntakeRun.tsx — the live intake run render (#233 split from
// IntakeTab.tsx): the wire-shape gate (isIntakeResult/parseIntakeResult),
// the verdict banner, the step rail + progress run view, and the per-file
// verify + stats cards. IntakeTab keeps the folder picker + start wiring.
import { Icon } from "../../ui/icons";
import { SectionHead, Verdict } from "../shared";
import {
  INTAKE_COUNTER_KEYS,
  type IntakeResult,
  type Job,
} from "../../../shared/types";
import {
  isFiniteNumber,
  isRecord,
  isUnknownArray,
} from "../../../../shared/leaf/guards";

/** The pipeline's visible steps — mirrors INTAKE_PHASES on the server
 *  (intake_run.ts) plus the audit leg. Kept as a display list; the job's
 *  `phase` string picks the active row, so a phase rename on the server
 *  just degrades to "unknown step", never a wrong highlight. */
const STEPS = [
  {
    id: "probe",
    label: "Probe files",
    what: "ffprobe every file: codec, length, tags",
  },
  {
    id: "dedupe",
    label: "Dedupe batch",
    what: "quality rules + MD5 + acoustic fingerprint",
  },
  {
    id: "archive-check",
    label: "Check archive",
    what: "already-ingested twins → quarantine",
  },
  {
    id: "enrich",
    label: "Tag + artwork",
    what: "ID3 stamps, covers, wav→aiff, player gate",
  },
  {
    id: "finishing",
    label: "Finish batch",
    what: "zips cleaned, queue flushed",
  },
  {
    id: "audit",
    label: "Verify archive",
    what: "ground-truth audit of every track",
  },
] as const;

// THE key list from the import leaf (issue #159) — was a third hand-copied
// twin of the producer's emit list.
const INTAKE_NUMBER_FIELDS = INTAKE_COUNTER_KEYS;

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isIntakeResult(value: unknown): value is IntakeResult {
  if (!isRecord(value)) return false;
  const row = value;
  if (!INTAKE_NUMBER_FIELDS.every((field) => isCount(row[field]))) return false;
  const audit = row.audit;
  if (
    audit !== null &&
    (!isRecord(audit) ||
      !isCount(audit.total) ||
      !isCount(audit.complete) ||
      audit.complete > audit.total)
  )
    return false;
  return (
    isUnknownArray(row.auditErrors) &&
    row.auditErrors.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.file === "string" &&
        typeof entry.missing === "string",
    )
  );
}

export function parseIntakeResult(json: string | null): {
  result: IntakeResult | null;
  unreadable: boolean;
} {
  if (!json) return { result: null, unreadable: true };
  try {
    const value: unknown = JSON.parse(json);
    return isIntakeResult(value)
      ? { result: value, unreadable: false }
      : { result: null, unreadable: true };
  } catch (error) {
    // The caller renders this as a failed/unreadable result. Do not expose
    // local job payloads or parser internals in the browser console.
    void error;
    return { result: null, unreadable: true };
  }
}

/** The verdict banner — plain language, first thing a human reads. */
export function IntakeVerdict({ job }: { job: Job }) {
  if (job.status === "queued")
    return (
      <Verdict
        cls="warn"
        text="Queued — waiting for the current run to finish."
      />
    );
  if (job.status === "running")
    return (
      <Verdict cls="warn" text={job.message ?? "Processing…"} icon="refresh" />
    );
  if (job.status === "failed")
    return (
      <Verdict cls="bad" text={`Failed: ${job.error ?? "unknown error"}`} />
    );
  if (job.status === "cancelled")
    return (
      <Verdict cls="bad" text="Cancelled — already-written changes stay." />
    );
  if (job.status !== "done") return <Verdict cls="warn" text={job.status} />;
  const parsed = parseIntakeResult(job.result_json);
  if (parsed.unreadable)
    return (
      <Verdict cls="bad" text="Finished — result unreadable (deckctl jobs)." />
    );
  const r = parsed.result!;
  const bad =
    r.broken +
    r.compatRejected +
    (r.audit ? r.audit.total - r.audit.complete : 0);
  const dupes = r.folderDupes + r.archiveDupes;
  if (bad > 0)
    return (
      <Verdict
        cls="warn"
        text={`${r.files} processed · ${dupes} dupe${dupes === 1 ? "" : "s"} quarantined · ${bad} NEEDS ATTENTION (below)`}
      />
    );
  const auditOk = r.audit
    ? ` · archive ${r.audit.complete}/${r.audit.total} verified`
    : " · archive audit unavailable (run megadj audit for the verdict)";
  return (
    <Verdict
      cls="ok"
      text={`${r.files} processed · ${dupes} dupe${dupes === 1 ? "" : "s"} quarantined · all playable${auditOk}`}
    />
  );
}

/** One live run: step rail + streaming log + final verify table. */
export function IntakeRun(props: {
  job: Job;
  folder: string;
  onDone: () => void;
}) {
  const { job } = props;
  const rawIdx = STEPS.findIndex((s) => s.id === job.phase);
  const phaseIdx = rawIdx === -1 ? null : rawIdx;
  const parsed =
    job.status === "done"
      ? parseIntakeResult(job.result_json)
      : { result: null, unreadable: false };
  const result = parsed.result;
  const done = job.status === "done" && !parsed.unreadable;
  const failed =
    job.status === "failed" || job.status === "cancelled" || parsed.unreadable;
  return (
    <div class="card intake-run">
      <SectionHead icon="pulse" title="2 · Pipeline">
        <span class="intake-progress-num">
          {parsed.unreadable
            ? "Result unreadable"
            : `${Math.round(job.progress * 100)}%`}
        </span>
      </SectionHead>
      <div class="intake-steps">
        {STEPS.map((s, i) => {
          const state =
            done || (phaseIdx !== null && i < phaseIdx)
              ? "done"
              : phaseIdx !== null && i === phaseIdx && job.status === "running"
                ? "active"
                : failed && phaseIdx !== null && i === phaseIdx
                  ? "failed"
                  : "wait";
          return (
            <div class={`intake-step ${state}`} key={s.id} title={s.what}>
              <span class="intake-step-dot">
                {state === "done" ? (
                  <Icon name="check" size={12} />
                ) : state === "active" ? (
                  <span class="spin">
                    <Icon name="refresh" size={12} />
                  </span>
                ) : state === "failed" ? (
                  <Icon name="x" size={12} />
                ) : (
                  <Icon name="dot" size={12} />
                )}
              </span>
              <span class="intake-step-label">{s.label}</span>
              <span class="intake-step-what">{s.what}</span>
            </div>
          );
        })}
      </div>
      {job.status === "running" && (
        <div class="jbar" style={{ margin: "10px 0 4px" }}>
          <i
            style={{ width: `${Math.max(2, Math.round(job.progress * 100))}%` }}
          />
        </div>
      )}
      {job.error && (
        <div class="intake-error">
          <Icon name="warn" size={13} /> {job.error}
        </div>
      )}
      {parsed.unreadable && (
        <div class="intake-error">
          <Icon name="warn" size={13} /> Completed job result is unreadable;
          inspect <code>deckctl jobs</code> and the job log.
        </div>
      )}
      {result && <IntakeStats r={result} />}
      {result && result.auditErrors.length > 0 && (
        <div class="intake-verify">
          <SectionHead icon="shield" title="3 · Verify — needs attention" />
          {result.auditErrors.slice(0, 12).map((e) => (
            <div class="intake-verify-row" key={e.file}>
              <Icon name="circleAlert" size={12} />
              <code>{e.file.split("/").pop()}</code>
              <span class="intake-verify-why">{e.missing}</span>
            </div>
          ))}
          {result.auditErrors.length > 12 && (
            <div class="intake-verify-row more">
              +{result.auditErrors.length - 12} more — <code>megadj audit</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IntakeStats({ r }: { r: IntakeResult }) {
  const cells: [string, number | null, string][] = [
    ["files", r.files, "seen in the folder"],
    ["tagged", r.tagged, "stamped + renamed"],
    ["art", r.artAdded, "covers embedded"],
    ["wav→aiff", r.wavConverted, "booth-safe conversion"],
    ["dupes", r.folderDupes + r.archiveDupes, "quarantined, never deleted"],
    ["upgrades", r.upgrades, "better-quality copies swapped in (history kept)"],
    [
      "verify",
      r.audit ? r.audit.complete : null,
      r.audit ? `of ${r.audit.total} archive tracks` : "archive audit n/a",
    ],
  ];
  return (
    <div class="intake-stats">
      {cells.map(([k, v, title]) => (
        <div class="intake-stat" key={k} title={title}>
          <b>{v ?? "—"}</b>
          <span>{k}</span>
        </div>
      ))}
    </div>
  );
}
