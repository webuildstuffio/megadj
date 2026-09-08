// JobsDock.tsx — bottom-right job center. Live jobs with progress/phase/ETA
// and cancel; collapsible history of finished runs. Replaces the old
// pill-only tray.
//
// "Always spinning" fix (Sep 8 2026): the dock used to treat every row in
// the active set as healthy live work — one stale spin for anything
// queued/running, no matter how long it had been sitting still. Now each
// row's freshness is measured against its own last-change time, a stalled
// job is SAID to be stalled (matched by the server's stall watchdog, which
// actually kills it after cfg.stall_timeout_min), and the header spinner
// only turns while something is genuinely running (not queued).
import { useState } from "preact/hooks";
import type { DriveCardData, Job, VerifyReport } from "../shared/types";
import { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES } from "../shared/types";
import { errMessage, fmtEta, timeAgo } from "../shared/fmt";
import { apiPost, toast } from "./toast";
import { Icon } from "./icons";
import { HELP_JOBS } from "../shared/help";

const ACTIVE = new Set<string>(ACTIVE_JOB_STATUSES);
const HISTORY = new Set<string>(TERMINAL_JOB_STATUSES);

/** Job status → what it means for the user (hover on the status chip). */
const STATUS_HELP: Record<string, string> = {
  queued: "Waiting for its turn — one job runs per drive at a time.",
  running: "Active now. Progress, phase and ETA update live.",
  done: "Finished successfully.",
  failed: "Ran and failed — the error line says why. Safe to re-run.",
  interrupted:
    "The server was restarted (or the job's process died) mid-run. Re-run it.",
  cancelled: "Cancelled by a user or agent before it finished.",
  locked:
    "Refused because rekordbox was running (the interlock). Quit rekordbox and re-run.",
};

/** Readable stage label for the machine phase string the engine stores
 *  ("phase-2" was literally rendered before — phase names are for machines,
 *  this map is for humans). Falls back to the raw phase when unknown. */
const PHASE_LABELS: Record<string, string> = {
  "light-scan": "walking files",
  "full-scan": "reading rekordbox DB",
  "bench-seq": "reading big files",
  "bench-rand": "random 4K reads",
  checksum: "hashing files",
  mirror: "syncing to mirror",
  "1-databases": "opening databases",
  "2-hardware": "hardware DB view",
  "3-tracks": "checking tracks",
  "4-relations": "playlists + relations",
  "5-cross": "comparing drives",
  "6-anlz": "hashing ANLZ",
  "7-audio": "hash spot-check",
  "8-verdict": "writing verdict",
  done: "done",
};

function phaseLabel(phase: string | null): string | null {
  if (!phase) return null;
  // verify phases arrive as "phase-<n>" (engine) — map the number
  const m = phase.match(/^phase-(\d+)$/);
  if (m) {
    const names = [
      "opening databases",
      "hardware DB view",
      "checking tracks",
      "playlists + relations",
      "comparing drives",
      "hashing ANLZ",
      "hash spot-check",
      "writing verdict",
    ];
    return names[Number(m[1]) - 1] ?? phase;
  }
  return PHASE_LABELS[phase] ?? phase;
}

/** How stale a running job may look before the dock says so. Deliberately
 *  ~half the server's default stall_timeout (15m): the UI should warn well
 *  before the server acts. A queued job gets a shorter patience — it should
 *  start or be cancelled, not sit silently. */
const RUNNING_STALE_MS = 5 * 60_000;
const QUEUED_STALE_MS = 90_000;

/** ms since the job last changed in any observable way. Server progress
 *  writes ride the SSE stream, so `received` (when THIS client got the row)
 *  bounds it if the stream is dead. */
function lastChangeAge(job: Job, received: number): number {
  const at = Math.max(job.finished_at ?? 0, job.started_at ?? 0, received);
  return Date.now() - at;
}

