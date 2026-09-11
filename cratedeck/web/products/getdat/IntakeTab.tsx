// IntakeTab.tsx — the GetDat intake surface (#/getdat/intake).
//
// The user-facing form of `megadj ingest`: pick a dump folder (the watch
// folder or any dated batch in the archive), hit Process, and watch the
// pipeline run step by step — probe → dedupe → archive check → enrich →
// audit — with every log line streaming into the page and a per-file
// verify table at the end.
//
// The run IS a job (kind "ingest") on the shared JobEngine: the dock,
// SSE stream, cancel, stall watchdog and interlock all apply unchanged.
// The folder allowlist is enforced server-side (/intake/start 403s
// anything outside /intake/folders).
import { useEffect, useState } from "preact/hooks";
import type {
  Job,
  IntakeResult,
  IntakeFoldersResponse,
} from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import { SectionHead, Verdict } from "../shared";
import { errMessage } from "../../../shared/fmt";

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

export function IntakeTab() {
  const folders = useFetched<IntakeFoldersResponse>(
    () => api<IntakeFoldersResponse>("/api/intake/folders"),
    [],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  // live job row (poll; SSE also feeds the dock — polling keeps this tab
  // self-sufficient at 1/s, the same cadence App uses for jobs)
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    // Poll failures surface at most once per 30s — a server outage would
    // otherwise re-toast every second off this 1s poll (AGENTS.md rule).
    let lastToastAt = 0;
    const tick = () => {
      api<Job>(`/api/jobs/${runId}`, { quiet: true })
        .then((j) => alive && setJob(j))
        .catch((e: unknown) => {
          console.error("intake job poll failed", e);
          const now = Date.now();
          if (now - lastToastAt >= 30_000) {
            lastToastAt = now;
            toast(`intake progress unavailable: ${errMessage(e)}`, "err");
          }
        });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId]);
  const [job, setJob] = useState<Job | null>(null);

  if (folders.status !== "ok")
    return <FetchedGate page={folders} loading="loading intake folders…" />;

  const { candidates } = folders.data;
  const active =
    selected ??
    folders.data.candidates.find(
      (c) => c.path === folders.data.watch && c.exists,
    )?.path ??
    null;

  const start = async () => {
    if (!active || starting) return;
    setStarting(true);
    try {
      // quiet: the caller owns the error message — a double toast (generic
      // + specific) repeated the same refusal twice.
      const started = await apiPost<Job>(
        "/api/intake/start",
        { folder: active },
        { quiet: true },
      );
      setRunId(started.id);
      toast("Intake started", "ok");
    } catch (e) {
      toast(`intake refused: ${errMessage(e)}`, "err");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <TabIntro
        what="Drop a folder of new music here and Process it: every file gets probed, deduped (quality, MD5, acoustic fingerprint), tagged, artworked, player-checked and audited — the same pipeline as `megadj ingest`, live."
        how="Pick the watch folder or a specific batch. Processing moves files into a dated batch folder in the archive; duplicates go to the hidden .ingest-duplicates folder at the archive root, never deleted; a better-quality re-download replaces the archive copy and keeps its history. One run at a time."
        next="Anything red names the file and the fix — usually `megadj fetch` for missing art or genres, `megadj tag-check` for broken tags, or `megadj convert` for straggler WAVs."
      />

      <div class="card intake-setup">
        <SectionHead icon="folder" title="1 · Choose a folder to process">
          <span class="intake-watch-hint">
            watch: <code>{folders.data.watch}</code>
          </span>
        </SectionHead>
        <div class="intake-folders">
          {candidates
            .filter((c) => c.exists || c.path === folders.data.watch)
            .map((c) => (
              <button
                key={c.path}
                type="button"
                class={`intake-folder${active === c.path ? " on" : ""}${
                  !c.exists ? " missing" : ""
                }`}
                onClick={() => setSelected(c.path)}
                disabled={!c.exists}
                title={c.path}
              >
                <Icon name={active === c.path ? "folder" : "dot"} size={15} />
                <span class="intake-folder-label">{c.label}</span>
                <span class="intake-folder-meta">
                  {c.exists
                    ? `${c.files} file${c.files === 1 ? "" : "s"}`
                    : "missing"}
                </span>
              </button>
            ))}
        </div>

        <div class="intake-startrow">
          <button
            type="button"
            class="intake-go"
            disabled={!active || starting || runRunning(job)}
            onClick={start}
          >
            <Icon name={runRunning(job) ? "refresh" : "play"} size={16} />
            {runRunning(job)
              ? "processing…"
              : starting
                ? "starting…"
                : "Process folder"}
          </button>
          {job && <IntakeVerdict job={job} />}
        </div>
      </div>

      {job && (
        <IntakeRun job={job} folder={jobStatusFolder(job)} onDone={() => {}} />
      )}

      {!job && (
        <div class="card">
          <div class="empty">
            <Icon name="info" size={14} /> Pick a folder and press Process —
            steps, errors and the per-file verify appear here live.
          </div>
        </div>
      )}
    </div>
  );
}

function runRunning(j: Job | null): boolean {
  return Boolean(j) && (j?.status === "running" || j?.status === "queued");
}

function jobStatusFolder(_j: Job): string {
  return ""; // folder is in the pick state; placeholder for row layout
}

/** The verdict banner — plain language, first thing a human reads. */
function IntakeVerdict({ job }: { job: Job }) {
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
  let r: IntakeResult | null = null;
  try {
    r = job.result_json ? (JSON.parse(job.result_json) as IntakeResult) : null;
  } catch {
    r = null;
  }
  if (!r)
    return (
      <Verdict cls="warn" text="Finished — result unreadable (deckctl jobs)." />
    );
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
    : "";
  return (
    <Verdict
      cls="ok"
      text={`${r.files} processed · ${dupes} dupe${dupes === 1 ? "" : "s"} quarantined · all playable${auditOk}`}
    />
  );
}

/** One live run: step rail + streaming log + final verify table. */
function IntakeRun(props: { job: Job; folder: string; onDone: () => void }) {
  const { job } = props;
  const phaseIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.id === job.phase),
  );
  const done = job.status === "done";
  const failed = job.status === "failed" || job.status === "cancelled";
  let result: IntakeResult | null = null;
  if (done && job.result_json) {
    try {
      result = JSON.parse(job.result_json) as IntakeResult;
    } catch {
      result = null;
    }
  }
  return (
    <div class="card intake-run">
      <SectionHead icon="pulse" title="2 · Pipeline">
        <span class="intake-progress-num">
          {Math.round(job.progress * 100)}%
        </span>
      </SectionHead>
      <div class="intake-steps">
        {STEPS.map((s, i) => {
          const state =
            done || i < phaseIdx
              ? "done"
              : i === phaseIdx && job.status === "running"
                ? "active"
                : failed && i === phaseIdx
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
