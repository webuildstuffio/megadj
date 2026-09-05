// JobsDock.tsx — bottom-right job center. Live jobs with progress/phase/ETA
// and cancel; collapsible history of finished runs. Replaces the old
// pill-only tray.
import { useState } from "preact/hooks";
import type { DriveCardData, Job } from "../shared/types";
import { fmtEta } from "../shared/fmt";
import { api } from "./toast";
import { Icon } from "./icons";

const ACTIVE = new Set(["queued", "running"]);
const HISTORY = new Set(["done", "failed", "cancelled", "interrupted"]);

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

  return (
    <div class={`jobdock${collapsed ? " collapsed" : ""}`}>
      <div
        class="jobdock-head"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setCollapsed(!collapsed)}
      >
        <span class="spin">
          <Icon name="refresh" size={14} />
        </span>
        {active.length > 0 ? (
          <span>
            {active.length} job{active.length > 1 ? "s" : ""} running
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
              api(`/api/jobs/${j.id}/cancel`, { method: "POST" }).catch(
                () => {},
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
          try {
            if (j.result_json != null) {
              const r = JSON.parse(j.result_json) as {
                final?: string;
                checks?: { label: string; detail: string; status: string }[];
              };
              final = r.final ?? null;
              // non-passing checks surface as finding chips; count all
              checkCount = r.checks?.length ?? 0;
              findings = (r.checks ?? []).filter((c) => c.status !== "pass");
            }
          } catch {
            final = null;
          }
          return (
            <div
              class={`jobrow ${j.status}`}
              key={j.id}
              style={{ cursor: "pointer" }}
              onClick={() => props.focusDrive(j.drive_id)}
            >
              <div class="jobrow-top">
                <span class={`jstat ${j.status}`}>{j.status}</span>
                <span class="jkind">{j.kind}</span>
                <span class="jdrive">{driveName(j.drive_id)}</span>
                <span class="spacer" />
                <span class="jmeta" style={{ marginTop: 0 }}>
                  {j.finished_at && fmtEta((Date.now() - j.finished_at) / 1000)}
                </span>
              </div>
              {final && (
                <div class="jmsg" title={final}>
                  {final}
                </div>
              )}
              {j.kind === "verify" && checkCount > 0 && findings.length === 0 && (
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
  return (
    <div class="jobrow">
      <div class="jobrow-top">
        {j.status === "running" ? (
          <span class="spin">
            <Icon name="refresh" size={13} />
          </span>
        ) : (
          <Icon name="clock" size={13} />
        )}
        <span
          class="jkind"
          style={{ cursor: "pointer" }}
          onClick={props.onFocus}
          title="Open drive"
        >
          {j.kind}
        </span>
        <span class="jdrive">{props.driveName}</span>
        <span class={`jstat ${j.status}`}>{j.status}</span>
        <span class="spacer" />
        {j.status === "running" && (
          <button
            type="button"
            class="cancel"
            title="Cancel job"
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
            <i style={{ width: `${Math.round(j.progress * 100)}%` }} />
          </div>
          <div class="jmeta">
            <span>{Math.round(j.progress * 100)}%</span>
            {j.phase && <span>{j.phase}</span>}
            <span style={{ marginLeft: "auto" }}>
              {j.eta_seconds != null ? `ETA ${fmtEta(j.eta_seconds)}` : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