export function JobsDock(props: {
  jobs: Job[];
  drives: DriveCardData[];
  focusDrive: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = props.jobs.filter((j) => ACTIVE.has(j.status));
  const history = props.jobs.filter((j) => HISTORY.has(j.status)).slice(0, 6);
  if (!active.length && !history.length) return null;

  const driveName = (id: string) =>
    props.drives.find((d) => d.id === id)?.nickname ??
    props.drives.find((d) => d.id === id)?.name ??
    "…";

  // header spinner only while something is genuinely RUNNING (a queue of
  // parked jobs used to spin the header too — spinning implies motion)
  const anyRunning = active.some((j) => j.status === "running");

  return (
    <div class={`jobdock${collapsed ? " collapsed" : ""}`}>
      <div
        class="jobdock-head"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setCollapsed(!collapsed)}
        title="Jobs run one-per-drive, read-only unless stated, and are refused while rekordbox is open. Click to collapse."
      >
        {anyRunning ? (
          <span class="spin">
            <Icon name="refresh" size={14} />
          </span>
        ) : (
          <Icon name="clock" size={14} />
        )}
        {active.length > 0 ? (
          <span>
            {active.filter((j) => j.status === "running").length} running
            {active.some((j) => j.status === "queued")
              ? ` · ${active.filter((j) => j.status === "queued").length} queued`
              : ""}
          </span>
        ) : (
          <span>Recent jobs</span>
        )}
        <span class="spacer" />
        <span class="chev">
          <Icon name="chevronL" size={14} />
        </span>
      </div>
      <div class="jobdock-body">
        {active.map((j) => (
          <ActiveRow
            key={j.id}
            job={j}
            driveName={driveName(j.drive_id)}
            onCancel={() =>
              apiPost(`/api/jobs/${j.id}/cancel`, undefined).catch(
                (e: unknown) => toast(`cancel failed: ${errMessage(e)}`, "err"),
              )
            }
            onFocus={() => props.focusDrive(j.drive_id)}
          />
        ))}
        {history.map((j) => {
          let final: string | null = null;
          let findings: {
            label: string;
            detail: string;
          }[] = [];
          let checkCount = 0;
          let unreadable: string | null = null;
          try {
            if (j.result_json != null) {
              // VerifyReport is the producer SSOT (verify_report.ts) — the
              // local shape used to drift (checks was "optional" here only
              // because of a hand-copy, masking missing arrays as 0).
              const r = JSON.parse(j.result_json) as Partial<VerifyReport>;
              final = r.final ?? null;
              // non-passing checks surface as finding chips; count all
              checkCount = r.checks?.length ?? 0;
              findings = (r.checks ?? []).filter((c) => c.status !== "pass");
            }
          } catch (e) {
            // a result the UI cannot read must never render as a clean row —
            // surface it (the user checks deckctl jobs with this string).
            console.error(`verify result_json parse failed (job ${j.id})`, e);
            unreadable = "result unreadable — see deckctl jobs";
          }
          return (
            <div
              class={`jobrow ${j.status}`}
              key={j.id}
              style={{ cursor: "pointer" }}
              onClick={() => props.focusDrive(j.drive_id)}
              title="Open this drive"
            >
              <div class="jobrow-top">
                <span
                  class={`jstat ${j.status}`}
                  title={STATUS_HELP[j.status] ?? undefined}
                >
                  {j.status}
                </span>
                <span
                  class="jkind"
                  title={
                    HELP_JOBS.find((x) => x.kind === j.kind)?.what ?? undefined
                  }
                >
                  {j.kind}
                </span>
                <span class="jdrive">{driveName(j.drive_id)}</span>
                <span class="spacer" />
                <span class="jmeta" style={{ marginTop: 0 }}>
                  {j.finished_at && timeAgo(j.finished_at)}
                </span>
              </div>
              {final && (
                <div class="jmsg" title={final}>
                  {final}
                </div>
              )}
              {unreadable && (
                <div class="jmsg">
                  <Icon name="warn" size={11} /> {unreadable}
                </div>
              )}
              {j.kind === "verify" &&
                checkCount > 0 &&
                findings.length === 0 && (
                  <div class="jmsg pass">
                    <Icon name="check" size={11} /> all {checkCount} checks
                    passed — full breakdown in the Verify tab
                  </div>
                )}
              {findings.length > 0 && (
                <div class="jfindings">
                  {findings.slice(0, 4).map((f) => (
                    <div class="jfinding" key={f.label} title={f.detail}>
                      <Icon name="warn" size={11} /> {f.label}
                    </div>
                  ))}
                  {findings.length > 4 && (
                    <div class="jfinding more">
                      +{findings.length - 4} more — details in the Verify tab
                    </div>
                  )}
                </div>
              )}
              {j.error && (
                <div class="jmsg" title={j.error}>
                  {j.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveRow(props: {
  job: Job;
  driveName: string;
  onCancel: () => void;
  onFocus: () => void;
}) {
  const j = props.job;
  const kindHelp = HELP_JOBS.find((x) => x.kind === j.kind);
  // staleness: measure against the last time this row changed shape in the
  // client. `_received` is stamped by App's jobs fetch whenever a row's
  // rendered fields differ from the previous fetch — so a frozen progress
  // + a fresh fetch = genuinely no movement on the server.
  const receivedAt = j._received ?? Date.now();
  const staleMs = lastChangeAge(j, receivedAt);
  const staleLimit =
    j.status === "running" ? RUNNING_STALE_MS : QUEUED_STALE_MS;
  const stalled = j.status === "running" && staleMs > staleLimit;
  const parked = j.status === "queued" && staleMs > staleLimit;
  const phase = phaseLabel(j.phase);
  return (
    <div class={`jobrow${stalled ? " stalled" : ""}`}>
      <div class="jobrow-top">
        {j.status === "running" ? (
          stalled ? (
            <Icon name="warn" size={13} />
          ) : (
            <span class="spin">
              <Icon name="refresh" size={13} />
            </span>
          )
        ) : (
          <Icon name="clock" size={13} />
        )}
        <span
          class="jkind"
          style={{ cursor: "pointer" }}
          onClick={props.onFocus}
          title={
            kindHelp
              ? `${kindHelp.what}\nTakes ${kindHelp.duration}. ${kindHelp.safety}`
              : "Open drive"
          }
        >
          {j.kind}
        </span>
        <span class="jdrive">{props.driveName}</span>
        <span
          class={`jstat ${j.status}${stalled ? " stalled" : ""}`}
          title={
            stalled
              ? `No visible progress for ${Math.round(staleMs / 60_000)} min — either a quiet stretch or the job is wedged. The server auto-cancels true stalls; a few more minutes settle it.`
              : (STATUS_HELP[j.status] ?? "Open drive")
          }
        >
          {j.status}
        </span>
        <span class="spacer" />
        {(j.status === "running" || j.status === "queued") && (
          <button
            type="button"
            class="cancel"
            title={
              j.status === "queued"
                ? `Remove this queued ${j.kind} from the line`
                : `Cancel this ${j.kind} — safe: it's read-only, already-written changes stay`
            }
            onClick={props.onCancel}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      {j.message && <div class="jmsg">{j.message}</div>}
      {j.status === "running" && (
        <>
          <div class="jbar">
            <i
              class={stalled ? "stalled" : undefined}
              style={{ width: `${Math.max(2, Math.round(j.progress * 100))}%` }}
            />
          </div>
          <div class="jmeta">
            <span>{Math.round(j.progress * 100)}%</span>
            {phase && (
              <span title="The coarse stage of this job (e.g. 'hashing', 'comparing databases')">
                {phase}
              </span>
            )}
            <span style={{ marginLeft: "auto" }}>
              {j.eta_seconds != null ? `ETA ${fmtEta(j.eta_seconds)}` : ""}
            </span>
          </div>
        </>
      )}
      {parked && (
        <div class="jmsg warn">
          <Icon name="clock" size={11} /> still queued after{" "}
          {Math.round(staleMs / 60_000)} min — something ahead may be wedged
        </div>
      )}
    </div>
  );
}
