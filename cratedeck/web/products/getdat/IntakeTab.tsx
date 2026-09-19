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
//
// Split per concern (#233, closing slice): the live run render — the
// wire gate, verdict banner, step rail, verify table — lives in
// IntakeRun.tsx; this file keeps the folder picker + start wiring.
import { useEffect, useState } from "preact/hooks";
import type { IntakeFoldersResponse, Job } from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import { SectionHead } from "../shared";
import { errMessage } from "../../../../src/shared/leaf/fmt";
import { IntakeRun, IntakeVerdict } from "./IntakeRun";
import { IntakeDumps } from "./IntakeDumps";
export { IntakeRun, IntakeVerdict, isIntakeResult } from "./IntakeRun";

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

      <IntakeDumps />

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
